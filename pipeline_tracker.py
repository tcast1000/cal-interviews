from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone

from models import InterviewEvent, PrepDocument
from state_manager import StateManager

logger = logging.getLogger(__name__)

STAGE_ORDER = [
    "Phone Screen", "Recruiter Screen",
    "Technical", "Coding", "System Design",
    "Behavioral", "Culture Fit",
    "Hiring Manager",
    "Panel",
    "Final Round", "Onsite",
    "Interview",
]


def _normalize_company_key(name: str) -> str:
    key = re.sub(r"[^a-z0-9]", "", name.lower())
    return key


def register_event(
    state: StateManager,
    event: InterviewEvent,
    prep: PrepDocument,
    doc_url: str,
) -> str:
    company = prep.company_name or event.company_name or "Unknown"
    company_key = _normalize_company_key(company)

    state.upsert_pipeline(
        company_key=company_key,
        company_name=company,
        role_title=prep.role_title or event.role_title,
    )

    state.add_pipeline_stage(
        company_key=company_key,
        event_id=event.event_id,
        stage_type=event.interview_type or "Interview",
        event_date=event.start_time.isoformat(),
        doc_url=doc_url,
    )

    follow_up = (event.start_time + timedelta(days=3)).isoformat()
    state.set_pipeline_follow_up(company_key, follow_up)

    pipeline = state.get_pipeline(company_key)
    stage_count = len(pipeline["stages"])
    logger.info(
        "Pipeline '%s': stage %d (%s) registered",
        company, stage_count, event.interview_type,
    )
    return company_key


def get_pipeline_summary(state: StateManager) -> list[dict]:
    now = datetime.now(timezone.utc)
    summaries = []

    for key, pipeline in state.get_all_pipelines().items():
        if pipeline["status"] in ("Rejected", "Withdrawn"):
            continue

        stages = pipeline["stages"]
        stage_count = len(stages)
        current_stage = stages[-1]["stage_type"] if stages else "Unknown"

        last_activity = datetime.fromisoformat(pipeline["last_activity"])
        days_silent = (now - last_activity).days

        needs_follow_up = False
        if pipeline.get("follow_up_after"):
            follow_up_dt = datetime.fromisoformat(pipeline["follow_up_after"])
            if follow_up_dt.tzinfo is None:
                follow_up_dt = follow_up_dt.replace(tzinfo=timezone.utc)
            needs_follow_up = now >= follow_up_dt

        last_stage_has_debrief = bool(stages and stages[-1].get("debrief"))
        last_stage_date = stages[-1]["event_date"] if stages else None
        needs_debrief = False
        if last_stage_date:
            stage_dt = datetime.fromisoformat(last_stage_date)
            if stage_dt.tzinfo is None:
                stage_dt = stage_dt.replace(tzinfo=timezone.utc)
            needs_debrief = stage_dt < now and not last_stage_has_debrief

        next_action = "None"
        if needs_debrief:
            next_action = "Log debrief"
        elif needs_follow_up:
            next_action = "Send follow-up"
        elif pipeline["status"] == "Active" and days_silent > 7:
            next_action = "Check in"

        summaries.append({
            "company_key": key,
            "company_name": pipeline["company_name"],
            "role_title": pipeline.get("role_title") or "",
            "status": pipeline["status"],
            "stage_count": stage_count,
            "current_stage": current_stage,
            "days_silent": days_silent,
            "needs_follow_up": needs_follow_up,
            "needs_debrief": needs_debrief,
            "next_action": next_action,
            "stages": stages,
        })

    summaries.sort(key=lambda s: s["days_silent"])
    return summaries


def print_pipeline_status(state: StateManager) -> None:
    summaries = get_pipeline_summary(state)

    if not summaries:
        print("\nNo active pipelines.")
        return

    print(f"\n{'='*70}")
    print("INTERVIEW PIPELINE")
    print(f"{'='*70}")

    for s in summaries:
        flag = ""
        if s["needs_debrief"]:
            flag = " [DEBRIEF NEEDED]"
        elif s["needs_follow_up"]:
            flag = " [FOLLOW UP]"
        elif s["days_silent"] > 7:
            flag = f" [{s['days_silent']}d silent]"

        print(f"\n  {s['company_name']} — {s['role_title'] or 'Role TBD'}")
        print(f"    Status: {s['status']} | Stage: {s['current_stage']} | Rounds: {s['stage_count']}{flag}")

        if s["next_action"] != "None":
            print(f"    Next action: {s['next_action']}")

        for stage in s["stages"]:
            dt = datetime.fromisoformat(stage["event_date"])
            date_str = dt.strftime("%b %d")
            debrief_mark = " [debriefed]" if stage.get("debrief") else ""
            print(f"      {date_str} — {stage['stage_type']}{debrief_mark}")

    print(f"\n{'='*70}")
