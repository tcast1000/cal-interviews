from __future__ import annotations

import logging
import time

from config import Config
from models import InterviewEvent, ResearchResults, SearchResult

logger = logging.getLogger(__name__)

SEARCH_DELAY = 1.0


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


def _search_tavily(query: str, api_key: str, max_results: int = 5) -> list[SearchResult]:
    try:
        import httpx
        response = httpx.post(
            "https://api.tavily.com/search",
            json={
                "api_key": api_key,
                "query": query,
                "max_results": max_results,
                "search_depth": "basic",
            },
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


def _search(query: str, config: Config, max_results: int = 5) -> list[SearchResult]:
    if config.tavily_api_key:
        return _search_tavily(query, config.tavily_api_key, max_results)
    return _search_duckduckgo(query, max_results)


def research_interview(event: InterviewEvent, config: Config) -> ResearchResults:
    results = ResearchResults()
    company = event.company_name or "Unknown Company"
    role = event.role_title or ""

    if company == "Unknown Company":
        domains = event.non_personal_domains
        if domains:
            company = domains[0].split(".")[0].title()

    logger.info("Researching: %s — %s", company, role or "role unknown")

    if company != "Unknown Company":
        logger.info("  Searching company overview...")
        results.company_info = _search(f'"{company}" company overview about', config)
        time.sleep(SEARCH_DELAY)

        logger.info("  Searching products and services...")
        results.products_and_services = _search(f'"{company}" products services platform offerings', config, max_results=3)
        time.sleep(SEARCH_DELAY)

        logger.info("  Searching competitors...")
        results.competitors = _search(f'"{company}" competitors alternatives market', config, max_results=3)
        time.sleep(SEARCH_DELAY)

        logger.info("  Searching recent news...")
        results.company_news = _search(f'"{company}" recent news 2026', config, max_results=3)
        time.sleep(SEARCH_DELAY)

        logger.info("  Searching interview tips...")
        results.glassdoor_info = _search(f'"{company}" glassdoor interview experience', config, max_results=3)
        time.sleep(SEARCH_DELAY)

    if role and company != "Unknown Company":
        logger.info("  Searching role details...")
        results.role_info = _search(f'"{role}" "{company}" job description responsibilities', config)
        time.sleep(SEARCH_DELAY)

        logger.info("  Searching compensation data...")
        results.compensation_info = _search(
            f'"{company}" "{role}" salary compensation levels.fyi glassdoor', config, max_results=3
        )
        if not results.compensation_info:
            results.compensation_info = _search(
                f'"{role}" salary range compensation 2026', config, max_results=3
            )
        time.sleep(SEARCH_DELAY)
    elif company != "Unknown Company":
        logger.info("  Searching general compensation data...")
        results.compensation_info = _search(
            f'"{company}" salary compensation levels.fyi glassdoor', config, max_results=3
        )
        time.sleep(SEARCH_DELAY)

    for interviewer in event.interviewers[:3]:
        if interviewer.name:
            logger.info("  Searching interviewer: %s", interviewer.name)
            interviewer_results = _search(
                f'"{interviewer.name}" "{company}" linkedin', config, max_results=3
            )
            results.interviewer_info[interviewer.name] = interviewer_results
            time.sleep(SEARCH_DELAY)

    total = (
        len(results.company_info) + len(results.products_and_services) +
        len(results.competitors) + len(results.company_news) +
        len(results.role_info) + len(results.glassdoor_info) +
        len(results.compensation_info) +
        sum(len(v) for v in results.interviewer_info.values())
    )
    logger.info("Research complete: %d total results gathered", total)
    return results
