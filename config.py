from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv


class Config:
    def __init__(self, env_path: str | None = None):
        env_file = Path(env_path) if env_path else Path(__file__).parent / ".env"
        load_dotenv(env_file)

        self.anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
        self.google_credentials_path: Path = Path(
            os.getenv("GOOGLE_CREDENTIALS_PATH", "./credentials.json")
        )
        self.user_name: str = os.getenv("USER_NAME", "")
        self.user_aliases: list[str] = [
            a.strip() for a in os.getenv("USER_ALIASES", "").split(",") if a.strip()
        ]
        self.user_email: str = os.getenv("USER_EMAIL", "")
        self.look_ahead_days: int = int(os.getenv("LOOK_AHEAD_DAYS", "14"))
        self.poll_interval_minutes: int = int(os.getenv("POLL_INTERVAL_MINUTES", "30"))
        self.tavily_api_key: str = os.getenv("TAVILY_API_KEY", "")
        self.claude_model: str = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")
        self.google_sheet_id: str = os.getenv("GOOGLE_SHEET_ID", "")
        self.drive_folder_id: str = os.getenv("DRIVE_FOLDER_ID", "")
        self.resume_path: str = os.getenv("RESUME_PATH", "")
        self.ngrok_auth_token: str = os.getenv("NGROK_AUTH_TOKEN", "")
        self.ngrok_domain: str = os.getenv("NGROK_DOMAIN", "")
        self.log_level: str = os.getenv("LOG_LEVEL", "INFO")
        self.calendar_ids: list[str] = [
            c.strip() for c in os.getenv("CALENDAR_IDS", "primary").split(",") if c.strip()
        ]
        self.extra_recruiting_domains: set[str] = {
            d.strip().lower() for d in os.getenv("EXTRA_RECRUITING_DOMAINS", "").split(",") if d.strip()
        }
        self.extra_match_keywords: list[str] = [
            k.strip().lower() for k in os.getenv("EXTRA_MATCH_KEYWORDS", "").split(",") if k.strip()
        ]

    @property
    def resume_text(self) -> str:
        if self.resume_path:
            p = Path(self.resume_path)
            if p.exists():
                return p.read_text(encoding="utf-8")
        return ""

    def validate(self) -> list[str]:
        errors = []
        if not self.anthropic_api_key:
            errors.append("ANTHROPIC_API_KEY is required. Get one at https://console.anthropic.com/")
        elif not self.anthropic_api_key.startswith("sk-ant-"):
            errors.append("ANTHROPIC_API_KEY doesn't look right — should start with 'sk-ant-'")
        if not self.google_credentials_path.exists():
            errors.append(
                f"Google credentials not found at {self.google_credentials_path}. "
                "See setup_guide.md for how to create them."
            )
        return errors

    def print_config_summary(self) -> None:
        print("Configuration:")
        print(f"  Anthropic API key: {'***' + self.anthropic_api_key[-4:] if self.anthropic_api_key else 'NOT SET'}")
        print(f"  Google credentials: {self.google_credentials_path}")
        print(f"  User name: {self.user_name or '(auto-detect)'}")
        if self.user_aliases:
            print(f"  User aliases: {', '.join(self.user_aliases)}")
        print(f"  User email: {self.user_email or '(auto-detect)'}")
        print(f"  Look-ahead days: {self.look_ahead_days}")
        print(f"  Claude model: {self.claude_model}")
        print(f"  Google Sheet ID: {self.google_sheet_id or '(will create on first run)'}")
        print(f"  Resume: {self.resume_path or '(not set)'}")
        print(f"  Calendars: {', '.join(self.calendar_ids)}")
        print(f"  Tavily: {'enabled' if self.tavily_api_key else 'disabled (using DuckDuckGo)'}")


def load_config(env_path: str | None = None) -> Config:
    config = Config(env_path)
    errors = config.validate()
    if errors:
        print("Configuration errors:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        sys.exit(1)
    return config
