from __future__ import annotations

import logging

from config import Config
from models import InterviewEvent, PrepDocument
from state_manager import StateManager
from utils import truncate

logger = logging.getLogger(__name__)

SHEET_NAME = "Interview Tracker"

HEADERS = [
    "Date/Time", "Company", "Role", "Interviewer(s)", "Type",
    "Key Talking Points", "Status", "Prep Doc", "Calendar Link", "Notes",
]

COLUMN_WIDTHS = [180, 150, 200, 200, 120, 350, 100, 100, 100, 200]


def _create_tracker_sheet(sheets_service, drive_service, config: Config) -> str:
    logger.info("Creating new Interview Tracker spreadsheet...")

    spreadsheet = sheets_service.spreadsheets().create(
        body={
            "properties": {"title": "Interview Prep Tracker"},
            "sheets": [{"properties": {"title": SHEET_NAME}}],
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
        range=f"{SHEET_NAME}!A1:J1",
        valueInputOption="RAW",
        body={"values": [HEADERS]},
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

    talking_points = "\n".join(f"• {tp}" for tp in prep.key_talking_points[:5])
    interviewers = ", ".join(prep.interviewer_names) if prep.interviewer_names else ""
    status = _determine_status(event)

    row = [
        event.start_time.strftime("%Y-%m-%d %H:%M"),
        prep.company_name,
        prep.role_title,
        interviewers,
        prep.interview_type,
        truncate(talking_points, 500),
        status,
        doc_url,
        event.calendar_link or "",
        "",
    ]

    result = sheets_service.spreadsheets().values().append(
        spreadsheetId=sheet_id,
        range=f"{SHEET_NAME}!A:J",
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
                    "startColumnIndex": 6,
                    "endColumnIndex": 7,
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
