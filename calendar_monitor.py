from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone

from config import Config
from models import Attendee, InterviewEvent
from utils import parse_datetime

logger = logging.getLogger(__name__)

RECRUITING_DOMAINS = {
    "greenhouse.io", "lever.co", "ashbyhq.com", "goodtime.io",
    "calendly.com", "hire.lever.co", "app.greenhouse.io",
    "resource.io", "modernloop.com", "prelude.co", "gem.com",
    "brighthire.ai", "metaview.ai",
}

INTERVIEW_TYPE_KEYWORDS = {
    "phone screen": "Phone Screen",
    "recruiter": "Phone Screen",
    "recruiter screen": "Phone Screen",
    "technical": "Technical",
    "coding": "Technical",
    "system design": "Technical",
    "live coding": "Technical",
    "take home": "Technical",
    "behavioral": "Behavioral",
    "culture fit": "Behavioral",
    "culture": "Behavioral",
    "values": "Behavioral",
    "panel": "Panel",
    "team": "Panel",
    "final": "Final Round",
    "final round": "Final Round",
    "onsite": "Final Round",
    "on-site": "Final Round",
    "hiring manager": "Hiring Manager",
}


def _detect_interview_type(title: str, description: str | None) -> str:
    text = f"{title} {description or ''}".lower()
    for keyword, itype in INTERVIEW_TYPE_KEYWORDS.items():
        if keyword in text:
            return itype
    return "Interview"


def _extract_video_link(event: dict) -> str | None:
    if "hangoutLink" in event:
        return event["hangoutLink"]

    entry_points = event.get("conferenceData", {}).get("entryPoints", [])
    for ep in entry_points:
        if ep.get("entryPointType") == "video":
            return ep.get("uri")

    desc = event.get("description", "")
    if desc:
        zoom_match = re.search(r"https://[\w.-]*zoom\.us/j/\S+", desc)
        if zoom_match:
            return zoom_match.group(0)
        teams_match = re.search(r"https://teams\.microsoft\.com/l/meetup-join/\S+", desc)
        if teams_match:
            return teams_match.group(0)
        meet_match = re.search(r"https://meet\.google\.com/\S+", desc)
        if meet_match:
            return meet_match.group(0)

    return None


def _extract_company_and_role(title: str, description: str | None) -> tuple[str | None, str | None]:
    company = None
    role = None
    t = title.strip()

    # "Interview with Retell AI" / "Interview with Acme Corp"
    m = re.match(r"interview\s+(?:with|at|@)\s+(.+?)(?:\s*[-|:]\s*(.+))?$", t, re.IGNORECASE)
    if m:
        company = m.group(1).strip()
        if m.group(2):
            role = m.group(2).strip()
        return company, role

    # "Interview Confirmation — Plaud.ai| Technical Product Marketing Manager"
    m = re.match(r"interview\s+\w+\s*[-–—]\s*(.+?)\|\s*(.+)$", t, re.IGNORECASE)
    if m:
        company = m.group(1).strip()
        role = m.group(2).strip()
        return company, role

    # "Plaud.ai | Technical Product Marketing Manager - Interview"
    m = re.match(r"^(.+?)\s*[-|]\s*(.+?)\s*[-–—]\s*interview", t, re.IGNORECASE)
    if m:
        company = m.group(1).strip()
        role = m.group(2).strip()
        return company, role

    # "[Company] - Interview" / "[Company] — Interview"
    m = re.match(r"^(.+?)\s*[-–—]\s*interview", t, re.IGNORECASE)
    if m:
        candidate = m.group(1).strip()
        if len(candidate.split()) <= 4:
            company = candidate

    # "Interview: Role at Company" / "Interview - Role at Company"
    m = re.match(r"interview\s*[-:–—]\s*(.+?)\s+(?:at|@)\s+(.+)$", t, re.IGNORECASE)
    if m:
        role = m.group(1).strip()
        company = m.group(2).strip()
        return company, role

    return company, role


def _is_interview_event(event: dict, config: Config) -> bool:
    title = event.get("summary", "").lower()
    description = (event.get("description") or "").lower()

    if "interview" in title:
        return True

    if config.user_name and config.user_name.lower() in title:
        return True

    if "interview" in description:
        attendees = event.get("attendees", [])
        for attendee in attendees:
            email = attendee.get("email", "")
            domain = email.split("@")[1].lower() if "@" in email else ""
            if domain in RECRUITING_DOMAINS:
                return True
        if any(kw in title.lower() for kw in ["screen", "chat", "meet", "call"]):
            return True

    attendees = event.get("attendees", [])
    for attendee in attendees:
        email = attendee.get("email", "")
        domain = email.split("@")[1].lower() if "@" in email else ""
        if domain in RECRUITING_DOMAINS:
            if any(kw in title.lower() for kw in ["screen", "chat", "meet", "call", "interview"]):
                return True

    return False


def _parse_event(event: dict, config: Config) -> InterviewEvent:
    attendees = []
    for a in event.get("attendees", []):
        attendees.append(Attendee(
            email=a.get("email", ""),
            name=a.get("displayName"),
            is_organizer=a.get("organizer", False),
        ))

    if not any(a.is_organizer for a in attendees) and "organizer" in event:
        org = event["organizer"]
        attendees.append(Attendee(
            email=org.get("email", ""),
            name=org.get("displayName"),
            is_organizer=True,
        ))

    title = event.get("summary", "")
    company, role = _extract_company_and_role(title, event.get("description"))

    ie = InterviewEvent(
        event_id=event["id"],
        title=title,
        start_time=parse_datetime(event["start"]),
        end_time=parse_datetime(event["end"]),
        description=event.get("description"),
        location=event.get("location"),
        video_link=_extract_video_link(event),
        calendar_link=event.get("htmlLink"),
        attendees=attendees,
        interview_type=_detect_interview_type(title, event.get("description")),
        company_name=company,
        role_title=role,
    )

    if not ie.company_name:
        domains = ie.non_personal_domains
        if domains:
            ie.company_name = domains[0].split(".")[0].title()

    return ie


def get_interview_events(
    calendar_service, config: Config, days: int | None = None
) -> list[InterviewEvent]:
    look_ahead = days or config.look_ahead_days
    now = datetime.now(timezone.utc)
    time_max = now + timedelta(days=look_ahead)

    logger.info("Scanning calendar for next %d days...", look_ahead)

    events_result = (
        calendar_service.events()
        .list(
            calendarId="primary",
            timeMin=now.isoformat(),
            timeMax=time_max.isoformat(),
            singleEvents=True,
            orderBy="startTime",
            maxResults=100,
        )
        .execute()
    )

    all_events = events_result.get("items", [])
    logger.info("Found %d total calendar events", len(all_events))

    interview_events = []
    for event in all_events:
        if _is_interview_event(event, config):
            parsed = _parse_event(event, config)
            interview_events.append(parsed)
            logger.info("  Interview found: %s (%s)", parsed.title, parsed.start_time.strftime("%Y-%m-%d %H:%M"))

    logger.info("Found %d interview event(s)", len(interview_events))
    return interview_events
