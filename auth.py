from __future__ import annotations

import logging
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from config import Config

logger = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/drive.file",
]

TOKEN_PATH = Path(__file__).parent / "token.json"


def get_credentials(config: Config) -> Credentials:
    creds = None
    if TOKEN_PATH.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            logger.info("Refreshing expired Google token...")
            creds.refresh(Request())
        else:
            logger.info("Opening browser for Google authorization...")
            flow = InstalledAppFlow.from_client_secrets_file(
                str(config.google_credentials_path), SCOPES
            )
            creds = flow.run_local_server(port=0)
        TOKEN_PATH.write_text(creds.to_json(), encoding="utf-8")
        logger.info("Google credentials saved to %s", TOKEN_PATH)

    return creds


class GoogleServices:
    def __init__(self, config: Config):
        self.creds = get_credentials(config)
        self._calendar = None
        self._gmail = None
        self._sheets = None
        self._docs = None
        self._drive = None

    @property
    def calendar(self):
        if not self._calendar:
            self._calendar = build("calendar", "v3", credentials=self.creds)
        return self._calendar

    @property
    def gmail(self):
        if not self._gmail:
            self._gmail = build("gmail", "v1", credentials=self.creds)
        return self._gmail

    @property
    def sheets(self):
        if not self._sheets:
            self._sheets = build("sheets", "v4", credentials=self.creds)
        return self._sheets

    @property
    def docs(self):
        if not self._docs:
            self._docs = build("docs", "v1", credentials=self.creds)
        return self._docs

    @property
    def drive(self):
        if not self._drive:
            self._drive = build("drive", "v3", credentials=self.creds)
        return self._drive

    def get_user_profile(self) -> dict:
        profile = self.gmail.users().getProfile(userId="me").execute()
        return {"email": profile.get("emailAddress", "")}


def check_setup(config: Config) -> bool:
    print("Checking setup...")
    errors = []

    try:
        services = GoogleServices(config)
        print("  [OK] Google authentication successful")
    except Exception as e:
        print(f"  [FAIL] Google authentication: {e}")
        return False

    try:
        services.calendar.calendarList().list(maxResults=1).execute()
        print("  [OK] Google Calendar API accessible")
    except Exception as e:
        errors.append(f"Calendar API: {e}")
        print(f"  [FAIL] Google Calendar API: {e}")

    try:
        services.gmail.users().getProfile(userId="me").execute()
        print("  [OK] Gmail API accessible")
    except Exception as e:
        errors.append(f"Gmail API: {e}")
        print(f"  [FAIL] Gmail API: {e}")

    try:
        services.sheets.spreadsheets().create(
            body={"properties": {"title": "__test_delete_me"}}
        ).execute()
        print("  [OK] Google Sheets API accessible")
    except Exception as e:
        errors.append(f"Sheets API: {e}")
        print(f"  [FAIL] Google Sheets API: {e}")

    try:
        services.docs.documents().create(
            body={"title": "__test_delete_me"}
        ).execute()
        print("  [OK] Google Docs API accessible")
    except Exception as e:
        errors.append(f"Docs API: {e}")
        print(f"  [FAIL] Google Docs API: {e}")

    try:
        from anthropic import Anthropic
        client = Anthropic(api_key=config.anthropic_api_key)
        client.messages.create(
            model=config.claude_model,
            max_tokens=10,
            messages=[{"role": "user", "content": "Say 'ok'"}],
        )
        print("  [OK] Anthropic API accessible")
    except Exception as e:
        errors.append(f"Anthropic API: {e}")
        print(f"  [FAIL] Anthropic API: {e}")

    if errors:
        print(f"\n{len(errors)} check(s) failed. See setup_guide.md for help.")
        return False
    else:
        print("\nAll checks passed! You're ready to go.")
        return True
