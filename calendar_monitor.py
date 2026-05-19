from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone

from config import Config
from models import Attendee, InterviewEvent
from utils import parse_datetime

logger = logging.getLogger(__name__)

DEFAULT_RECRUITING_DOMAINS = {
    "greenhouse.io", "lever.co", "ashbyhq.com", "goodtime.io",
    "calendly.com", "hire.lever.co", "app.greenhouse.io",
    "resource.io", "modernloop.com", "prelude.co", "gem.com",
    "brighthire.ai", "metaview.ai",
    "icims.com", "workday.com", "smartrecruiters.com",
    "rippling.com", "bamboohr.com", "jobvite.com",
    "myworkdayjobs.com", "hirebridge.com", "breezy.hr",
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


SOFT_KEYWORDS = [
    "screen", "chat", "meet", "call", "interview",
    "discussion", "intro", "conversation", "debrief", "1:1",
    "one on one", "phone", "virtual", "video",
]


def _get_recruiting_domains(config: Config) -> set[str]:
    return DEFAULT_RECRUITING_DOMAINS | config.extra_recruiting_domains


def _get_attendee_domains(event: dict) -> list[str]:
    domains = []
    for attendee in event.get("attendees", []):
        email = attendee.get("email", "")
        if "@" in email:
            domains.append(email.split("@")[1].lower())
    return domains


def _is_cancelled_or_declined(event: dict) -> bool:
    if event.get("status") == "cancelled":
        return True
    for attendee in event.get("attendees", []):
        if attendee.get("self") and attendee.get("responseStatus") == "declined":
            return True
    return False


def _is_interview_event(event: dict, config: Config) -> bool:
    title = event.get("summary", "").lower()
    description = (event.get("description") or "").lower()
    recruiting_domains = _get_recruiting_domains(config)
    attendee_domains = _get_attendee_domains(event)
    has_recruiting_attendee = any(d in recruiting_domains for d in attendee_domains)

    if "interview" in title:
        return True

    names_to_check = []
    if config.user_name:
        names_to_check.append(config.user_name.lower())
    names_to_check.extend(alias.lower() for alias in config.user_aliases)
    if any(name in title for name in names_to_check):
        return True

    if config.extra_match_keywords and any(kw in title for kw in config.extra_match_keywords):
        return True

    soft_match = any(kw in title for kw in SOFT_KEYWORDS)

    if "interview" in description:
        if has_recruiting_attendee or soft_match:
            return True

    if has_recruiting_attendee and soft_match:
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
        updated=event.get("updated"),
    )

    if not ie.company_name:
        domains = ie.non_personal_domains
        if domains:
            ie.company_name = domains[0].split(".")[0].title()

    return ie


def _fetch_all_events(calendar_service, calendar_id: str, time_min: str, time_max: str) -> list[dict]:
    all_events: list[dict] = []
    page_token = None
    while True:
        result = (
            calendar_service.events()
            .list(
                calendarId=calendar_id,
                timeMin=time_min,
                timeMax=time_max,
                singleEvents=True,
                orderBy="startTime",
                maxResults=250,
                pageToken=page_token,
            )
            .execute()
        )
        all_events.extend(result.get("items", []))
        page_token = result.get("nextPageToken")
        if not page_token:
            break
    return all_events


def get_interview_events(
    calendar_service, config: Config, days: int | None = None
) -> list[InterviewEvent]:
    look_ahead = days or config.look_ahead_days
    now = datetime.now(timezone.utc)
    time_max = now + timedelta(days=look_ahead)

    logger.info("Scanning %d calendar(s) for next %d days...", len(config.calendar_ids), look_ahead)

    all_events: list[dict] = []
    for cal_id in config.calendar_ids:
        try:
            cal_events = _fetch_all_events(
                calendar_service, cal_id, now.isoformat(), time_max.isoformat()
            )
            logger.info("  Calendar '%s': %d events", cal_id, len(cal_events))
            all_events.extend(cal_events)
        except Exception as e:
            logger.warning("  Calendar '%s' failed: %s", cal_id, e)

    logger.info("Found %d total calendar events across all calendars", len(all_events))

    seen_ids: set[str] = set()
    interview_events = []
    for event in all_events:
        event_id = event.get("id", "")
        if event_id in seen_ids:
            continue
        seen_ids.add(event_id)

        if _is_cancelled_or_declined(event):
            logger.debug("  Skipping cancelled/declined: %s", event.get("summary", ""))
            continue

        if _is_interview_event(event, config):
            parsed = _parse_event(event, config)
            interview_events.append(parsed)
            logger.info("  Interview found: %s (%s)", parsed.title, parsed.start_time.strftime("%Y-%m-%d %H:%M"))

    interview_events.sort(key=lambda e: e.start_time)
    logger.info("Found %d interview event(s)", len(interview_events))
    return interview_events
