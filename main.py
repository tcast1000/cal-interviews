#!/usr/bin/env python3
"""Interview Prep Automation — monitors Google Calendar for interview events,
researches companies/interviewers/roles, and generates prep materials in
Google Sheets + Google Docs."""

from __future__ import annotations

import argparse
import logging
import sys
import time

import anthropic

from auth import GoogleServices, check_setup
from calendar_monitor import get_interview_events
from config import Config, load_config
from docs_writer import create_prep_doc
from gmail_scanner import enrich_from_gmail
from llm_synthesizer import synthesize_prep
from models import InterviewEvent
from sheets_writer import write_to_sheet
from state_manager import StateManager
from utils import setup_logging
from web_researcher import research_interview

logger = logging.getLogger(__name__)


def process_event(
    event: InterviewEvent,
    services: GoogleServices,
    anthropic_client: anthropic.Anthropic,
    config: Config,
    state: StateManager,
    dry_run: bool = False,
) -> None:
    print(f"\n{'='*60}")
    print(f"Processing: {event.title}")
    print(f"  Date: {event.start_time.strftime('%A, %B %d, %Y at %I:%M %p')}")
    print(f"  Type: {event.interview_type}")
    print(f"{'='*60}")

    print("\n[1/5] Enriching from Gmail...")
    try:
        event = enrich_from_gmail(services.gmail, event, anthropic_client, config)
    except Exception as e:
        logger.warning("Gmail enrichment failed (continuing): %s", e)

    print(f"  Company: {event.company_name or '(unknown — will attempt from web search)'}")
    print(f"  Role: {event.role_title or '(unknown)'}")
    if event.interviewers:
        print(f"  Interviewers: {', '.join(i.name for i in event.interviewers)}")

    print("\n[2/5] Researching...")
    try:
        research = research_interview(event, config)
    except Exception as e:
        logger.error("Research failed: %s", e)
        from models import ResearchResults
        research = ResearchResults()

    if dry_run:
        print("\n[DRY RUN] Would create Google Doc and add Sheet row.")
        print(f"  Company: {event.company_name}")
        print(f"  Role: {event.role_title}")
        print(f"  Research results: {sum(len(getattr(research, f)) for f in ['company_info', 'company_news', 'role_info', 'glassdoor_info'])} items")
        return

    print("\n[3/5] Synthesizing prep materials with Claude...")
    try:
        prep = synthesize_prep(event, research, anthropic_client, config)
    except Exception as e:
        logger.error("Synthesis failed: %s", e)
        print(f"  ERROR: {e}")
        _save_fallback(event, research)
        return

    print("\n[4/5] Creating Google Doc...")
    try:
        doc_url = create_prep_doc(services.docs, services.drive, prep, config)
        print(f"  Doc: {doc_url}")
    except Exception as e:
        logger.error("Doc creation failed: %s", e)
        doc_url = ""
        _save_fallback(event, research)

    print("\n[5/5] Updating tracker sheet...")
    try:
        row_num = write_to_sheet(
            services.sheets, services.drive, config, state, event, prep, doc_url
        )
        print(f"  Added row {row_num}")
    except Exception as e:
        logger.error("Sheet update failed: %s", e)

    if doc_url:
        state.mark_processed(
            event.event_id,
            doc_url=doc_url,
            sheet_row=row_num if doc_url else 0,
            event_updated=None,
        )

    print(f"\nDone! Prep doc: {doc_url}")


def _save_fallback(event, research):
    from pathlib import Path
    fallback_dir = Path(__file__).parent / "fallback"
    fallback_dir.mkdir(exist_ok=True)
    filename = f"{event.start_time.strftime('%Y%m%d')}_{event.company_name or 'unknown'}.md"
    path = fallback_dir / filename

    lines = [f"# {event.title}\n"]
    lines.append(f"Date: {event.start_time}\n")
    lines.append(f"Company: {event.company_name}\n")
    lines.append(f"Role: {event.role_title}\n\n")
    lines.append("## Raw Research\n\n")
    for r in research.company_info:
        lines.append(f"- [{r.title}]({r.url}): {r.snippet}\n")
    for r in research.company_news:
        lines.append(f"- [{r.title}]({r.url}): {r.snippet}\n")
    for r in research.role_info:
        lines.append(f"- [{r.title}]({r.url}): {r.snippet}\n")

    path.write_text("".join(lines), encoding="utf-8")
    logger.info("Saved fallback to %s", path)


