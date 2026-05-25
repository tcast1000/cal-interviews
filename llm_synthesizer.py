from __future__ import annotations

import json
import logging

import anthropic

from claude_api import FAST_MODEL, call_with_cached_system, truncate_snippet
from config import Config
from models import InterviewEvent, PrepDocument, ResearchResults

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an expert interview preparation coach. Your job is to help candidates excel in their upcoming interviews by providing thorough, actionable preparation materials.

You will receive details about an upcoming interview (company, role, interviewers) along with web research results. Synthesize everything into a comprehensive prep document.

Your output must be a JSON object with exactly these fields:
{
    "company_name": "string",
    "role_title": "string",
    "interview_date": "string (formatted nicely, e.g. 'Thursday, May 15, 2026')",
    "interview_time": "string (e.g. '2:00 PM EST')",
    "interview_location": "string (physical address or 'Virtual')",
    "video_link": "string or empty",
    "interviewer_names": ["list of interviewer names"],
    "company_overview": "2 paragraphs about the company: what they do, their mission, size, stage, culture, and anything notable. Write in a way that helps the candidate sound knowledgeable.",
    "values": ["4-6 short bullet items capturing the company's core values, principles, or cultural pillars, extracted from the COMPANY RESEARCH below. Each item is the value itself plus a brief gloss. If the research doesn't surface explicit values, infer them from mission/culture content and label them as inferred."],
    "products_and_services": ["4-5 bullet points listing the company's main products, services, or platforms (extracted from COMPANY RESEARCH). Each should be a brief description (1 sentence max)."],
    "competitors": ["3-4 direct competitors or closest alternatives (extracted from COMPANY RESEARCH). For each, include the company name and a short phrase on how they compete."],
    "recent_news": ["3-4 recent news items or developments, each 1 sentence"],
    "role_analysis": "2 paragraphs analyzing the role: key responsibilities, required skills, and how to frame experience to match. If the candidate provided a resume, reference specific experience that maps to the role.",
    "interviewer_backgrounds": {"interviewer name": "1 paragraph about their background, role, interests, and potential topics they might focus on"},
    "potential_questions": ["6 likely interview questions based on the role, company, and interview type. Tailored to the interview type (technical / behavioral / etc)."],
    "questions_to_ask": ["6 thoughtful questions the candidate should ask. Specific to this company/role — not generic."],
    "key_talking_points": ["4 specific talking points connecting the candidate's potential strengths to this role and company. Concrete and memorable."],
    "sheet_talking_points": ["3 punchy one-liners (max 12 words each) for a quick-glance cheat sheet. Concrete, actionable reminders — not generic platitudes. Example: 'Led 3x revenue growth at Series B stage', 'Mention migrating 2M users to microservices'."],
    "compensation": {
        "base_range": "estimated base salary range (e.g. '$150K–$180K'). Use data from levels.fyi, Glassdoor, or similar sources if available. If no data, give a reasonable market estimate and note it.",
        "total_comp_range": "estimated total compensation range including equity/bonus. Empty string if insufficient data.",
        "equity_notes": "brief note on equity structure if known. Empty string if unknown.",
        "source": "where the comp data came from (e.g. 'levels.fyi', 'Glassdoor', 'market estimate')",
        "notes": "any caveats — e.g. 'limited data points', 'comp varies significantly by level'"
    },
    "sources": ["list of URLs used in research"],
    "interview_type": "string (e.g. 'Technical', 'Behavioral', 'Phone Screen')"
}

Guidelines:
- Be specific, not generic. Every talking point and question should reference something about THIS company or role.
- products_and_services, competitors, and values are all extracted from the same COMPANY RESEARCH block — read the research carefully and pull each category out separately.
- Tailor potential_questions to the interview type (technical = coding/design; behavioral = STAR-format; etc.).
- sheet_talking_points are NOT a copy of key_talking_points. Ultra-short sticky-note bullets only.
- compensation: prefer levels.fyi, then Glassdoor, then market estimate. Don't fabricate numbers — if data is thin, say so and widen the range.
- Return ONLY the JSON object, no other text."""

ROUND_ADDENDUM = """

MULTI-ROUND CONTEXT: This is round {round_number} for this candidate at this company. Prior rounds and the candidate's debrief notes from them are provided below. Use this context to:
- Skip ground already covered. Don't repeat questions or talking points the candidate has already used.
- Build on what was discussed. Reference unfinished threads, follow-ups the interviewer requested, or topics the candidate flagged in their notes.
- Recalibrate for the new interviewer. The person interviewing this round is different from prior rounds. Tailor questions, talking points, and interviewer background analysis specifically to THIS round's interviewer and interview type.
- Keep all standard sections (company overview, products, competitors, etc.) — the candidate may want to re-review them, but make them tighter and only emphasize what's most relevant to this round."""

RESUME_ADDENDUM = """

The candidate has provided their resume/background for personalization:

{resume}

Use this to create highly specific talking points that connect their actual experience to this role."""

