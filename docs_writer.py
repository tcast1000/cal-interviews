from __future__ import annotations

import logging

from config import Config
from models import PrepDocument

logger = logging.getLogger(__name__)


def create_prep_doc(
    docs_service, drive_service, prep: PrepDocument, config: Config
) -> str:
    title = _build_title(prep)
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

    _section_quick_reference(docs_service, doc_id, prep)
    if prep.round_number > 1:
        _section_previous_rounds(docs_service, doc_id, prep)
    _section_company_overview(docs_service, doc_id, prep)
    if prep.social_links:
        _section_social_media(docs_service, doc_id, prep)
    if prep.values:
        _section_company_values(docs_service, doc_id, prep)
    if prep.job_description_url:
        _section_job_description(docs_service, doc_id, prep)
    if prep.products_and_services:
        _section_products(docs_service, doc_id, prep)
    if prep.competitors:
        _section_competitors(docs_service, doc_id, prep)
    if prep.recent_news:
        _section_recent_news(docs_service, doc_id, prep)
    _section_role_analysis(docs_service, doc_id, prep)
    if prep.interviewer_backgrounds:
        _section_interviewer_backgrounds(docs_service, doc_id, prep)
    if prep.potential_questions:
        _section_potential_questions(docs_service, doc_id, prep)
    if prep.questions_to_ask:
        _section_questions_to_ask(docs_service, doc_id, prep)
    if prep.compensation and any(prep.compensation.get(k) for k in ("base_range", "total_comp_range")):
        _section_compensation(docs_service, doc_id, prep)
    if prep.key_talking_points:
        _section_talking_points(docs_service, doc_id, prep)
    if prep.round_number > 1 and prep.previous_rounds_appendix:
        _section_prior_round_appendix(docs_service, doc_id, prep)
    if prep.sources:
        _section_sources(docs_service, doc_id, prep)

    logger.info("Doc created: %s", doc_url)
    return doc_url


def _build_title(prep: PrepDocument) -> str:
    if prep.round_number > 1:
        return f"{prep.company_name} — Round {prep.round_number} ({prep.interview_type}) — {prep.interview_date}"
    return f"{prep.company_name} - {prep.role_title} Interview Prep - {prep.interview_date}"


def _end_index(docs_service, doc_id: str) -> int:
    d = docs_service.documents().get(documentId=doc_id, fields="body.content(endIndex)").execute()
    return d["body"]["content"][-1]["endIndex"] - 1


