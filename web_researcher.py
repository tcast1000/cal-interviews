from __future__ import annotations

import logging
import time

from config import Config
from models import InterviewEvent, ResearchResults, SearchResult

logger = logging.getLogger(__name__)

SEARCH_DELAY = 1.0

SOCIAL_PLATFORMS = [
    ("LinkedIn", ["linkedin.com/company", "linkedin.com/school"]),
    ("X / Twitter", ["twitter.com", "x.com"]),
    ("GitHub", ["github.com"]),
    ("YouTube", ["youtube.com/@", "youtube.com/c/", "youtube.com/user/", "youtube.com/channel/"]),
    ("Instagram", ["instagram.com"]),
    ("Facebook", ["facebook.com"]),
    ("TikTok", ["tiktok.com/@"]),
    ("Threads", ["threads.net/@", "threads.com/@"]),
    ("Bluesky", ["bsky.app/profile"]),
]

EXCLUDED_SOCIAL_HOSTS = {
    "linkedin.com/in", "linkedin.com/pub", "linkedin.com/posts", "linkedin.com/feed",
}


def _search_duckduckgo(query: str, max_results: int = 5) -> list[SearchResult]:
    try:
        from duckduckgo_search import DDGS
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=max_results))
            return [
                SearchResult(
                    title=r.get("title", ""),
                    snippet=r.get("body", ""),
                    url=r.get("href", ""),
                )
                for r in results
            ]
    except Exception as e:
        logger.warning("DuckDuckGo search failed for '%s': %s", query, e)
        return []


def _search_tavily(query: str, api_key: str, max_results: int = 5, topic: str | None = None) -> list[SearchResult]:
    try:
        import httpx
        payload = {
            "api_key": api_key,
            "query": query,
            "max_results": max_results,
            "search_depth": "basic",
        }
        if topic:
            payload["topic"] = topic
            if topic == "news":
                payload["days"] = 30
        response = httpx.post(
            "https://api.tavily.com/search",
            json=payload,
            timeout=15,
        )
        data = response.json()
        return [
            SearchResult(
                title=r.get("title", ""),
                snippet=r.get("content", ""),
                url=r.get("url", ""),
            )
            for r in data.get("results", [])
        ]
    except Exception as e:
        logger.warning("Tavily search failed for '%s': %s", query, e)
        return []


def _search(query: str, config: Config, max_results: int = 5, prefer: str = "tavily", topic: str | None = None) -> list[SearchResult]:
    if prefer == "ddg" or not config.tavily_api_key:
        return _search_duckduckgo(query, max_results)
    return _search_tavily(query, config.tavily_api_key, max_results, topic=topic)


GENERIC_ROLE_TITLES = {
    "software engineer", "engineer", "developer", "manager", "product manager",
    "data scientist", "analyst", "designer", "consultant",
}


def _pick_first_matching_url(results: list[SearchResult], substrings: list[str]) -> str:
    for r in results:
        url = (r.url or "").lower()
        if not url:
            continue
        if any(bad in url for bad in EXCLUDED_SOCIAL_HOSTS):
            continue
        if any(sub in url for sub in substrings):
            return r.url
    return ""


def find_social_links(company: str, config: Config) -> dict[str, str]:
    found: dict[str, str] = {}
    if not company or company == "Unknown Company":
        return found

    broad_results = _search(
        f'"{company}" official social media linkedin twitter github',
        config, max_results=5, prefer="ddg",
    )
    time.sleep(SEARCH_DELAY)

    for platform, substrings in SOCIAL_PLATFORMS:
        url = _pick_first_matching_url(broad_results, substrings)
        if url:
            found[platform] = url
            logger.info("  Social (broad): %s -> %s", platform, url)

    missing = [(p, subs) for p, subs in SOCIAL_PLATFORMS if p not in found]
    for platform, substrings in missing:
        primary_host = substrings[0].split("/")[0]
        results = _search(f'"{company}" site:{primary_host}', config, max_results=3, prefer="ddg")
        url = _pick_first_matching_url(results, substrings)
        if url:
            found[platform] = url
            logger.info("  Social (targeted): %s -> %s", platform, url)
        time.sleep(SEARCH_DELAY)
    return found


