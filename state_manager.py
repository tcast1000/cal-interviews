from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

STATE_FILE = Path(__file__).parent / "state.json"


class StateManager:
    def __init__(self, path: Path = STATE_FILE):
        self.path = path
        self._state = self._load()

    def _load(self) -> dict[str, Any]:
        if self.path.exists():
            try:
                return json.loads(self.path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError) as e:
                logger.warning("Could not read state file, starting fresh: %s", e)
        return {"processed_events": {}, "last_poll": None, "sheet_id": None}

    def _save(self) -> None:
        self.path.write_text(
            json.dumps(self._state, indent=2, default=str), encoding="utf-8"
        )

    def is_processed(self, event_id: str) -> bool:
        return event_id in self._state["processed_events"]

    def needs_refresh(self, event_id: str, event_updated: str | None) -> bool:
        if event_id not in self._state["processed_events"]:
            return True
        if event_updated:
            stored = self._state["processed_events"][event_id].get("event_updated")
            if stored and event_updated > stored:
                return True
        return False

    def mark_processed(
        self, event_id: str, doc_url: str, sheet_row: int, event_updated: str | None = None
    ) -> None:
        self._state["processed_events"][event_id] = {
            "processed_at": datetime.now(timezone.utc).isoformat(),
            "event_updated": event_updated,
            "doc_url": doc_url,
            "sheet_row": sheet_row,
        }
        self._save()

    def get_last_poll(self) -> str | None:
        return self._state.get("last_poll")

    def set_last_poll(self) -> None:
        self._state["last_poll"] = datetime.now(timezone.utc).isoformat()
        self._save()

    def get_sheet_id(self) -> str | None:
        return self._state.get("sheet_id")

    def set_sheet_id(self, sheet_id: str) -> None:
        self._state["sheet_id"] = sheet_id
        self._save()
