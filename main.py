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
from pipeline_tracker import print_pipeline_status, register_event
from post_interview import generate_thank_you_draft, process_follow_ups
from sheets_writer import sync_pipeline_sheet, write_to_sheet
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

    print("\n[1/6] Enriching from Gmail...")
    try:
        event = enrich_from_gmail(services.gmail, event, anthropic_client, config)
    except Exception as e:
        logger.warning("Gmail enrichment failed (continuing): %s", e)

    print(f"  Company: {event.company_name or '(unknown — will attempt from web search)'}")
    print(f"  Role: {event.role_title or '(unknown)'}")
    if event.interviewers:
        print(f"  Interviewers: {', '.join(i.name for i in event.interviewers)}")

    print("\n[2/6] Researching...")
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
        print(f"  Research results: {sum(len(getattr(research, f)) for f in ['company_info', 'products_and_services', 'competitors', 'company_news', 'role_info', 'glassdoor_info', 'compensation_info'])} items")
        return

    print("\n[3/6] Synthesizing prep materials with Claude...")
    try:
        prep = synthesize_prep(event, research, anthropic_client, config)
    except Exception as e:
        logger.error("Synthesis failed: %s", e)
        print(f"  ERROR: {e}")
        _save_fallback(event, research)
        return

    print("\n[4/6] Creating Google Doc...")
    try:
        doc_url = create_prep_doc(services.docs, services.drive, prep, config)
        print(f"  Doc: {doc_url}")
    except Exception as e:
        logger.error("Doc creation failed: %s", e)
        doc_url = ""
        _save_fallback(event, research)

    print("\n[5/6] Updating tracker sheet...")
    try:
        row_num = write_to_sheet(
            services.sheets, services.drive, config, state, event, prep, doc_url
        )
        print(f"  Added row {row_num}")
    except Exception as e:
        logger.error("Sheet update failed: %s", e)
        row_num = 0

    print("\n[6/6] Updating pipeline...")
    if doc_url:
        state.mark_processed(
            event.event_id,
            doc_url=doc_url,
            sheet_row=row_num,
            event_updated=event.updated,
        )
        company_key = register_event(state, event, prep, doc_url)

        try:
            sheet_id = config.google_sheet_id or state.get_sheet_id()
            if sheet_id:
                sync_pipeline_sheet(services.sheets, state, sheet_id)
                print("  Pipeline overview synced")
        except Exception as e:
            logger.warning("Pipeline sheet sync failed: %s", e)

        print(f"  Pipeline registered: {prep.company_name}")

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
        if config.user_aliases:
            print(f"  or aliases: {', '.join(config.user_aliases)},")
        print("  or from known recruiting platforms.")
        _show_pipeline_and_followups(config, services, anthropic_client, state, args)
        return

    to_process = []
    for event in events:
        if args.refresh or state.needs_refresh(event.event_id, event.updated):
            to_process.append(event)
        else:
            logger.info("Skipping already-processed: %s", event.title)

    if not to_process:
        print(f"\nFound {len(events)} interview(s) but all already processed.")
        print("Use --refresh to re-process them.")
        _show_pipeline_and_followups(config, services, anthropic_client, state, args)
        return

    print(f"\nFound {len(to_process)} interview(s) to process:")
    for e in to_process:
        print(f"  • {e.title} — {e.start_time.strftime('%b %d at %I:%M %p')}")

    for event in to_process:
        process_event(event, services, anthropic_client, config, state, dry_run=args.dry_run)

    _show_pipeline_and_followups(config, services, anthropic_client, state, args)

    state.set_last_poll()
    sheet_id = config.google_sheet_id or state.get_sheet_id()
    if sheet_id:
        print(f"\nTracker sheet: https://docs.google.com/spreadsheets/d/{sheet_id}")


def _show_pipeline_and_followups(
    config: Config,
    services: GoogleServices,
    anthropic_client: anthropic.Anthropic,
    state: StateManager,
    args: argparse.Namespace,
) -> None:
    print_pipeline_status(state)

    if not getattr(args, "dry_run", False):
        try:
            process_follow_ups(services.gmail, anthropic_client, config, state)
        except Exception as e:
            logger.warning("Follow-up processing failed: %s", e)


def run_pipeline(config: Config, args: argparse.Namespace) -> None:
    state = StateManager()
    print_pipeline_status(state)


def run_debrief(config: Config, args: argparse.Namespace) -> None:
    state = StateManager()
    pipelines = state.get_all_pipelines()

    if not pipelines:
        print("No pipelines found. Run the tool first to process interviews.")
        return

    if args.company:
        import re
        target_key = re.sub(r"[^a-z0-9]", "", args.company.lower())
        matches = {k: v for k, v in pipelines.items() if target_key in k}
    else:
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        matches = {}
        for k, v in pipelines.items():
            for stage in v["stages"]:
                stage_dt = datetime.fromisoformat(stage["event_date"])
                if stage_dt.tzinfo is None:
                    stage_dt = stage_dt.replace(tzinfo=timezone.utc)
                if stage_dt < now and not stage.get("debrief"):
                    matches[k] = v
                    break

    if not matches:
        print("No interviews found needing a debrief.")
        return

    print("Interviews needing debrief:")
    match_list = list(matches.items())
    for i, (key, pipeline) in enumerate(match_list, 1):
        stages_needing = [s for s in pipeline["stages"] if not s.get("debrief")]
        for stage in stages_needing:
            dt = datetime.fromisoformat(stage["event_date"])
            print(f"  {i}. {pipeline['company_name']} — {stage['stage_type']} ({dt.strftime('%b %d')})")

    if not args.notes:
        print("\nUse --notes 'your debrief notes' to save a debrief.")
        print("Example: python main.py --debrief --company Acme --notes 'Went well, discussed system design...'")
        return

    for key, pipeline in match_list:
        stages_needing = [s for s in pipeline["stages"] if not s.get("debrief")]
        if stages_needing:
            latest = stages_needing[-1]
            state.save_debrief(key, latest["event_id"], args.notes)
            print(f"\nDebrief saved for {pipeline['company_name']} — {latest['stage_type']}")

            if args.thank_you:
                services = GoogleServices(config)
                anthropic_client = anthropic.Anthropic(api_key=config.anthropic_api_key)
                from models import PrepDocument, InterviewEvent
                event_data = state._state["processed_events"].get(latest["event_id"], {})
                print("  Generating thank-you email draft...")
                try:
                    _generate_thank_you_for_stage(
                        services, anthropic_client, config, state, key, latest, args.notes,
                    )
                except Exception as e:
                    logger.warning("Thank-you generation failed: %s", e)