def find_job_description(company: str, role: str, config: Config) -> tuple[str, str]:
    if not company or company == "Unknown Company" or not role:
        return ("", "")
    if role.strip().lower() in GENERIC_ROLE_TITLES:
        logger.info("  Skipping JD search — role '%s' is too generic to match LinkedIn jobs reliably", role)
        return ("", "")

    linkedin_results = _search(f'site:linkedin.com/jobs "{company}" "{role}"', config, max_results=3)
    for r in linkedin_results:
        if "linkedin.com/jobs" in (r.url or "").lower():
            return (r.url, "LinkedIn")
    time.sleep(SEARCH_DELAY)

    ats_results = _search(
        f'(site:greenhouse.io OR site:lever.co OR site:ashbyhq.com OR site:jobs.ashbyhq.com) "{company}" "{role}"',
        config, max_results=3,
    )
    for r in ats_results:
        url = (r.url or "").lower()
        if "greenhouse.io" in url:
            return (r.url, "Greenhouse")
        if "lever.co" in url:
            return (r.url, "Lever")
        if "ashbyhq.com" in url:
            return (r.url, "Ashby")
    time.sleep(SEARCH_DELAY)

    careers_results = _search(f'"{company}" careers "{role}"', config, max_results=3, prefer="ddg")
    for r in careers_results:
        url = (r.url or "").lower()
        if "careers" in url or "/jobs/" in url:
            return (r.url, "Company careers page")
    if careers_results:
        return (careers_results[0].url, "Company careers page")

    return ("", "")


def research_interview(
    event: InterviewEvent,
    config: Config,
    cached_company_research: dict | None = None,
) -> ResearchResults:
    company = event.company_name or "Unknown Company"
    role = event.role_title or ""

    if company == "Unknown Company":
        domains = event.non_personal_domains
        if domains:
            company = domains[0].split(".")[0].title()

    if cached_company_research:
        results = ResearchResults.from_cache_dict(cached_company_research)
        logger.info("Researching: %s — %s (using cached company research)", company, role or "role unknown")

        for interviewer in event.interviewers[:3]:
            if not interviewer.name:
                continue
            if interviewer.name in results.interviewer_info and results.interviewer_info[interviewer.name]:
                continue
            logger.info("  Searching new interviewer: %s", interviewer.name)
            results.interviewer_info[interviewer.name] = _search(
                f'"{interviewer.name}" "{company}" linkedin', config, max_results=3
            )
            time.sleep(SEARCH_DELAY)

        return results

    results = ResearchResults()
    logger.info("Researching: %s — %s", company, role or "role unknown")

    if company != "Unknown Company":
        logger.info("  Searching company (overview + products + competitors + values, one call)...")
        results.company_info = _search(
            f'"{company}" overview products services competitors values culture',
            config, max_results=5, prefer="ddg",
        )
        time.sleep(SEARCH_DELAY)

        logger.info("  Searching recent news (Tavily news topic)...")
        results.company_news = _search(
            f'"{company}" recent news', config, max_results=3, topic="news",
        )
        time.sleep(SEARCH_DELAY)

        logger.info("  Searching interview tips...")
        results.glassdoor_info = _search(
            f'"{company}" glassdoor interview experience', config, max_results=3, prefer="ddg",
        )
        time.sleep(SEARCH_DELAY)

        logger.info("  Searching social media...")
        results.social_links = find_social_links(company, config)

    if role and company != "Unknown Company":
        logger.info("  Searching role details...")
        results.role_info = _search(
            f'"{role}" "{company}" job description responsibilities', config, max_results=3,
        )
        time.sleep(SEARCH_DELAY)

        logger.info("  Searching compensation data...")
        results.compensation_info = _search(
            f'"{company}" "{role}" salary compensation levels.fyi glassdoor', config, max_results=3
        )
        if not results.compensation_info:
            results.compensation_info = _search(
                f'"{role}" salary range compensation', config, max_results=3, prefer="ddg",
            )
        time.sleep(SEARCH_DELAY)

        logger.info("  Searching job description...")
        jd_url, jd_source = find_job_description(company, role, config)
        results.job_description_url = jd_url
        results.job_description_source = jd_source
    elif company != "Unknown Company":
        logger.info("  Searching general compensation data...")
        results.compensation_info = _search(
            f'"{company}" salary compensation levels.fyi glassdoor', config, max_results=3
        )
        time.sleep(SEARCH_DELAY)

    for interviewer in event.interviewers[:3]:
        if not interviewer.name:
            continue
        if not interviewer.title and not interviewer.email:
            logger.info("  Skipping interviewer search for %s (no title/email — name alone too generic)", interviewer.name)
            continue
        logger.info("  Searching interviewer: %s", interviewer.name)
        results.interviewer_info[interviewer.name] = _search(
            f'"{interviewer.name}" "{company}" linkedin', config, max_results=3,
        )
        time.sleep(SEARCH_DELAY)

    total = (
        len(results.company_info) + len(results.products_and_services) +
        len(results.competitors) + len(results.company_news) +
        len(results.role_info) + len(results.glassdoor_info) +
        len(results.compensation_info) +
        sum(len(v) for v in results.interviewer_info.values())
    )
    logger.info("Research complete: %d total results gathered, %d social links, JD source: %s",
                total, len(results.social_links), results.job_description_source or "none")
    return results
