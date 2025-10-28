"""
Google Sheets API client for reading and monitoring sheet data
"""

from typing import List, Dict, Any, Optional
from datetime import datetime
import httpx
from app.core.config import settings


class GoogleSheetsClient:
    """Google Sheets API client"""

    def __init__(self, spreadsheet_id: str, api_key: Optional[str] = None):
        """
        Initialize Google Sheets client

        Args:
            spreadsheet_id: Google Sheets spreadsheet ID
            api_key: Google API key (defaults to settings)
        """
        self.spreadsheet_id = spreadsheet_id
        self.api_key = api_key or settings.GOOGLE_API_KEY
        self.base_url = "https://sheets.googleapis.com/v4/spreadsheets"

    async def get_sheet_values(
        self,
        range_name: str = "Sheet1!A:Z",
        value_render_option: str = "FORMATTED_VALUE"
    ) -> List[List[Any]]:
        """
        Get values from Google Sheet

        Args:
            range_name: A1 notation range (e.g., "Sheet1!A:Z")
            value_render_option: How values should be rendered

        Returns:
            List of rows, each row is a list of cell values
        """
        async with httpx.AsyncClient() as client:
            url = f"{self.base_url}/{self.spreadsheet_id}/values/{range_name}"
            params = {
                "key": self.api_key,
                "valueRenderOption": value_render_option
            }

            response = await client.get(url, params=params)
            response.raise_for_status()

            data = response.json()
            return data.get("values", [])

    async def get_sheet_metadata(self) -> Dict[str, Any]:
        """
        Get spreadsheet metadata including sheet names and properties

        Returns:
            Spreadsheet metadata dictionary
        """
        async with httpx.AsyncClient() as client:
            url = f"{self.base_url}/{self.spreadsheet_id}"
            params = {"key": self.api_key}

            response = await client.get(url, params=params)
            response.raise_for_status()

            return response.json()

    def parse_row_to_dict(
        self,
        row: List[Any],
        header_mapping: Dict[int, str]
    ) -> Dict[str, Any]:
        """
        Parse a row into a dictionary using header mapping

        Args:
            row: List of cell values
            header_mapping: Mapping of column index to field name

        Returns:
            Dictionary of field name to value
        """
        result = {}
        for col_idx, field_name in header_mapping.items():
            if col_idx < len(row):
                value = row[col_idx]
                # Clean empty strings to None
                result[field_name] = value if value != "" else None
            else:
                result[field_name] = None
        return result


# Default column mapping for Water Mitigation sheet
# Based on actual Google Sheets structure:
# Property Address | Insured | Phone | Email | Insurance | Policy # | Claim # | DOL | WM |
# Ins. Adjuster | Phone | Email | Inspection Date | Inspection Time | Plumber's Report | Mitigation
WM_HEADER_MAPPING = {
    0: "property_address",          # A: Property Address
    1: "homeowner_name",             # B: Insured (Homeowner Name)
    2: "homeowner_phone",            # C: Phone
    3: "homeowner_email",            # D: Email
    4: "insurance_company",          # E: Insurance
    5: "insurance_policy_number",    # F: Policy #
    6: "claim_number",               # G: Claim #
    7: "date_of_loss",               # H: DOL (Date of Loss)
    8: "mitigation_period",          # I: WM (Mitigation Period)
    9: "adjuster_name",              # J: Ins. Adjuster
    10: "adjuster_phone",            # K: Phone (Adjuster)
    11: "adjuster_email",            # L: Email (Adjuster)
    12: "inspection_date",           # M: Inspection Date
    13: "inspection_time",           # N: Inspection Time
    14: "plumbers_report",           # O: Plumber's Report
    15: "mitigation_flag",           # P: Mitigation
    # Q, R: Empty columns (reserved for future use)
}
