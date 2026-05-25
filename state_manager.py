from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

STATE_FILE = Path(__file__).parent / "state.json"
CACHE_TTL_DAYS = 90


class StateManager:
    def __init__(self, path: Path = STATE_FILE):
        self.path = path
        self._state = self._load()

    def _load(self) -> dict[str, Any]:
        if self.path.exists():
            try:
                data = json.loads(self.path.read_text(encoding="utf-8"))
                data.setdefault("processed_events", {})
                data.setdefault("pipelines", {})
                data.setdefault("last_poll", None)
                data.setdefault("sheet_id", None)
                data.setdefault("company_research", {})
                return data
            except (json.JSONDecodeError, OSError) as e:
                logger.warning("Could not read state file, starting fresh: %s", e)
        return {"processed_events": {}, "pipelines": {}, "last_poll": None, "sheet_id": None, "company_research": {}}

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

    # --- Fuzzy company-key resolution ---

    def resolve_company_key(self, company_name: str) -> str:
        from pipeline_tracker import normalize_company_key
        new_key = normalize_company_key(company_name)
        if not new_key:
            return ""
        pipelines = self._pipelines()
        if new_key in pipelines:
            return new_key
        for existing_key in list(pipelines.keys()):
            existing_company = pipelines[existing_key].get("company_name") or ""
            if normalize_company_key(existing_company) == new_key:
                if existing_key != new_key:
                    pipelines[new_key] = pipelines.pop(existing_key)
                    cache = self._company_research()
                    if existing_key in cache:
                        cache[new_key] = cache.pop(existing_key)
                    self._save()
                    logger.info("Migrated pipeline key %s -> %s", existing_key, new_key)
                return new_key
            existing_stripped = re.sub(r"[^a-z0-9]", "", existing_key.lower())
            if existing_stripped == new_key or new_key == existing_stripped:
                return existing_key
        return new_key

    # --- Round detection and prior-stage retrieval ---

    def get_round_number(self, company_key: str, event_id: str) -> int:
        pipeline = self._pipelines().get(company_key)
        if not pipeline:
            return 1
        stages = pipeline.get("stages", [])
        for i, s in enumerate(stages):
            if s["event_id"] == event_id:
                return i + 1
        return len(stages) + 1

    def get_prior_stages(self, company_key: str, exclude_event_id: str) -> list[dict]:
        pipeline = self._pipelines().get(company_key)
        if not pipeline:
            return []
        return [s for s in pipeline.get("stages", []) if s["event_id"] != exclude_event_id]

    # --- Company research cache ---

    def _company_research(self) -> dict:
        if "company_research" not in self._state:
            self._state["company_research"] = {}
        return self._state["company_research"]

    def get_cached_company_research(self, company_key: str) -> dict | None:
        entry = self._company_research().get(company_key)
        if not entry:
            return None
        cached_at_str = entry.get("cached_at")
        if cached_at_str:
            try:
                cached_at = datetime.fromisoformat(cached_at_str)
                if cached_at.tzinfo is None:
                    cached_at = cached_at.replace(tzinfo=timezone.utc)
                if datetime.now(timezone.utc) - cached_at > timedelta(days=CACHE_TTL_DAYS):
                    logger.info("Cached research for %s expired (>%d days), ignoring", company_key, CACHE_TTL_DAYS)
                    return None
            except ValueError:
                pass
        return entry

    def cache_company_research(self, company_key: str, research_dict: dict) -> None:
        cache = self._company_research()
        cache[company_key] = {
            "cached_at": datetime.now(timezone.utc).isoformat(),
            "data": research_dict,
        }
        self._save()

    def clear_company_research_cache(self, company_key: str | None = None) -> int:
        cache = self._company_research()
        if company_key:
            removed = 1 if cache.pop(company_key, None) else 0
        else:
            removed = len(cache)
            self._state["company_research"] = {}
        self._save()
        return removed

    def delete_pipeline(self, company_key: str) -> bool:
        pipelines = self._pipelines()
        if company_key not in pipelines:
            return False
        del pipelines[company_key]
        cache = self._company_research()
        cache.pop(company_key, None)
        self._save()
        return True