def _insert_elements(docs_service, doc_id: str, elements: list[dict]) -> None:
    if not elements:
        return
    offset = _end_index(docs_service, doc_id)
    requests = []
    for element in elements:
        etype = element["type"]
        text = element["text"]
        if not text:
            continue
        requests.append({
            "insertText": {"location": {"index": offset}, "text": text}
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
    if requests:
        docs_service.documents().batchUpdate(
            documentId=doc_id, body={"requests": requests}
        ).execute()


def _insert_two_col_table(docs_service, doc_id: str, pairs: list[tuple[str, str]]) -> None:
    n_rows = len(pairs)
    if n_rows == 0:
        return

    idx = _end_index(docs_service, doc_id)
    docs_service.documents().batchUpdate(
        documentId=doc_id,
        body={"requests": [{
            "insertTable": {"location": {"index": idx}, "rows": n_rows, "columns": 2}
        }]},
    ).execute()

    doc_state = docs_service.documents().get(documentId=doc_id).execute()
    table_elem = None
    for elem in reversed(doc_state["body"]["content"]):
        if "table" in elem:
            table_elem = elem
            break
    if not table_elem:
        return

    inserts: list[tuple[int, str, bool]] = []
    for r_idx, row in enumerate(table_elem["table"]["tableRows"]):
        for c_idx, cell in enumerate(row["tableCells"]):
            text = pairs[r_idx][c_idx] if r_idx < len(pairs) and c_idx < 2 else ""
            if not text:
                continue
            content_para = cell["content"][0]
            insert_at = content_para["startIndex"]
            inserts.append((insert_at, text, c_idx == 0))

    inserts.sort(key=lambda x: x[0], reverse=True)
    requests = []
    for at, text, bold in inserts:
        requests.append({
            "insertText": {"location": {"index": at}, "text": text}
        })
        if bold:
            requests.append({
                "updateTextStyle": {
                    "range": {"startIndex": at, "endIndex": at + len(text)},
                    "textStyle": {"bold": True},
                    "fields": "bold",
                }
            })
    if requests:
        docs_service.documents().batchUpdate(
            documentId=doc_id, body={"requests": requests}
        ).execute()

    _insert_elements(docs_service, doc_id, [{"type": "body", "text": "\n"}])


def _section_quick_reference(docs_service, doc_id, prep):
    elements = [{"type": "heading1", "text": "Quick Reference\n"}]
    if prep.round_number > 1:
        elements.append({"type": "bold_line", "text": f"Round: {prep.round_number}\n"})
    elements.append({"type": "bold_line", "text": f"Date: {prep.interview_date}\n"})
    elements.append({"type": "bold_line", "text": f"Time: {prep.interview_time}\n"})
    elements.append({"type": "bold_line", "text": f"Type: {prep.interview_type}\n"})
    if prep.interview_location:
        elements.append({"type": "bold_line", "text": f"Location: {prep.interview_location}\n"})
    if prep.video_link:
        elements.append({"type": "body", "text": f"Video Link: {prep.video_link}\n"})
    if prep.interviewer_names:
        names = ", ".join(prep.interviewer_names)
        elements.append({"type": "bold_line", "text": f"Interviewer(s): {names}\n"})
    elements.append({"type": "body", "text": "\n"})
    _insert_elements(docs_service, doc_id, elements)


def _section_previous_rounds(docs_service, doc_id, prep):
    elements = [{"type": "heading1", "text": f"Round {prep.round_number} Context\n"}]
    if prep.previous_rounds_summary:
        elements.append({"type": "body", "text": "Key takeaways and open threads from prior rounds:\n"})
        for bullet in prep.previous_rounds_summary:
            elements.append({"type": "body", "text": f"• {bullet}\n"})
    else:
        elements.append({
            "type": "body",
            "text": "No prior debrief notes saved yet. Run `python main.py --debrief --company <name> --notes \"...\"` after each round to build this section.\n",
        })
    elements.append({"type": "body", "text": "\n"})
    _insert_elements(docs_service, doc_id, elements)


def _section_company_overview(docs_service, doc_id, prep):
    _insert_elements(docs_service, doc_id, [
        {"type": "heading1", "text": "Company Overview\n"},
        {"type": "body", "text": f"{prep.company_overview}\n\n"},
    ])


def _section_social_media(docs_service, doc_id, prep):
    _insert_elements(docs_service, doc_id, [
        {"type": "heading1", "text": "Social Media\n"},
    ])
    pairs = [(p, prep.social_links[p]) for p in prep.social_links.keys()]
    _insert_two_col_table(docs_service, doc_id, pairs)


def _section_company_values(docs_service, doc_id, prep):
    elements = [{"type": "heading1", "text": "Company Values\n"}]
    for v in prep.values:
        elements.append({"type": "body", "text": f"• {v}\n"})
    elements.append({"type": "body", "text": "\n"})
    _insert_elements(docs_service, doc_id, elements)


def _section_job_description(docs_service, doc_id, prep):
    elements = [{"type": "heading1", "text": "Job Description\n"}]
    if prep.job_description_source:
        elements.append({"type": "bold_line", "text": f"Source: {prep.job_description_source}\n"})
    elements.append({"type": "body", "text": f"{prep.job_description_url}\n\n"})
    _insert_elements(docs_service, doc_id, elements)


def _section_products(docs_service, doc_id, prep):
    elements = [{"type": "heading1", "text": "Products & Services\n"}]
    for item in prep.products_and_services:
        elements.append({"type": "body", "text": f"• {item}\n"})
    elements.append({"type": "body", "text": "\n"})
    _insert_elements(docs_service, doc_id, elements)


def _section_competitors(docs_service, doc_id, prep):
    elements = [{"type": "heading1", "text": "Competitors\n"}]
    for item in prep.competitors:
        elements.append({"type": "body", "text": f"• {item}\n"})
    elements.append({"type": "body", "text": "\n"})
    _insert_elements(docs_service, doc_id, elements)


def _section_recent_news(docs_service, doc_id, prep):
    elements = [{"type": "heading1", "text": "Recent News\n"}]
    for item in prep.recent_news:
        elements.append({"type": "body", "text": f"• {item}\n"})
    elements.append({"type": "body", "text": "\n"})
    _insert_elements(docs_service, doc_id, elements)


def _section_role_analysis(docs_service, doc_id, prep):
    _insert_elements(docs_service, doc_id, [
        {"type": "heading1", "text": "Role Analysis\n"},
        {"type": "body", "text": f"{prep.role_analysis}\n\n"},
    ])


def _section_interviewer_backgrounds(docs_service, doc_id, prep):
    elements = [{"type": "heading1", "text": "Interviewer Backgrounds\n"}]
    for name, background in prep.interviewer_backgrounds.items():
        elements.append({"type": "heading2", "text": f"{name}\n"})
        elements.append({"type": "body", "text": f"{background}\n\n"})
    _insert_elements(docs_service, doc_id, elements)


def _section_potential_questions(docs_service, doc_id, prep):
    elements = [{"type": "heading1", "text": "Potential Interview Questions\n"}]
    for i, q in enumerate(prep.potential_questions, 1):
        elements.append({"type": "body", "text": f"{i}. {q}\n"})
    elements.append({"type": "body", "text": "\n"})
    _insert_elements(docs_service, doc_id, elements)


def _section_questions_to_ask(docs_service, doc_id, prep):
    elements = [{"type": "heading1", "text": "Questions to Ask\n"}]
    for i, q in enumerate(prep.questions_to_ask, 1):
        elements.append({"type": "body", "text": f"{i}. {q}\n"})
    elements.append({"type": "body", "text": "\n"})
    _insert_elements(docs_service, doc_id, elements)


def _section_compensation(docs_service, doc_id, prep):
    comp = prep.compensation
    elements = [{"type": "heading1", "text": "Compensation Context\n"}]
    if comp.get("base_range"):
        elements.append({"type": "bold_line", "text": f"Base Salary Range: {comp['base_range']}\n"})
    if comp.get("total_comp_range"):
        elements.append({"type": "bold_line", "text": f"Total Comp Range: {comp['total_comp_range']}\n"})
    if comp.get("equity_notes"):
        elements.append({"type": "body", "text": f"Equity: {comp['equity_notes']}\n"})
    if comp.get("source"):
        elements.append({"type": "body", "text": f"Source: {comp['source']}\n"})
    if comp.get("notes"):
        elements.append({"type": "body", "text": f"Notes: {comp['notes']}\n"})
    elements.append({"type": "body", "text": "\n"})
    _insert_elements(docs_service, doc_id, elements)


def _section_talking_points(docs_service, doc_id, prep):
    elements = [{"type": "heading1", "text": "Key Talking Points\n"}]
    for tp in prep.key_talking_points:
        elements.append({"type": "body", "text": f"★ {tp}\n\n"})
    _insert_elements(docs_service, doc_id, elements)


def _section_prior_round_appendix(docs_service, doc_id, prep):
    elements = [{"type": "heading1", "text": "Appendix: Prior Round Notes\n"}]
    for entry in prep.previous_rounds_appendix:
        label = f"{entry.get('stage_type', 'Round')} — {entry.get('date', '')}"
        elements.append({"type": "heading2", "text": f"{label}\n"})
        notes = entry.get("notes", "") or "(no notes saved)"
        elements.append({"type": "body", "text": f"{notes}\n\n"})
    _insert_elements(docs_service, doc_id, elements)


def _section_sources(docs_service, doc_id, prep):
    elements = [{"type": "heading1", "text": "Sources\n"}]
    for url in prep.sources:
        elements.append({"type": "body", "text": f"• {url}\n"})
    elements.append({"type": "body", "text": "\n"})
    _insert_elements(docs_service, doc_id, elements)
