from __future__ import annotations

import logging
from datetime import datetime

from config import Config
from models import InterviewEvent, PrepDocument
from state_manager import StateManager
from utils import truncate

logger = logging.getLogger(__name__)

SHEET_NAME = "Interview Tracker"
PIPELINE_SHEET_NAME = "Pipeline Overview"

HEADERS = [
    "Date/Time", "Company", "Role", "Interviewer(s)", "Type",
    "Key Talking Points", "Comp Range", "Status", "Prep Doc", "Calendar Link", "Notes",
]

PIPELINE_HEADERS = [
    "Company", "Role", "Status", "Current Stage", "Rounds",
    "Days Silent", "Next Action", "Last Activity", "Notes",
]

COLUMN_WIDTHS = [180, 150, 200, 200, 120, 350, 140, 100, 100, 100, 200]
PIPELINE_COLUMN_WIDTHS = [150, 200, 100, 140, 70, 90, 140, 140, 250]


def _create_tracker_sheet(sheets_service, drive_service, config: Config) -> str:
    logger.info("Creating new Interview Tracker spreadsheet...")

    spreadsheet = sheets_service.spreadsheets().create(
        body={
            "properties": {"title": "Interview Prep Tracker"},
            "sheets": [
                {"properties": {"title": SHEET_NAME}},
                {"properties": {"title": PIPELINE_SHEET_NAME}},
            ],
        }
    ).execute()

    sheet_id = spreadsheet["spreadsheetId"]
    internal_sheet_id = spreadsheet["sheets"][0]["properties"]["sheetId"]

    requests = []

    requests.append({
        "updateSheetProperties": {
            "properties": {
                "sheetId": internal_sheet_id,
                "gridProperties": {"frozenRowCount": 1},
            },
            "fields": "gridProperties.frozenRowCount",
        }
    })

    for i, width in enumerate(COLUMN_WIDTHS):
        requests.append({
            "updateDimensionProperties": {
                "range": {
                    "sheetId": internal_sheet_id,
                    "dimension": "COLUMNS",
                    "startIndex": i,
                    "endIndex": i + 1,
                },
                "properties": {"pixelSize": width},
                "fields": "pixelSize",
            }
        })

    requests.append({
        "repeatCell": {
            "range": {
                "sheetId": internal_sheet_id,
                "startRowIndex": 0,
                "endRowIndex": 1,
            },
            "cell": {
                "userEnteredFormat": {
                    "textFormat": {"bold": True},
                    "backgroundColor": {"red": 0.2, "green": 0.4, "blue": 0.7},
                    "horizontalAlignment": "CENTER",
                    "textFormat": {"bold": True, "foregroundColor": {"red": 1, "green": 1, "blue": 1}},
                }
            },
            "fields": "userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)",
        }
    })

    sheets_service.spreadsheets().batchUpdate(
        spreadsheetId=sheet_id, body={"requests": requests}
    ).execute()

    sheets_service.spreadsheets().values().update(
        spreadsheetId=sheet_id,
        range=f"{SHEET_NAME}!A1:K1",
        valueInputOption="RAW",
        body={"values": [HEADERS]},
    ).execute()

    pipeline_sheet_id = spreadsheet["sheets"][1]["properties"]["sheetId"]
    pipeline_requests = []
    pipeline_requests.append({
        "updateSheetProperties": {
            "properties": {
                "sheetId": pipeline_sheet_id,
                "gridProperties": {"frozenRowCount": 1},
            },
            "fields": "gridProperties.frozenRowCount",
        }
    })
    for i, width in enumerate(PIPELINE_COLUMN_WIDTHS):
        pipeline_requests.append({
            "updateDimensionProperties": {
                "range": {
                    "sheetId": pipeline_sheet_id,
                    "dimension": "COLUMNS",
                    "startIndex": i,
                    "endIndex": i + 1,
                },
                "properties": {"pixelSize": width},
                "fields": "pixelSize",
            }
        })
    pipeline_requests.append({
        "repeatCell": {
            "range": {
                "sheetId": pipeline_sheet_id,
                "startRowIndex": 0,
                "endRowIndex": 1,
            },
            "cell": {
                "userEnteredFormat": {
                    "backgroundColor": {"red": 0.2, "green": 0.4, "blue": 0.7},
                    "horizontalAlignment": "CENTER",
                    "textFormat": {"bold": True, "foregroundColor": {"red": 1, "green": 1, "blue": 1}},
                }
            },
            "fields": "userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)",
        }
    })
    sheets_service.spreadsheets().batchUpdate(
        spreadsheetId=sheet_id, body={"requests": pipeline_requests}
    ).execute()
    sheets_service.spreadsheets().values().update(
        spreadsheetId=sheet_id,
        range=f"'{PIPELINE_SHEET_NAME}'!A1:I1",
        valueInputOption="RAW",
        body={"values": [PIPELINE_HEADERS]},
    ).execute()

    if config.drive_folder_id:
        try:
            drive_service.files().update(
                fileId=sheet_id,
                addParents=config.drive_folder_id,
                fields="id, parents",
            ).execute()
        except Exception as e:
            logger.warning("Could not move sheet to folder: %s", e)

    logger.info("Created tracker spreadsheet: https://docs.google.com/spreadsheets/d/%s", sheet_id)
    return sheet_id