def _generate_thank_you_for_stage(
    services: GoogleServices,
    anthropic_client: anthropic.Anthropic,
    config: Config,
    state: StateManager,
    company_key: str,
    stage: dict,
    debrief: str,
) -> None:
    pipeline = state.get_pipeline(company_key)
    if not pipeline:
        return

    from models import InterviewEvent, PrepDocument
    from datetime import datetime

    event_date = datetime.fromisoformat(stage["event_date"])
    dummy_event = InterviewEvent(
        event_id=stage["event_id"],
        title=f"{pipeline['company_name']} — {stage['stage_type']}",
        start_time=event_date,
        end_time=event_date,
    )
    dummy_prep = PrepDocument(
        company_name=pipeline["company_name"],
        role_title=pipeline.get("role_title") or "",
        interview_date=event_date.strftime("%A, %B %d, %Y"),
        interview_time=event_date.strftime("%I:%M %p"),
        interview_location="",
        video_link="",
        interviewer_names=[],
        company_overview="",
        products_and_services=[],
        competitors=[],
        recent_news=[],
        role_analysis="",
        interviewer_backgrounds={},
        potential_questions=[],
        questions_to_ask=[],
        key_talking_points=[],
        sheet_talking_points=[],
        compensation={},
        sources=[],
        interview_type=stage["stage_type"],
    )

    draft_id = generate_thank_you_draft(
        services.gmail, anthropic_client, config, dummy_event, dummy_prep, debrief,
    )
    if draft_id:
        stage["thank_you_draft_id"] = draft_id
        state._save()


def run_update_status(config: Config, args: argparse.Namespace) -> None:
    state = StateManager()
    import re
    target_key = re.sub(r"[^a-z0-9]", "", args.company.lower())

    pipelines = state.get_all_pipelines()
    matches = {k: v for k, v in pipelines.items() if target_key in k}

    if not matches:
        print(f"No pipeline found matching '{args.company}'.")
        print("Active pipelines:")
        for k, v in pipelines.items():
            print(f"  - {v['company_name']}")
        return

    valid_statuses = ["Active", "Offer", "Rejected", "Withdrawn", "Ghosted"]
    if args.status not in valid_statuses:
        print(f"Invalid status '{args.status}'. Choose from: {', '.join(valid_statuses)}")
        return

    for key, pipeline in matches.items():
        state.update_pipeline_status(key, args.status)
        print(f"Updated {pipeline['company_name']} → {args.status}")

        if args.note:
            state.add_pipeline_note(key, args.note)
            print(f"  Note added: {args.note}")

    sheet_id = config.google_sheet_id or state.get_sheet_id()
    if sheet_id:
        try:
            services = GoogleServices(config)
            sync_pipeline_sheet(services.sheets, state, sheet_id)
            print("Pipeline sheet synced.")
        except Exception as e:
            logger.warning("Could not sync pipeline sheet: %s", e)


def run_follow_ups(config: Config, args: argparse.Namespace) -> None:
    services = GoogleServices(config)
    anthropic_client = anthropic.Anthropic(api_key=config.anthropic_api_key)
    state = StateManager()
    process_follow_ups(services.gmail, anthropic_client, config, state)


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
  python main.py --pipeline       View all interview pipelines
  python main.py --debrief --company Acme --notes 'Great chat about...'
  python main.py --debrief --company Acme --notes '...' --thank-you
  python main.py --status --company Acme --set-status Offer
  python main.py --follow-ups     Generate follow-up drafts for stale pipelines
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

    parser.add_argument("--pipeline", action="store_true", help="View interview pipeline status")
    parser.add_argument("--debrief", action="store_true", help="Log debrief notes for a completed interview")
    parser.add_argument("--company", help="Company name (used with --debrief and --status)")
    parser.add_argument("--notes", help="Debrief notes text (used with --debrief)")
    parser.add_argument("--thank-you", action="store_true", help="Generate thank-you email draft (with --debrief)")
    parser.add_argument("--status", action="store_true", help="Update pipeline status for a company")
    parser.add_argument("--set-status", help="New status: Active, Offer, Rejected, Withdrawn, Ghosted")
    parser.add_argument("--note", help="Add a note when updating status")
    parser.add_argument("--follow-ups", action="store_true", help="Generate follow-up email drafts")

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

    if args.pipeline:
        run_pipeline(config, args)
    elif args.debrief:
        run_debrief(config, args)
    elif args.status:
        if not args.company or not args.set_status:
            print("Usage: --status --company <name> --set-status <Active|Offer|Rejected|Withdrawn|Ghosted>")
            sys.exit(1)
        run_update_status(config, args)
    elif args.follow_ups:
        run_follow_ups(config, args)
    elif args.watch:
        run_watch(config, args)
    else:
        run_once(config, args)


if __name__ == "__main__":
    main()
