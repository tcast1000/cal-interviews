from __future__ import annotations

import base64
import json
import logging
from datetime import datetime, timezone
from email.mime.text import MIMEText

import anthropic

from config import Config
from models import InterviewEvent, PrepDocument
from state_manager import StateManager

logger = logging.getLogger(__name__)

THANK_YOU_PROMPT = """Write a concise, professional thank-you email after a job interview.

Details:
- Company: {company}
- Role: {role}
- Interview type: {interview_type}
- Interviewer(s): {interviewers}
- Date: {date}

{debrief_section}

Guidelines:
- Keep it under 150 words
- Reference something specific about the conversation or role if debrief notes are provided
- Sound genuine, not templated
- Don't grovel or over-thank — one clear "thank you" is enough
- End with a forward-looking line about next steps

Return a JSON object:
{{
    "subject": "short email subject line",
    "body": "the full email body text"
}}

Return ONLY the JSON object."""

FOLLOW_UP_PROMPT = """Write a brief, professional follow-up email for a job interview process where
the candidate hasn't heard back.

Details:
- Company: {company}
- Role: {role}
- Last interview: {last_stage} on {last_date}
- Days since last contact: {days_silent}

Guidelines:
- Keep it under 100 words
- Be polite but direct — ask for a status update
- Reference the specific role and last conversation
- Don't sound desperate or passive-aggressive

Return a JSON object:
{{
    "subject": "short email subject line",
    "body": "the full email body text"
}}

Return ONLY the JSON object."""


def generate_thank_you_draft(
    gmail_service,
    anthropic_client: anthropic.Anthropic,
    config: Config,
    event: InterviewEvent,
    prep: PrepDocument,
    debrief: str | None = None,
) -> str | None:
    interviewers = ", ".join(prep.interviewer_names) if prep.interviewer_names else "the team"

    debrief_section = ""
    if debrief:
        debrief_section = f"Candidate's notes from the conversation:\n{debrief}\n\nUse these to make the email feel specific and personal."

    prompt = THANK_YOU_PROMPT.format(
        company=prep.company_name,
        role=prep.role_title,
        interview_type=prep.interview_type,
        interviewers=interviewers,
        date=prep.interview_date,
        debrief_section=debrief_section,
    )

    try:
        response = anthropic_client.messages.create(
            model=config.claude_model,
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}],
        )

        text = response.content[0].text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        data = json.loads(text)

        draft_id = _create_gmail_draft(
            gmail_service,
            subject=data["subject"],
            body=data["body"],
            to=_get_recipient_emails(event),
        )

        if draft_id:
            logger.info("Thank-you draft created: %s", draft_id)
            print(f"  Thank-you email draft created in Gmail (draft ID: {draft_id})")
        return draft_id

    except Exception as e:
        logger.warning("Failed to generate thank-you draft: %s", e)
        return None


def generate_follow_up_draft(
    gmail_service,
    anthropic_client: anthropic.Anthropic,
    config: Config,
    pipeline: dict,
) -> str | None:
    stages = pipeline["stages"]
    if not stages:
        return None

    last_stage = stages[-1]
    last_date = datetime.fromisoformat(last_stage["event_date"])
    days_silent = (datetime.now(timezone.utc) - last_date).days

    prompt = FOLLOW_UP_PROMPT.format(
        company=pipeline["company_name"],
        role=pipeline.get("role_title") or "the role",
        last_stage=last_stage["stage_type"],
        last_date=last_date.strftime("%B %d"),
        days_silent=days_silent,
    )

    try:
        response = anthropic_client.messages.create(
            model=config.claude_model,
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}],
        )

        text = response.content[0].text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        data = json.loads(text)

        draft_id = _create_gmail_draft(
            gmail_service,
            subject=data["subject"],
            body=data["body"],
        )

        if draft_id:
            logger.info("Follow-up draft created for %s: %s", pipeline["company_name"], draft_id)
            print(f"  Follow-up email draft created for {pipeline['company_name']} (draft ID: {draft_id})")
        return draft_id

    except Exception as e:
        logger.warning("Failed to generate follow-up draft for %s: %s", pipeline["company_name"], e)
        return None


def _get_recipient_emails(event: InterviewEvent) -> str:
    emails = []
    for a in event.attendees:
        if a.email and not a.email.endswith(("calendar.google.com", "resource.calendar.google.com")):
            from utils import extract_domain
            domain = extract_domain(a.email)
            if domain:
                emails.append(a.email)
    return ", ".join(emails)


def _create_gmail_draft(
    gmail_service,
    subject: str,
    body: str,
    to: str = "",
) -> str | None:
    try:
        message = MIMEText(body)
        message["subject"] = subject
        if to:
            message["to"] = to

        raw = base64.urlsafe_b64encode(message.as_bytes()).decode("utf-8")
        draft = gmail_service.users().drafts().create(
            userId="me",
            body={"message": {"raw": raw}},
        ).execute()
        return draft.get("id")
    except Exception as e:
        logger.warning("Failed to create Gmail draft: %s", e)
        return None


def process_follow_ups(
    gmail_service,
    anthropic_client: anthropic.Anthropic,
    config: Config,
    state: StateManager,
) -> None:
    from pipeline_tracker import get_pipeline_summary

    summaries = get_pipeline_summary(state)
    follow_ups = [s for s in summaries if s["needs_follow_up"] and s["status"] == "Active"]

    if not follow_ups:
        print("\nNo follow-ups needed right now.")
        return

    print(f"\n{len(follow_ups)} company pipeline(s) need follow-up:")

    for s in follow_ups:
        print(f"\n  {s['company_name']} — {s['days_silent']} days since last activity")
        pipeline = state.get_pipeline(s["company_key"])
        draft_id = generate_follow_up_draft(gmail_service, anthropic_client, config, pipeline)
        if draft_id:
            from datetime import timedelta
            new_follow_up = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
            state.set_pipeline_follow_up(s["company_key"], new_follow_up)
