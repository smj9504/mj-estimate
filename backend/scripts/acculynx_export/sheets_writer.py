"""
Write the built tabs into one Google Sheet stored in the archive folder on
the Shared Drive. Re-running rewrites every tab in place (same spreadsheet),
so the sheet can be regenerated after more data is captured.
"""

import logging
from datetime import datetime
from typing import Any, Dict, List

from .config import ExportConfig
from .drive_upload import DriveArchive, folder_link
from .sheet_builder import Tab

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/spreadsheets"]
SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet"
CHUNK_ROWS = 5000
CELL_LIMIT = 10_000_000


def write_spreadsheet(cfg: ExportConfig, drive: DriveArchive, tabs: Dict[str, Tab]) -> str:
    from googleapiclient.discovery import build

    sheets = build("sheets", "v4", credentials=cfg.google_credentials(SCOPES), cache_discovery=False)

    spreadsheet_id = drive.state.get("spreadsheet_id")
    if not spreadsheet_id:
        spreadsheet_id = drive.service.files().create(
            body={"name": cfg.spreadsheet_name, "mimeType": SPREADSHEET_MIME, "parents": [drive.root_id]},
            fields="id", supportsAllDrives=True,
        ).execute()["id"]
        drive.state["spreadsheet_id"] = spreadsheet_id
        drive.save_state()

    summary = Tab("Summary", ["Item", "Value"])
    summary.add(Item="Exported at", Value=datetime.now().strftime("%Y-%m-%d %H:%M"))
    summary.add(Item="Archive folder (Shared Drive)", Value=folder_link(drive.root_id))
    if drive.state.get("raw_archive"):
        summary.add(Item="Raw JSON archive", Value=drive.state["raw_archive"].get("link"))
    for tab in tabs.values():
        summary.add(Item=f"Rows - {tab.name}", Value=len(tab.rows))
    all_tabs = [summary] + list(tabs.values())

    total_cells = sum(len(t.columns) * (len(t.rows) + 1) for t in all_tabs)
    if total_cells > CELL_LIMIT:
        raise RuntimeError(
            f"{total_cells:,} cells exceeds the Google Sheets limit ({CELL_LIMIT:,}). "
            "Split the large tabs (e.g. Communications / Job History) into a second spreadsheet."
        )

    meta = sheets.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    existing = {s["properties"]["title"]: s["properties"]["sheetId"] for s in meta["sheets"]}

    requests: List[Dict[str, Any]] = []
    for index, tab in enumerate(all_tabs):
        rows, cols = max(len(tab.rows) + 1, 2), len(tab.columns)
        grid = {"rowCount": rows, "columnCount": cols, "frozenRowCount": 1}
        if tab.name in existing:
            requests.append({"updateSheetProperties": {
                "properties": {"sheetId": existing[tab.name], "index": index, "gridProperties": grid},
                "fields": "index,gridProperties(rowCount,columnCount,frozenRowCount)",
            }})
        else:
            requests.append({"addSheet": {"properties": {"title": tab.name, "index": index, "gridProperties": grid}}})
    # drop the default empty "Sheet1" once real tabs exist
    for title, sheet_id in existing.items():
        if title not in {t.name for t in all_tabs}:
            requests.append({"deleteSheet": {"sheetId": sheet_id}})
    sheets.spreadsheets().batchUpdate(spreadsheetId=spreadsheet_id, body={"requests": requests}).execute()

    meta = sheets.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    ids = {s["properties"]["title"]: s["properties"]["sheetId"] for s in meta["sheets"]}

    for tab in all_tabs:
        sheets.spreadsheets().values().clear(spreadsheetId=spreadsheet_id, range=f"'{tab.name}'").execute()
        values = tab.as_values()
        for start in range(0, len(values), CHUNK_ROWS):
            chunk = values[start:start + CHUNK_ROWS]
            # RAW: message bodies starting with "=" must never be evaluated as formulas
            sheets.spreadsheets().values().update(
                spreadsheetId=spreadsheet_id, range=f"'{tab.name}'!A{start + 1}",
                valueInputOption="RAW", body={"values": chunk},
            ).execute()
        logger.info(f"Sheet tab '{tab.name}': {len(tab.rows)} rows")

    fmt = []
    for tab in all_tabs:
        sid = ids[tab.name]
        fmt.append({"repeatCell": {
            "range": {"sheetId": sid, "startRowIndex": 0, "endRowIndex": 1},
            "cell": {"userEnteredFormat": {"textFormat": {"bold": True},
                                           "backgroundColor": {"red": 0.9, "green": 0.93, "blue": 0.97}}},
            "fields": "userEnteredFormat(textFormat,backgroundColor)",
        }})
        fmt.append({"setBasicFilter": {"filter": {"range": {
            "sheetId": sid, "startRowIndex": 0, "endRowIndex": len(tab.rows) + 1,
            "startColumnIndex": 0, "endColumnIndex": len(tab.columns)}}}})
    sheets.spreadsheets().batchUpdate(spreadsheetId=spreadsheet_id, body={"requests": fmt}).execute()

    url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}"
    logger.info(f"Spreadsheet ready: {url}")
    return url