def run_once(config: Config, args: argparse.Namespace) -> None:
    services = GoogleServices(config)

    if not config.user_name or not config.user_email:
        try:
            profile = services.get_user_profile()
            if not config.user_email:
                config.user_email = profile["email"]
                logger.info("Auto-detected email: %s", config.user_email)
        except Exception as e:
            logger.warning("Could not auto-detect user profile: %s", e)

    anthropic_client = anthropic.Anthropic(api_key=config.anthropic_api_key)
    state = StateManager()

    if args.event_id:
        try:
            event_data = services.calendar.events().get(
                calendarId="primary", eventId=args.event_id
            ).execute()
            from calendar_monitor import _parse_event
            events = [_parse_event(event_data, config)]
        except Exception as e:
            print(f"Could not fetch event {args.event_id}: {e}")
            return
    else:
        events = get_interview_events(services.calendar, config, args.days)

    if not events:
        print("\nNo upcoming interview events found.")
        print(f"  Scanned {args.days or config.look_ahead_days} days ahead")
        print("  Looking for events with 'interview' in the title,")
        if config.user_name:
            print(f"  or '{config.user_name}' in the title,")
        print("  or from known recruiting platforms.")
        return

    to_process = []
    for event in events:
        if args.refresh or not state.is_processed(event.event_id):
            to_process.append(event)
        else:
            logger.info("Skipping already-processed: %s", event.title)

    if not to_process:
        print(f"\nFound {len(events)} interview(s) but all already processed.")
        print("Use --refresh to re-process them.")
        return

    print(f"\nFound {len(to_process)} interview(s) to process:")
    for e in to_process:
        print(f"  • {e.title} — {e.start_time.strftime('%b %d at %I:%M %p')}")

    for event in to_process:
        process_event(event, services, anthropic_client, config, state, dry_run=args.dry_run)

    state.set_last_poll()
    sheet_id = config.google_sheet_id or state.get_sheet_id()
    if sheet_id:
        print(f"\nTracker sheet: https://docs.google.com/spreadsheets/d/{sheet_id}")


def run_watch(config: Config, args: argparse.Namespace) -> None:
    print(f"Watch mode — checking every {config.poll_interval_minutes} minutes. Press Ctrl+C to stop.\n")
    try:
        while True:
            run_once(config, args)
            logger.info("Next check in %d minutes...", config.poll_interval_minutes)
            time.sleep(config.poll_interval_minutes * 60)
    except KeyboardInterrupt:
        print("\nStopped.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Interview Prep Automation — research companies and prepare for interviews",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python main.py                  Process new interviews (14-day lookahead)
  python main.py --days 30        Scan 30 days ahead
  python main.py --dry-run        Preview without creating docs
  python main.py --refresh        Re-process all upcoming interviews
  python main.py --watch          Poll every 30 minutes
  python main.py --check-setup    Verify all APIs are accessible
  python main.py --event-id abc   Process a specific calendar event
        """,
    )
    parser.add_argument("--days", type=int, help="Number of days ahead to scan")
    parser.add_argument("--dry-run", action="store_true", help="Preview without creating docs/sheets")
    parser.add_argument("--refresh", action="store_true", help="Re-process already-processed events")
    parser.add_argument("--watch", action="store_true", help="Continuous polling mode")
    parser.add_argument("--event-id", help="Process a specific calendar event by ID")
    parser.add_argument("--check-setup", action="store_true", help="Verify all API connections")
    parser.add_argument("--verbose", action="store_true", help="Enable debug logging")
    parser.add_argument("--env", help="Path to .env file")

    args = parser.parse_args()

    if args.check_setup:
        config = Config(args.env)
        errors = config.validate()
        if errors:
            print("Configuration errors:")
            for e in errors:
                print(f"  - {e}")
            sys.exit(1)
        config.print_config_summary()
        print()
        setup_ok = check_setup(config)
        sys.exit(0 if setup_ok else 1)

    config = load_config(args.env)
    setup_logging("DEBUG" if args.verbose else config.log_level)

    print("Interview Prep Automation")
    print("=" * 40)

    if args.watch:
        run_watch(config, args)
    else:
        run_once(config, args)


if __name__ == "__main__":
    main()
