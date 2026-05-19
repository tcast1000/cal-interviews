from __future__ import annotations

import json
import logging

import anthropic

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
    "company_overview": "2-3 paragraphs about the company: what they do, their mission, size, stage, culture, and anything notable. Write in a way that helps the candidate sound knowledgeable.",
    "products_and_services": ["4-6 bullet points listing the company's main products, services, or platforms. Each should be a brief description (1 sentence max) of what it is and who it serves."],
    "competitors": ["3-5 direct competitors or closest alternatives in the market. For each, include the company name and a short phrase on how they compete (e.g. 'Datadog — competing in observability/monitoring')."],
    "recent_news": ["3-5 recent news items or developments, each 1-2 sentences"],
    "role_analysis": "2-3 paragraphs analyzing the role: key responsibilities, required skills, and how to frame experience to match. If the candidate provided a resume, reference specific experience that maps to the role.",
    "interviewer_backgrounds": {"interviewer name": "1-2 paragraphs about their background, role, interests, and potential topics they might focus on"},
    "potential_questions": ["10 likely interview questions based on the role, company, and interview type. Include a mix of behavioral, technical, and role-specific questions."],
    "questions_to_ask": ["8-10 thoughtful questions the candidate should ask. These should demonstrate research and genuine interest. Avoid generic questions."],
    "key_talking_points": ["5 specific talking points connecting the candidate's potential strengths to this role and company. Make these concrete and memorable."],
    "sheet_talking_points": ["3-4 punchy one-liners (max 12 words each) for a quick-glance cheat sheet. Each should be a concrete, actionable reminder — not a generic platitude. Format: what to mention or emphasize, not a full sentence. Example: 'Led 3x revenue growth at Series B stage', 'Mention migrating 2M users to microservices', 'Ask about their Q3 platform rewrite'."],
    "compensation": {
        "base_range": "estimated base salary range (e.g. '$150K–$180K'). Use data from levels.fyi, Glassdoor, or similar sources if available. If no data, give a reasonable market estimate and note it.",
        "total_comp_range": "estimated total compensation range including equity/bonus (e.g. '$200K–$280K'). Leave empty string if insufficient data.",
        "equity_notes": "brief note on equity structure if known (e.g. 'RSUs, 4-year vest with 1-year cliff'). Leave empty string if unknown.",
        "source": "where the comp data came from (e.g. 'levels.fyi', 'Glassdoor', 'market estimate')",
        "notes": "any caveats — e.g. 'data is for SF Bay Area, adjust for location', 'limited data points', 'comp varies significantly by level'"
    },
    "sources": ["list of URLs used in research"],
    "interview_type": "string (e.g. 'Technical', 'Behavioral', 'Phone Screen')"
}

Guidelines:
- Be specific, not generic. Every talking point and question should reference something about THIS company or role.
- For potential interview questions, tailor them to the interview type (technical interviews get coding/design questions, behavioral get STAR-format questions, etc.)
- If information is missing, make reasonable inferences but note uncertainty.
- Questions to ask should show the candidate has done their homework.
- Key talking points should be the kind of things that make an interviewer think "this person really prepared."
- sheet_talking_points are NOT a copy of key_talking_points. They are ultra-short reminders for a spreadsheet glance — think sticky-note bullets, not sentences. No fluff, no generic advice like "show enthusiasm" or "demonstrate leadership."
- products_and_services should cover the company's core offerings. If it's a startup, describe the main product. If a large company, focus on the division/team most relevant to the role.
- competitors should name real companies, not vague categories.
- compensation: use actual data from the research results when available. Prefer levels.fyi data, then Glassdoor, then general market estimates. Always note the source and any caveats. If the role title is vague, estimate for the most likely level. Do not fabricate specific numbers — if data is thin, say so and give a wide range.
- Return ONLY the JSON object, no other text."""

RESUME_ADDENDUM = """

The candidate has provided their resume/background for personalization:

{resume}

Use this to create highly specific talking points that connect their actual experience to this role."""


def _build_research_context(event: InterviewEvent, research: ResearchResults) -> str:
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
        sections.append(f"\nINTERVIEWERS:")
        for i in event.interviewers:
            sections.append(f"  - {i.name} ({i.title or 'title unknown'}) — {i.email or 'email unknown'}")

    if event.preparation_instructions:
        sections.append(f"\nPREPARATION INSTRUCTIONS FROM EMAILS:")
        sections.append(f"  {event.preparation_instructions}")

    if research.company_info:
        sections.append(f"\nCOMPANY RESEARCH:")
        for r in research.company_info:
            sections.append(f"  [{r.title}]({r.url})")
            sections.append(f"  {r.snippet}")

    if research.products_and_services:
        sections.append(f"\nPRODUCTS & SERVICES RESEARCH:")
        for r in research.products_and_services:
            sections.append(f"  [{r.title}]({r.url})")
            sections.append(f"  {r.snippet}")

    if research.competitors:
        sections.append(f"\nCOMPETITOR RESEARCH:")
        for r in research.competitors:
            sections.append(f"  [{r.title}]({r.url})")
            sections.append(f"  {r.snippet}")

    if research.company_news:
        sections.append(f"\nRECENT NEWS:")
        for r in research.company_news:
            sections.append(f"  [{r.title}]({r.url})")
            sections.append(f"  {r.snippet}")

    if research.role_info:
        sections.append(f"\nROLE RESEARCH:")
        for r in research.role_info:
            sections.append(f"  [{r.title}]({r.url})")
            sections.append(f"  {r.snippet}")

    if research.interviewer_info:
        sections.append(f"\nINTERVIEWER RESEARCH:")
        for name, results in research.interviewer_info.items():
            sections.append(f"  {name}:")
            for r in results:
                sections.append(f"    [{r.title}]({r.url})")
                sections.append(f"    {r.snippet}")

    if research.glassdoor_info:
        sections.append(f"\nINTERVIEW TIPS & GLASSDOOR:")
        for r in research.glassdoor_info:
            sections.append(f"  [{r.title}]({r.url})")
            sections.append(f"  {r.snippet}")

    if research.compensation_info:
        sections.append(f"\nCOMPENSATION RESEARCH:")
        for r in research.compensation_info:
            sections.append(f"  [{r.title}]({r.url})")
            sections.append(f"  {r.snippet}")

    return "\n".join(sections)


def synthesize_prep(
    event: InterviewEvent,
    research: ResearchResults,
    anthropic_client: anthropic.Anthropic,
    config: Config,
) -> PrepDocument:
    logger.info("Synthesizing prep materials with Claude...")

    system = SYSTEM_PROMPT
    if config.resume_text:
        system += RESUME_ADDENDUM.format(resume=config.resume_text)

    user_content = _build_research_context(event, research)

    response = anthropic_client.messages.create(
        model=config.claude_model,
        max_tokens=4000,
        system=system,
        messages=[{"role": "user", "content": user_content}],
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

    logger.info("Synthesis complete: %s — %s", prep.company_name, prep.role_title)
    usage = response.usage
    logger.info("  Token usage: %d input, %d output", usage.input_tokens, usage.output_tokens)

    return prep
