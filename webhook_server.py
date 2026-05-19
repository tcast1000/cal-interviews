#!/usr/bin/env python3
"""Webhook server for Google Calendar push notifications.

Starts a local FastAPI server, opens an ngrok tunnel, registers a
Calendar watch channel, and processes interview events in real-time
when calendar changes are detected.

Usage:
    python webhook_server.py
    python webhook_server.py --port 8765
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

import anthropic
import uvicorn
from fastapi import BackgroundTasks, FastAPI, Request, Response

from auth import GoogleServices
from calendar_monitor import get_interview_events
from config import Config, load_config
from docs_writer import create_prep_doc
from gmail_scanner import enrich_from_gmail
from llm_synthesizer import synthesize_prep
from models import ResearchResults
from pipeline_tracker import print_pipeline_status, register_event
from sheets_writer import sync_pipeline_sheet, write_to_sheet
from state_manager import StateManager
from utils import setup_logging
from web_researcher import research_interview

logger = logging.getLogger(__name__)

CHANNEL_TOKEN = "interview-prep-automation"
WATCH_RENEWAL_BUFFER_MINUTES = 30

_state = {
    "config": None,
    "services": None,
    "anthropic_client": None,
    "state_manager": None,
    "channel_id": None,
    "resource_id": None,
    "channel_expiry": None,
    "public_url": None,
    "processing": False,
}


def _start_ngrok(config: Config, port: int) -> str:
    from pyngrok import conf, ngrok

    if not config.ngrok_auth_token:
        print("ERROR: NGROK_AUTH_TOKEN is required in .env")
        print("  1. Sign up free at https://ngrok.com/")
        print("  2. Copy your auth token from https://dashboard.ngrok.com/get-started/your-authtoken")
        print("  3. Add it to .env: NGROK_AUTH_TOKEN=your_token_here")
        sys.exit(1)

    conf.get_default().auth_token = config.ngrok_auth_token

    kwargs = {"bind_tls": True}
    if config.ngrok_domain:
        kwargs["hostname"] = config.ngrok_domain

    tunnel = ngrok.connect(port, **kwargs)
    public_url = tunnel.public_url

    if not public_url.startswith("https://"):
        public_url = public_url.replace("http://", "https://")

    return public_url


def _register_watch_channel(services: GoogleServices, config: Config, public_url: str) -> dict:
    channel_id = str(uuid.uuid4())
    expiration = datetime.now(timezone.utc) + timedelta(days=7)
    expiration_ms = int(expiration.timestamp() * 1000)

    webhook_url = f"{public_url}/webhook"
    logger.info("Registering watch channel: %s", webhook_url)

    results = {}
    for cal_id in config.calendar_ids:
        try:
            body = {
                "id": f"{channel_id}-{cal_id}",
                "type": "web_hook",
                "address": webhook_url,
                "token": CHANNEL_TOKEN,
                "expiration": expiration_ms,
            }
            result = services.calendar.events().watch(
                calendarId=cal_id, body=body
            ).execute()
            results[cal_id] = result
            logger.info("  Watch registered for '%s': resourceId=%s", cal_id, result.get("resourceId"))
        except Exception as e:
            logger.error("  Failed to register watch for '%s': %s", cal_id, e)

    return {
        "channel_id": channel_id,
        "results": results,
        "expiry": expiration,
    }


def _stop_watch_channel(services: GoogleServices, channel_id: str, resource_id: str) -> None:
    try:
        services.calendar.channels().stop(body={
            "id": channel_id,
            "resourceId": resource_id,
        }).execute()
        logger.info("Watch channel stopped: %s", channel_id)
    except Exception as e:
        logger.warning("Could not stop watch channel: %s", e)


def _process_interviews() -> None:
    if _state["processing"]:
        logger.info("Already processing, skipping")
        return

    _state["processing"] = True
    try:
        config = _state["config"]
        services = _state["services"]
        anthropic_client = _state["anthropic_client"]
        state = _state["state_manager"]

        events = get_interview_events(services.calendar, config)

        to_process = [e for e in events if state.needs_refresh(e.event_id, e.updated)]

        if not to_process:
            logger.info("No new interviews to process")
            return

        logger.info("Processing %d new interview(s)", len(to_process))

        for event in to_process:
            print(f"\n{'='*60}")
            print(f"NEW INTERVIEW DETECTED: {event.title}")
            print(f"  Date: {event.start_time.strftime('%A, %B %d, %Y at %I:%M %p')}")
            print(f"  Type: {event.interview_type}")
            print(f"{'='*60}")

            try:
                event = enrich_from_gmail(services.gmail, event, anthropic_client, config)
            except Exception as e:
                logger.warning("Gmail enrichment failed: %s", e)

            try:
                research = research_interview(event, config)
            except Exception as e:
                logger.error("Research failed: %s", e)
                research = ResearchResults()

            try:
                prep = synthesize_prep(event, research, anthropic_client, config)
            except Exception as e:
                logger.error("Synthesis failed: %s", e)
                continue

            doc_url = ""
            try:
                doc_url = create_prep_doc(services.docs, services.drive, prep, config)
                print(f"  Prep doc: {doc_url}")
            except Exception as e:
                logger.error("Doc creation failed: %s", e)

            row_num = 0
            try:
                row_num = write_to_sheet(
                    services.sheets, services.drive, config, state, event, prep, doc_url
                )
            except Exception as e:
                logger.error("Sheet update failed: %s", e)

            if doc_url:
                state.mark_processed(
                    event.event_id, doc_url=doc_url,
                    sheet_row=row_num, event_updated=event.updated,
                )
                register_event(state, event, prep, doc_url)

                sheet_id = config.google_sheet_id or state.get_sheet_id()
                if sheet_id:
                    try:
                        sync_pipeline_sheet(services.sheets, state, sheet_id)
                    except Exception:
                        pass

                print(f"  Done processing: {event.title}")

        state.set_last_poll()

    except Exception as e:
        logger.error("Processing error: %s", e)
    finally:
        _state["processing"] = False


async def _renewal_loop():
    while True:
        await asyncio.sleep(60 * 60)
        if _state["channel_expiry"]:
            time_left = _state["channel_expiry"] - datetime.now(timezone.utc)
            if time_left < timedelta(minutes=WATCH_RENEWAL_BUFFER_MINUTES):
                logger.info("Renewing watch channel (expires in %s)", time_left)
                try:
                    result = _register_watch_channel(
                        _state["services"], _state["config"], _state["public_url"]
                    )
                    _state["channel_id"] = result["channel_id"]
                    _state["channel_expiry"] = result["expiry"]
                    for cal_id, res in result["results"].items():
                        _state["resource_id"] = res.get("resourceId")
                    logger.info("Watch channel renewed, expires: %s", result["expiry"])
                except Exception as e:
                    logger.error("Watch channel renewal failed: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(_renewal_loop())
    yield
    if _state["channel_id"] and _state["resource_id"]:
        _stop_watch_channel(_state["services"], _state["channel_id"], _state["resource_id"])


app = FastAPI(title="Interview Prep Webhook", lifespan=lifespan)


@app.post("/webhook")
async def handle_webhook(request: Request, background_tasks: BackgroundTasks):
    channel_id = request.headers.get("X-Goog-Channel-ID", "")
    resource_state = request.headers.get("X-Goog-Resource-State", "")
    channel_token = request.headers.get("X-Goog-Channel-Token", "")

    logger.info("Webhook received: state=%s channel=%s", resource_state, channel_id[:8] if channel_id else "?")

    if channel_token != CHANNEL_TOKEN:
        logger.warning("Invalid channel token, ignoring")
        return Response(status_code=200)

    if resource_state == "sync":
        logger.info("Sync notification — channel established")
        return Response(status_code=200)

    if resource_state in ("exists", "update"):
        background_tasks.add_task(_process_interviews)

    return Response(status_code=200)


@app.get("/health")
async def health():
    return {
        "status": "running",
        "channel_id": _state["channel_id"],
        "channel_expiry": str(_state["channel_expiry"]) if _state["channel_expiry"] else None,
        "public_url": _state["public_url"],
        "processing": _state["processing"],
    }


@app.get("/process")
async def manual_trigger(background_tasks: BackgroundTasks):
    background_tasks.add_task(_process_interviews)
    return {"status": "processing triggered"}


@app.get("/pipeline")
async def pipeline_status():
    state = _state["state_manager"]
    from pipeline_tracker import get_pipeline_summary
    return get_pipeline_summary(state)


@app.get("/{path:path}")
async def serve_verification(path: str):
    """Serves Google Search Console verification files from project root."""
    safe_path = Path(__file__).parent / path
    if safe_path.exists() and safe_path.suffix == ".html" and safe_path.name.startswith("google"):
        return Response(content=safe_path.read_text(), media_type="text/html")
    return Response(status_code=404)


def main():
    parser = argparse.ArgumentParser(description="Interview Prep Webhook Server")
    parser.add_argument("--port", type=int, default=8765, help="Local port (default: 8765)")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--env", help="Path to .env file")
    args = parser.parse_args()

    config = load_config(args.env)
    setup_logging("DEBUG" if args.verbose else config.log_level)

    print("Interview Prep — Webhook Server")
    print("=" * 40)

    print("\n[1/4] Connecting to Google services...")
    services = GoogleServices(config)
    anthropic_client = anthropic.Anthropic(api_key=config.anthropic_api_key)
    state = StateManager()

    _state["config"] = config
    _state["services"] = services
    _state["anthropic_client"] = anthropic_client
    _state["state_manager"] = state

    print("[2/4] Starting ngrok tunnel...")
    public_url = _start_ngrok(config, args.port)
    _state["public_url"] = public_url
    print(f"  Public URL: {public_url}")

    print("[3/4] Registering Calendar watch channel...")
    try:
        result = _register_watch_channel(services, config, public_url)
        _state["channel_id"] = result["channel_id"]
        _state["channel_expiry"] = result["expiry"]
        for cal_id, res in result["results"].items():
            _state["resource_id"] = res.get("resourceId")
        print(f"  Watch registered, expires: {result['expiry'].strftime('%Y-%m-%d %H:%M UTC')}")
    except Exception as e:
        print(f"\n  WARNING: Watch channel registration failed: {e}")
        print("  This usually means your ngrok domain isn't verified in Google Search Console.")
        print(f"\n  To verify your domain:")
        print(f"    1. Go to https://search.google.com/search-console")
        print(f"    2. Add property: {public_url}")
        print(f"    3. Choose 'URL prefix' method")
        print(f"    4. Choose 'HTML file' verification")
        print(f"    5. Download the file and place it in: {Path(__file__).parent}")
        print(f"    6. Visit {public_url}/<filename>.html to confirm it loads")
        print(f"    7. Click 'Verify' in Search Console")
        print(f"    8. Restart this server")
        print(f"\n  The server will still run — you can trigger manually at {public_url}/process")

    print(f"\n[4/4] Starting server on port {args.port}...")
    print(f"\n  Webhook URL:    {public_url}/webhook")
    print(f"  Health check:   {public_url}/health")
    print(f"  Manual trigger: {public_url}/process")
    print(f"  Pipeline view:  {public_url}/pipeline")
    print(f"\n  Listening for calendar changes... (Ctrl+C to stop)\n")

    _process_interviews()

    uvicorn.run(app, host="0.0.0.0", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
