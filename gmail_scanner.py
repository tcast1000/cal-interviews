from __future__ import annotations

import base64
import logging

import anthropic

from config import Config
from models import InterviewEvent, InterviewerDetail
from utils import clean_html, extract_domain

logger = logging.getLogger(__name__)

MAX_THREADS = 5
MAX_SNIPPET_CHARS = 2000


def _search_gmail(gmail_service, query: str, max_results: int = 5) -> list[dict]:
    try:
        result = gmail_service.users().messages().list(
            userId="me", q=query, maxResults=max_results
        ).execute()
        return result.get("messages", [])
    except Exception as e:
        logger.warning("Gmail search failed for '%s': %s", query, e)
        return []


def _get_message_body(gmail_service, message_id: str) -> str:
    try:
        msg = gmail_service.users().messages().get(
            userId="me", id=message_id, format="full"
        ).execute()

        payload = msg.get("payload", {})
        body_text = ""

        if "parts" in payload:
            for part in payload["parts"]:
                if part.get("mimeType") == "text/plain":
                    data = part.get("body", {}).get("data", "")
                    if data:
                        body_text = base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
                        break
                elif part.get("mimeType") == "text/html":
                    data = part.get("body", {}).get("data", "")
                    if data:
                        html = base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
                        body_text = clean_html(html)
        else:
            data = payload.get("body", {}).get("data", "")
            if data:
                raw = base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
                if payload.get("mimeType") == "text/html":
                    body_text = clean_html(raw)
                else:
                    body_text = raw

        headers = {h["name"].lower(): h["value"] for h in payload.get("headers", [])}
        subject = headers.get("subject", "")
        sender = headers.get("from", "")

        return f"From: {sender}\nSubject: {subject}\n\n{body_text[:MAX_SNIPPET_CHARS]}"

    except Exception as e:
        logger.warning("Failed to read message %s: %s", message_id, e)
        return ""


def _build_search_queries(event: InterviewEvent) -> list[str]:
    queries = []

    domains = event.non_personal_domains
    for domain in domains[:2]:
        queries.append(f"from:({domain}) subject:(interview OR schedule OR confirmation) newer_than:30d")

    if event.company_name:
        queries.append(f"{event.company_name} (interview OR schedule OR confirmation) newer_than:30d")

    for attendee in event.attendees:
        if attendee.email and not attendee.is_organizer:
            domain = extract_domain(attendee.email)
            if domain:
                queries.append(f"from:{attendee.email} newer_than:30d")

    if not queries:
        title_words = [w for w in event.title.split() if len(w) > 3 and w.lower() != "interview"]
        if title_words:
            queries.append(f"{' '.join(title_words[:3])} interview newer_than:30d")

    return queries


EXTRACTION_PROMPT = """You are extracting interview details from email content. Given the following email snippets related to a calendar event titled "{title}", extract structured information.

Return a JSON object with these fields (use null for anything you can't determine):
{{
    "company_name": "the company conducting the interview",
    "role_title": "the job title/role being interviewed for",
    "interview_type": "one of: Phone Screen, Technical, Behavioral, Panel, Final Round, Hiring Manager, or Interview",
    "interviewers": [
        {{"name": "interviewer name", "email": "their email", "title": "their job title"}}
    ],
    "preparation_instructions": "any specific prep instructions mentioned in the emails"
}}

Email snippets:
{snippets}

Return ONLY the JSON object, no other text."""


def enrich_from_gmail(
    gmail_service,
    event: InterviewEvent,
    anthropic_client: anthropic.Anthropic,
    config: Config,
) -> InterviewEvent:
    logger.info("Searching Gmail for context on: %s", event.title)

    queries = _build_search_queries(event)
    if not queries:
        logger.info("No Gmail search queries could be built for this event")
        return event

    all_snippets = []
    seen_ids = set()

    for query in queries:
        if len(all_snippets) >= MAX_THREADS:
            break
        messages = _search_gmail(gmail_service, query)
        for msg in messages:
            if msg["id"] not in seen_ids and len(all_snippets) < MAX_THREADS:
                seen_ids.add(msg["id"])
                body = _get_message_body(gmail_service, msg["id"])
                if body.strip():
                    all_snippets.append(body)

    if not all_snippets:
        logger.info("No relevant emails found")
        return event

    logger.info("Found %d relevant email(s), extracting details with Claude...", len(all_snippets))

    snippets_text = "\n\n---\n\n".join(all_snippets)
    prompt = EXTRACTION_PROMPT.format(title=event.title, snippets=snippets_text)

    try:
        response = anthropic_client.messages.create(
            model=config.claude_model,
            max_tokens=1000,
            messages=[{"role": "user", "content": prompt}],
        )

        import json
        text = response.content[0].text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        data = json.loads(text)

        if data.get("company_name") and not event.company_name:
            event.company_name = data["company_name"]
        if data.get("role_title") and not event.role_title:
            event.role_title = data["role_title"]
        if data.get("interview_type") and event.interview_type == "Interview":
            event.interview_type = data["interview_type"]
        if data.get("preparation_instructions"):
            event.preparation_instructions = data["preparation_instructions"]
        if data.get("interviewers"):
            for i in data["interviewers"]:
                if i.get("name"):
                    event.interviewers.append(InterviewerDetail(
                        name=i["name"],
                        email=i.get("email"),
                        title=i.get("title"),
                    ))

        logger.info("Gmail enrichment complete — company: %s, role: %s",
                     event.company_name, event.role_title)

    except Exception as e:
        logger.warning("Claude extraction from emails failed: %s", e)

    return event