def _determine_status(event: InterviewEvent) -> str:
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc)
    if event.start_time.tzinfo is None:
        start = event.start_time
        now = datetime.now()
    else:
        start = event.start_time

    if start < now:
        return "Completed"
    elif start - now < timedelta(hours=24):
        return "Imminent"
    else:
        return "Upcoming"


def write_to_sheet(
    sheets_service,
    drive_service,
    config: Config,
    state: StateManager,
    event: InterviewEvent,
    prep: PrepDocument,
    doc_url: str,
) -> int:
    sheet_id = config.google_sheet_id or state.get_sheet_id()
    if not sheet_id:
        sheet_id = _create_tracker_sheet(sheets_service, drive_service, config)
        state.set_sheet_id(sheet_id)
        print(f"\nNew tracker sheet created! Add this to your .env:\n  GOOGLE_SHEET_ID={sheet_id}\n")

    points = prep.sheet_talking_points if prep.sheet_talking_points else prep.key_talking_points[:3]
    talking_points = "\n".join(f"• {tp}" for tp in points)
    interviewers = ", ".join(prep.interviewer_names) if prep.interviewer_names else ""
    status = _determine_status(event)

    comp = prep.compensation or {}
    comp_display = comp.get("base_range", "")
    if comp.get("total_comp_range"):
        comp_display += f" (TC: {comp['total_comp_range']})"

    row = [
        event.start_time.strftime("%Y-%m-%d %H:%M"),
        prep.company_name,
        prep.role_title,
        interviewers,
        prep.interview_type,
        truncate(talking_points, 500),
        comp_display,
        status,
        doc_url,
        event.calendar_link or "",
        "",
    ]

    result = sheets_service.spreadsheets().values().append(
        spreadsheetId=sheet_id,
        range=f"{SHEET_NAME}!A:K",
        valueInputOption="USER_ENTERED",
        insertDataOption="INSERT_ROWS",
        body={"values": [row]},
    ).execute()

    updated_range = result.get("updates", {}).get("updatedRange", "")
    row_num = 0
    if updated_range:
        try:
            row_num = int(updated_range.split("!")[-1].split(":")[0].replace("A", ""))
        except (ValueError, IndexError):
            pass

    _apply_row_formatting(sheets_service, sheet_id, row_num, status, doc_url)

    logger.info("Added row %d to tracker sheet", row_num)
    return row_num


def _apply_row_formatting(
    sheets_service, sheet_id: str, row_num: int, status: str, doc_url: str
) -> None:
    try:
        sheet_meta = sheets_service.spreadsheets().get(
            spreadsheetId=sheet_id, fields="sheets.properties"
        ).execute()
        internal_sheet_id = sheet_meta["sheets"][0]["properties"]["sheetId"]
    except Exception:
        return

    requests = []

    color_map = {
        "Upcoming": {"red": 0.85, "green": 0.95, "blue": 0.85},
        "Imminent": {"red": 1.0, "green": 0.95, "blue": 0.8},
        "Completed": {"red": 0.9, "green": 0.9, "blue": 0.9},
    }
    bg = color_map.get(status, {"red": 1, "green": 1, "blue": 1})

    if row_num > 0:
        requests.append({
            "repeatCell": {
                "range": {
                    "sheetId": internal_sheet_id,
                    "startRowIndex": row_num - 1,
                    "endRowIndex": row_num,
                    "startColumnIndex": 7,
                    "endColumnIndex": 8,
                },
                "cell": {
                    "userEnteredFormat": {
                        "backgroundColor": bg,
                    }
                },
                "fields": "userEnteredFormat.backgroundColor",
            }
        })

    if requests:
        try:
            sheets_service.spreadsheets().batchUpdate(
                spreadsheetId=sheet_id, body={"requests": requests}
            ).execute()
        except Exception as e:
            logger.warning("Could not apply formatting: %s", e)


