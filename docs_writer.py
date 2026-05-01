from __future__ import annotations

import logging

from config import Config
from models import PrepDocument

logger = logging.getLogger(__name__)


def create_prep_doc(
    docs_service, drive_service, prep: PrepDocument, config: Config
) -> str:
    title = f"{prep.company_name} - {prep.role_title} Interview Prep - {prep.interview_date}"
    logger.info("Creating Google Doc: %s", title)

    doc = docs_service.documents().create(body={"title": title}).execute()
    doc_id = doc["documentId"]
    doc_url = f"https://docs.google.com/document/d/{doc_id}/edit"

    if config.drive_folder_id:
        try:
            drive_service.files().update(
                fileId=doc_id,
                addParents=config.drive_folder_id,
                fields="id, parents",
            ).execute()
        except Exception as e:
            logger.warning("Could not move doc to folder: %s", e)

    requests = _build_document_requests(prep)

    if requests:
        docs_service.documents().batchUpdate(
            documentId=doc_id, body={"requests": requests}
        ).execute()

    logger.info("Doc created: %s", doc_url)
    return doc_url


def _build_document_requests(prep: PrepDocument) -> list[dict]:
    sections = _build_sections(prep)

    requests = []
    offset = 1

    for section in sections:
        for element in section:
            etype = element["type"]
            text = element["text"]

            if not text:
                continue

            requests.append({
                "insertText": {
                    "location": {"index": offset},
                    "text": text,
                }
            })

            text_len = len(text)

            if etype == "heading1":
                requests.append({
                    "updateParagraphStyle": {
                        "range": {"startIndex": offset, "endIndex": offset + text_len},
                        "paragraphStyle": {"namedStyleType": "HEADING_1"},
                        "fields": "namedStyleType",
                    }
                })
            elif etype == "heading2":
                requests.append({
                    "updateParagraphStyle": {
                        "range": {"startIndex": offset, "endIndex": offset + text_len},
                        "paragraphStyle": {"namedStyleType": "HEADING_2"},
                        "fields": "namedStyleType",
                    }
                })
            elif etype == "heading3":
                requests.append({
                    "updateParagraphStyle": {
                        "range": {"startIndex": offset, "endIndex": offset + text_len},
                        "paragraphStyle": {"namedStyleType": "HEADING_3"},
                        "fields": "namedStyleType",
                    }
                })
            elif etype == "bold_line":
                requests.append({
                    "updateTextStyle": {
                        "range": {"startIndex": offset, "endIndex": offset + text_len - 1},
                        "textStyle": {"bold": True},
                        "fields": "bold",
                    }
                })

            offset += text_len

    return requests


def _build_sections(prep: PrepDocument) -> list[list[dict]]:
    sections = []

    # Quick Reference
    quick_ref = [{"type": "heading1", "text": "Quick Reference\n"}]
    quick_ref.append({"type": "bold_line", "text": f"Date: {prep.interview_date}\n"})
    quick_ref.append({"type": "bold_line", "text": f"Time: {prep.interview_time}\n"})
    quick_ref.append({"type": "bold_line", "text": f"Type: {prep.interview_type}\n"})
    if prep.interview_location:
        quick_ref.append({"type": "bold_line", "text": f"Location: {prep.interview_location}\n"})
    if prep.video_link:
        quick_ref.append({"type": "body", "text": f"Video Link: {prep.video_link}\n"})
    if prep.interviewer_names:
        names = ", ".join(prep.interviewer_names)
        quick_ref.append({"type": "bold_line", "text": f"Interviewer(s): {names}\n"})
    quick_ref.append({"type": "body", "text": "\n"})
    sections.append(quick_ref)

    # Company Overview
    company = [{"type": "heading1", "text": "Company Overview\n"}]
    company.append({"type": "body", "text": f"{prep.company_overview}\n\n"})
    sections.append(company)

    # Recent News
    if prep.recent_news:
        news = [{"type": "heading1", "text": "Recent News\n"}]
        for item in prep.recent_news:
            news.append({"type": "body", "text": f"• {item}\n"})
        news.append({"type": "body", "text": "\n"})
        sections.append(news)

    # Role Analysis
    role = [{"type": "heading1", "text": "Role Analysis\n"}]
    role.append({"type": "body", "text": f"{prep.role_analysis}\n\n"})
    sections.append(role)

    # Interviewer Backgrounds
    if prep.interviewer_backgrounds:
        interviewers = [{"type": "heading1", "text": "Interviewer Backgrounds\n"}]
        for name, background in prep.interviewer_backgrounds.items():
            interviewers.append({"type": "heading2", "text": f"{name}\n"})
            interviewers.append({"type": "body", "text": f"{background}\n\n"})
        sections.append(interviewers)

    # Potential Interview Questions
    if prep.potential_questions:
        questions = [{"type": "heading1", "text": "Potential Interview Questions\n"}]
        for i, q in enumerate(prep.potential_questions, 1):
            questions.append({"type": "body", "text": f"{i}. {q}\n"})
        questions.append({"type": "body", "text": "\n"})
        sections.append(questions)

    # Questions to Ask
    if prep.questions_to_ask:
        ask = [{"type": "heading1", "text": "Questions to Ask\n"}]
        for i, q in enumerate(prep.questions_to_ask, 1):
            ask.append({"type": "body", "text": f"{i}. {q}\n"})
        ask.append({"type": "body", "text": "\n"})
        sections.append(ask)

    # Key Talking Points
    if prep.key_talking_points:
        talking = [{"type": "heading1", "text": "Key Talking Points\n"}]
        for tp in prep.key_talking_points:
            talking.append({"type": "body", "text": f"★ {tp}\n\n"})
        sections.append(talking)

    # Sources
    if prep.sources:
        sources = [{"type": "heading1", "text": "Sources\n"}]
        for url in prep.sources:
            sources.append({"type": "body", "text": f"• {url}\n"})
        sources.append({"type": "body", "text": "\n"})
        sections.append(sources)

    return sections
