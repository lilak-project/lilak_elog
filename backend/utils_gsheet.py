"""
Google Sheets sync via a service account.

The user creates a Google Cloud service account, enables the Sheets API,
downloads the JSON key, shares their spreadsheet with the service account's
email (Editor), and pastes the key + spreadsheet ID into elog. We then push
the run-number-centric table to that worksheet on demand / on new logs.
"""

from __future__ import annotations

import json
import re
from typing import Optional

GSHEET_SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
]


class GSheetError(Exception):
    pass


def extract_spreadsheet_id(value: str) -> str:
    """Accept either a raw ID or a full Google Sheets URL."""
    if not value:
        return ""
    m = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", value)
    return m.group(1) if m else value.strip()


def _client(credentials_json: str):
    import gspread
    from google.oauth2.service_account import Credentials
    try:
        info = json.loads(credentials_json)
    except Exception as e:
        raise GSheetError(f"Invalid credentials JSON: {e}")
    try:
        creds = Credentials.from_service_account_info(info, scopes=GSHEET_SCOPES)
        return gspread.authorize(creds), info.get("client_email", "")
    except Exception as e:
        raise GSheetError(f"Auth failed: {e}")


def validate_and_describe(credentials_json: str, spreadsheet_id: str, worksheet: str) -> dict:
    """Open the spreadsheet to verify access. Returns {email, title}."""
    gc, email = _client(credentials_json)
    try:
        sh = gc.open_by_key(spreadsheet_id)
    except Exception as e:
        raise GSheetError(
            f"Cannot open spreadsheet — did you share it with {email or 'the service account'} as Editor? ({e})"
        )
    return {"email": email, "title": sh.title}


def push_table(credentials_json: str, spreadsheet_id: str, worksheet: str,
               header: list[str], rows: list[list]) -> None:
    """Overwrite the worksheet with header + rows."""
    gc, _ = _client(credentials_json)
    try:
        sh = gc.open_by_key(spreadsheet_id)
    except Exception as e:
        raise GSheetError(f"Cannot open spreadsheet: {e}")

    ws_name = worksheet or "elog"
    try:
        ws = sh.worksheet(ws_name)
    except Exception:
        ws = sh.add_worksheet(title=ws_name, rows=max(len(rows) + 10, 100), cols=max(len(header) + 2, 20))

    data = [header] + [[("" if c is None else c) for c in r] for r in rows]
    ws.clear()
    if data:
        ws.update(range_name="A1", values=data)
