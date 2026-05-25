from __future__ import annotations

import logging
import re
from datetime import datetime


def setup_logging(level: str = "INFO") -> None:
    numeric_level = getattr(logging, level.upper(), logging.INFO)
    logging.basicConfig(
        level=numeric_level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


def parse_datetime(google_dt: dict) -> datetime:
    if "dateTime" in google_dt:
        dt_str = google_dt["dateTime"]
        dt_str = re.sub(r"([+-]\d{2}):(\d{2})$", r"\1\2", dt_str)
        for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S"):
            try:
                return datetime.strptime(dt_str, fmt)
            except ValueError:
                continue
        return datetime.fromisoformat(google_dt["dateTime"])
    elif "date" in google_dt:
        return datetime.strptime(google_dt["date"], "%Y-%m-%d")
    raise ValueError(f"Cannot parse datetime: {google_dt}")


def extract_domain(email: str) -> str | None:
    if "@" in email:
        domain = email.split("@")[1].lower()
        personal = {
            "gmail.com", "yahoo.com", "hotmail.com", "outlook.com",
            "icloud.com", "aol.com", "protonmail.com", "mail.com",
            "live.com", "msn.com",
        }
        if domain not in personal:
            return domain
    return None


def clean_html(html: str) -> str:
    text = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.DOTALL)
    text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.DOTALL)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"&nbsp;", " ", text)
    text = re.sub(r"&amp;", "&", text)
    text = re.sub(r"&lt;", "<", text)
    text = re.sub(r"&gt;", ">", text)
    text = re.sub(r"&#\d+;", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def truncate(text: str, max_chars: int = 500) -> str:
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 3] + "..."


def normalize_for_match(text: str) -> str:
    if not text:
        return ""
    return re.sub(r"[^a-z0-9]", "", text.lower())