def sync_pipeline_sheet(
    sheets_service,
    state: StateManager,
    sheet_id: str,
) -> None:
    from pipeline_tracker import get_pipeline_summary

    summaries = get_pipeline_summary(state)
    if not summaries:
        return

    rows = []
    for s in summaries:
        latest_notes = ""
        pipeline = state.get_pipeline(s["company_key"])
        if pipeline and pipeline.get("notes"):
            latest_notes = pipeline["notes"][-1]["text"]

        rows.append([
            s["company_name"],
            s["role_title"],
            s["status"],
            s["current_stage"],
            s["stage_count"],
            s["days_silent"],
            s["next_action"],
            datetime.fromisoformat(pipeline["last_activity"]).strftime("%Y-%m-%d")
                if pipeline else "",
            truncate(latest_notes, 200),
        ])

    try:
        sheets_service.spreadsheets().values().update(
            spreadsheetId=sheet_id,
            range=f"'{PIPELINE_SHEET_NAME}'!A2:I{len(rows) + 1}",
            valueInputOption="USER_ENTERED",
            body={"values": rows},
        ).execute()

        _apply_pipeline_formatting(sheets_service, sheet_id, summaries)
        logger.info("Pipeline overview synced: %d rows", len(rows))
    except Exception as e:
        logger.warning("Could not sync pipeline sheet: %s", e)


def _apply_pipeline_formatting(
    sheets_service, sheet_id: str, summaries: list[dict]
) -> None:
    try:
        sheet_meta = sheets_service.spreadsheets().get(
            spreadsheetId=sheet_id, fields="sheets.properties"
        ).execute()
        pipeline_sheet_id = None
        for sheet in sheet_meta["sheets"]:
            if sheet["properties"]["title"] == PIPELINE_SHEET_NAME:
                pipeline_sheet_id = sheet["properties"]["sheetId"]
                break
        if pipeline_sheet_id is None:
            return
    except Exception:
        return

    status_colors = {
        "Active": {"red": 0.85, "green": 0.95, "blue": 0.85},
        "Offer": {"red": 0.8, "green": 0.9, "blue": 1.0},
        "Rejected": {"red": 1.0, "green": 0.85, "blue": 0.85},
        "Withdrawn": {"red": 0.9, "green": 0.9, "blue": 0.9},
    }

    requests = []
    for i, s in enumerate(summaries):
        bg = status_colors.get(s["status"], {"red": 1, "green": 1, "blue": 1})
        requests.append({
            "repeatCell": {
                "range": {
                    "sheetId": pipeline_sheet_id,
                    "startRowIndex": i + 1,
                    "endRowIndex": i + 2,
                    "startColumnIndex": 2,
                    "endColumnIndex": 3,
                },
                "cell": {"userEnteredFormat": {"backgroundColor": bg}},
                "fields": "userEnteredFormat.backgroundColor",
            }
        })

        if s["needs_follow_up"] or s["days_silent"] > 7:
            requests.append({
                "repeatCell": {
                    "range": {
                        "sheetId": pipeline_sheet_id,
                        "startRowIndex": i + 1,
                        "endRowIndex": i + 2,
                        "startColumnIndex": 6,
                        "endColumnIndex": 7,
                    },
                    "cell": {
                        "userEnteredFormat": {
                            "backgroundColor": {"red": 1.0, "green": 0.9, "blue": 0.7},
                            "textFormat": {"bold": True},
                        }
                    },
                    "fields": "userEnteredFormat(backgroundColor,textFormat)",
                }
            })

    if requests:
        try:
            sheets_service.spreadsheets().batchUpdate(
                spreadsheetId=sheet_id, body={"requests": requests}
            ).execute()
        except Exception as e:
            logger.warning("Could not apply pipeline formatting: %s", e)