DEBRIEF_SUMMARY_PROMPT = """You are condensing a job candidate's post-interview debrief notes into a quick-scan summary for use in preparing for the next round.

Below are debrief notes from {num_rounds} prior interview round(s) with the same company. For each round, produce 2-3 short bullets that capture:
- What was actually discussed (topics, themes, anything notable)
- Open threads or follow-ups the interviewer asked the candidate to come back on
- Anything the candidate flagged that should shape the next round (e.g. "didn't get to talk about X", "asked me about Y, want to expand")

Prior round notes:
{notes}

Return a JSON object with this shape:
{{
    "summary": [
        "Round 1 (Phone Screen, May 10): bullet about what happened",
        "Round 1 (Phone Screen, May 10): another bullet",
        "Round 2 (Technical, May 15): bullet about what happened"
    ]
}}

Each bullet should be one short line, prefixed with the round/stage/date label as shown. Return ONLY the JSON, no other text."""


def _build_research_context(event: InterviewEvent, research: ResearchResults, prep_doc: PrepDocument | None = None) -> str:
    sections = []

    sections.append(f"EVENT DETAILS:")
    sections.append(f"  Title: {event.title}")
    sections.append(f"  Date: {event.start_time.strftime('%A, %B %d, %Y')}")
    sections.append(f"  Time: {event.start_time.strftime('%I:%M %p')}")
    sections.append(f"  Location: {event.location or 'Not specified'}")
    sections.append(f"  Video Link: {event.video_link or 'None'}")
    sections.append(f"  Company: {event.company_name or 'Unknown'}")
    sections.append(f"  Role: {event.role_title or 'Unknown'}")
    sections.append(f"  Interview Type: {event.interview_type}")
    sections.append(f"  Description: {event.description or 'None'}")

    if event.interviewers:
        sections.append(f"\nINTERVIEWERS (this round):")
        for i in event.interviewers:
            sections.append(f"  - {i.name} ({i.title or 'title unknown'}) — {i.email or 'email unknown'}")

    if event.preparation_instructions:
        sections.append(f"\nPREPARATION INSTRUCTIONS FROM EMAILS:")
        sections.append(f"  {event.preparation_instructions}")

    if prep_doc and prep_doc.previous_rounds_summary:
        sections.append(f"\nPRIOR ROUND SUMMARY (this is round {prep_doc.round_number}):")
        for bullet in prep_doc.previous_rounds_summary:
            sections.append(f"  - {bullet}")

    if prep_doc and prep_doc.previous_rounds_appendix:
        sections.append(f"\nPRIOR ROUND DEBRIEF NOTES (full text):")
        for entry in prep_doc.previous_rounds_appendix:
            sections.append(f"  [{entry.get('stage_type', 'Round')} — {entry.get('date', '')}]:")
            sections.append(f"  {entry.get('notes', '')}")

    combined_company = list(research.company_info) + list(research.products_and_services) + list(research.competitors) + list(research.values_info)
    if combined_company:
        sections.append(f"\nCOMPANY RESEARCH (use this to extract overview, products, competitors, and values):")
        seen_urls = set()
        for r in combined_company:
            if r.url and r.url in seen_urls:
                continue
            seen_urls.add(r.url)
            sections.append(f"  [{r.title}]({r.url})")
            sections.append(f"  {truncate_snippet(r.snippet)}")

    if research.company_news:
        sections.append(f"\nRECENT NEWS:")
        for r in research.company_news:
            sections.append(f"  [{r.title}]({r.url})")
            sections.append(f"  {truncate_snippet(r.snippet)}")

    if research.role_info:
        sections.append(f"\nROLE RESEARCH:")
        for r in research.role_info:
            sections.append(f"  [{r.title}]({r.url})")
            sections.append(f"  {truncate_snippet(r.snippet)}")

    if research.interviewer_info:
        current_round_names = {i.name for i in event.interviewers if i.name}
        relevant = {n: r for n, r in research.interviewer_info.items() if n in current_round_names} if current_round_names else research.interviewer_info
        if relevant:
            sections.append(f"\nINTERVIEWER RESEARCH (this round only):")
            for name, results in relevant.items():
                sections.append(f"  {name}:")
                for r in results:
                    sections.append(f"    [{r.title}]({r.url})")
                    sections.append(f"    {truncate_snippet(r.snippet)}")

    if research.glassdoor_info:
        sections.append(f"\nINTERVIEW TIPS & GLASSDOOR:")
        for r in research.glassdoor_info:
            sections.append(f"  [{r.title}]({r.url})")
            sections.append(f"  {truncate_snippet(r.snippet)}")

    if research.compensation_info:
        sections.append(f"\nCOMPENSATION RESEARCH:")
        for r in research.compensation_info:
            sections.append(f"  [{r.title}]({r.url})")
            sections.append(f"  {truncate_snippet(r.snippet)}")

    if research.social_links:
        sections.append(f"\nOFFICIAL SOCIAL MEDIA:")
        for platform, url in research.social_links.items():
            sections.append(f"  {platform}: {url}")

    if research.job_description_url:
        sections.append(f"\nJOB DESCRIPTION LINK ({research.job_description_source}): {research.job_description_url}")

    return "\n".join(sections)


