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
        return {"processed_events": {}, "pipelines": {}, "last_poll": None, "sheet_id": None}

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

    # --- Pipeline state ---

    def _pipelines(self) -> dict:
        if "pipelines" not in self._state:
            self._state["pipelines"] = {}
        return self._state["pipelines"]

    def get_pipeline(self, company_key: str) -> dict | None:
        return self._pipelines().get(company_key)

    def get_all_pipelines(self) -> dict[str, dict]:
        return dict(self._pipelines())

    def upsert_pipeline(
        self,
        company_key: str,
        company_name: str,
        role_title: str | None = None,
        status: str = "Active",
    ) -> dict:
        pipelines = self._pipelines()
        now = datetime.now(timezone.utc).isoformat()
        if company_key not in pipelines:
            pipelines[company_key] = {
                "company_name": company_name,
                "role_title": role_title,
                "status": status,
                "stages": [],
                "created_at": now,
                "last_activity": now,
                "follow_up_after": None,
                "notes": [],
            }
        else:
            pipelines[company_key]["last_activity"] = now
            if role_title and not pipelines[company_key].get("role_title"):
                pipelines[company_key]["role_title"] = role_title
        self._save()
        return pipelines[company_key]

    def add_pipeline_stage(
        self,
        company_key: str,
        event_id: str,
        stage_type: str,
        event_date: str,
        doc_url: str = "",
        thank_you_draft_id: str | None = None,
    ) -> None:
        pipeline = self._pipelines().get(company_key)
        if not pipeline:
            return
        existing_ids = {s["event_id"] for s in pipeline["stages"]}
        if event_id in existing_ids:
            return
        pipeline["stages"].append({
            "event_id": event_id,
            "stage_type": stage_type,
            "event_date": event_date,
            "doc_url": doc_url,
            "thank_you_draft_id": thank_you_draft_id,
            "debrief": None,
        })
        pipeline["stages"].sort(key=lambda s: s["event_date"])
        pipeline["last_activity"] = datetime.now(timezone.utc).isoformat()
        self._save()

    def update_pipeline_status(self, company_key: str, status: str) -> None:
        pipeline = self._pipelines().get(company_key)
        if pipeline:
            pipeline["status"] = status
            pipeline["last_activity"] = datetime.now(timezone.utc).isoformat()
            self._save()

    def set_pipeline_follow_up(self, company_key: str, follow_up_date: str | None) -> None:
        pipeline = self._pipelines().get(company_key)
        if pipeline:
            pipeline["follow_up_after"] = follow_up_date
            self._save()

    def save_debrief(self, company_key: str, event_id: str, debrief: str) -> None:
        pipeline = self._pipelines().get(company_key)
        if not pipeline:
            return
        for stage in pipeline["stages"]:
            if stage["event_id"] == event_id:
                stage["debrief"] = debrief
                break
        pipeline["last_activity"] = datetime.now(timezone.utc).isoformat()
        self._save()

    def add_pipeline_note(self, company_key: str, note: str) -> None:
        pipeline = self._pipelines().get(company_key)
        if pipeline:
            pipeline["notes"].append({
                "text": note,
                "added_at": datetime.now(timezone.utc).isoformat(),
            })
            self._save()