def summarize_prior_debriefs(
    prior_stages: list[dict],
    anthropic_client: anthropic.Anthropic,
    config: Config,
) -> tuple[list[str], list[dict]]:
    appendix = []
    notes_blob_parts = []
    for s in prior_stages:
        debrief_text = s.get("debrief") or ""
        date = s.get("event_date", "")
        date_label = date[:10] if date else ""
        stage_type = s.get("stage_type", "Round")
        appendix.append({
            "stage_type": stage_type,
            "date": date_label,
            "notes": debrief_text if debrief_text else "(no debrief notes saved)",
        })
        if debrief_text:
            notes_blob_parts.append(f"[{stage_type} — {date_label}]\n{debrief_text}")

    if not notes_blob_parts:
        summary = [
            f"{a['stage_type']} on {a['date']}: no debrief notes recorded — run --debrief --company X --notes \"...\" to add them"
            for a in appendix
        ]
        return summary, appendix

    if len(notes_blob_parts) == 1:
        only = appendix[0]
        return [f"{only['stage_type']} on {only['date']}: see appendix for full notes"], appendix

    prompt = DEBRIEF_SUMMARY_PROMPT.format(
        num_rounds=len(notes_blob_parts),
        notes="\n\n---\n\n".join(notes_blob_parts),
    )

    try:
        response = anthropic_client.messages.create(
            model=FAST_MODEL,
            max_tokens=600,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        data = json.loads(text)
        summary = data.get("summary", [])
        if not isinstance(summary, list):
            summary = []
        logger.info("Summarized %d prior round(s) into %d bullets", len(prior_stages), len(summary))
        return summary, appendix
    except Exception as e:
        logger.warning("Prior-debrief summarization failed: %s", e)
        fallback = [
            f"{a['stage_type']} on {a['date']}: see appendix for full notes"
            for a in appendix
        ]
        return fallback, appendix


def synthesize_prep(
    event: InterviewEvent,
    research: ResearchResults,
    anthropic_client: anthropic.Anthropic,
    config: Config,
    round_number: int = 1,
    previous_rounds_summary: list[str] | None = None,
    previous_rounds_appendix: list[dict] | None = None,
) -> PrepDocument:
    logger.info("Synthesizing prep materials with Claude (round %d)...", round_number)

    system = SYSTEM_PROMPT
    if round_number > 1:
        system += ROUND_ADDENDUM.format(round_number=round_number)
    if config.resume_text:
        system += RESUME_ADDENDUM.format(resume=config.resume_text)

    pre_prep = PrepDocument(
        company_name="", role_title="", interview_date="", interview_time="",
        interview_location="", video_link="", interviewer_names=[],
        company_overview="", products_and_services=[], competitors=[],
        recent_news=[], role_analysis="", interviewer_backgrounds={},
        potential_questions=[], questions_to_ask=[], key_talking_points=[],
        sheet_talking_points=[], compensation={}, sources=[],
        round_number=round_number,
        previous_rounds_summary=previous_rounds_summary or [],
        previous_rounds_appendix=previous_rounds_appendix or [],
    )
    user_content = _build_research_context(event, research, pre_prep)

    response = call_with_cached_system(
        anthropic_client,
        model=config.claude_model,
        system_prompt=system,
        user_content=user_content,
        max_tokens=2500,
    )

    text = response.content[0].text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()

    try:
        data = json.loads(text)
        prep = PrepDocument.from_dict(data)
    except (json.JSONDecodeError, KeyError) as e:
        logger.error("Failed to parse Claude response as JSON: %s", e)
        logger.debug("Raw response: %s", text[:500])
        prep = PrepDocument(
            company_name=event.company_name or "Unknown Company",
            role_title=event.role_title or "Unknown Role",
            interview_date=event.start_time.strftime("%A, %B %d, %Y"),
            interview_time=event.start_time.strftime("%I:%M %p"),
            interview_location=event.location or "Virtual",
            video_link=event.video_link or "",
            interviewer_names=[i.name for i in event.interviewers],
            company_overview="Research synthesis failed. Please review raw research data.",
            products_and_services=[],
            competitors=[],
            recent_news=[],
            role_analysis="Could not synthesize role analysis.",
            interviewer_backgrounds={},
            potential_questions=["Tell me about yourself.", "Why this company?", "Why this role?"],
            questions_to_ask=["What does a typical day look like?", "What are the team's priorities?"],
            key_talking_points=["Review raw research and prepare your own talking points."],
            sheet_talking_points=["Review prep doc"],
            compensation={},
            sources=[],
            interview_type=event.interview_type,
        )

    prep.round_number = round_number
    prep.previous_rounds_summary = previous_rounds_summary or []
    prep.previous_rounds_appendix = previous_rounds_appendix or []
    if not prep.social_links and research.social_links:
        prep.social_links = dict(research.social_links)
    if not prep.job_description_url and research.job_description_url:
        prep.job_description_url = research.job_description_url
        prep.job_description_source = research.job_description_source

    logger.info("Synthesis complete: %s — %s (round %d)", prep.company_name, prep.role_title, round_number)
    usage = response.usage
    logger.info("  Token usage: %d input, %d output", usage.input_tokens, usage.output_tokens)

    return prep
