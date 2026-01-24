"""
Google Sheets API client for reading and monitoring sheet data

Supports two authentication methods:
1. Service Account (recommended for production) - uses GDRIVE_SERVICE_ACCOUNT_FILE
2. API Key (for public sheets only) - uses GOOGLE_API_KEY
"""

import json
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime
import httpx
from app.core.config import settings

logger = logging.getLogger(__name__)


class GoogleSheetsClient:
    """Google Sheets API client with Service Account support"""

    def __init__(self, spreadsheet_id: str, api_key: Optional[str] = None):
        """
        Initialize Google Sheets client

        Authentication priority:
        1. Service Account (GDRIVE_SERVICE_ACCOUNT_FILE) - for private sheets
        2. API Key (GOOGLE_API_KEY) - for public sheets only

        Args:
            spreadsheet_id: Google Sheets spreadsheet ID
            api_key: Google API key (defaults to settings, only used if no service account)
        """
        self.spreadsheet_id = spreadsheet_id
        self.api_key = api_key or settings.GOOGLE_API_KEY
        self.base_url = "https://sheets.googleapis.com/v4/spreadsheets"

        # Service Account authentication
        self._access_token: Optional[str] = None
        self._token_expires_at: Optional[datetime] = None
        self._service_account_file = settings.GDRIVE_SERVICE_ACCOUNT_FILE

        # Check authentication method
        if self._service_account_file:
            logger.info("Google Sheets client initialized with Service Account authentication")
        elif self.api_key:
            logger.warning("Google Sheets client using API Key (only works for public sheets)")
        else:
            logger.error("No authentication configured for Google Sheets")

    async def _get_access_token(self) -> Optional[str]:
        """
        Get access token from Service Account credentials using JWT assertion.

        Returns:
            Access token string or None if not using service account
        """
        if not self._service_account_file:
            return None

        # Check if we have a valid cached token
        if self._access_token and self._token_expires_at:
            if datetime.utcnow() < self._token_expires_at:
                return self._access_token

        try:
            import jwt
            from datetime import timedelta

            # Load service account credentials
            with open(self._service_account_file, 'r') as f:
                creds = json.load(f)

            # Create JWT assertion
            now = datetime.utcnow()
            payload = {
                "iss": creds["client_email"],
                "scope": "https://www.googleapis.com/auth/spreadsheets.readonly",
                "aud": "https://oauth2.googleapis.com/token",
                "iat": int(now.timestamp()),
                "exp": int((now + timedelta(hours=1)).timestamp())
            }

            # Sign with private key
            assertion = jwt.encode(
                payload,
                creds["private_key"],
                algorithm="RS256"
            )

            # Exchange for access token
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "https://oauth2.googleapis.com/token",
                    data={
                        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                        "assertion": assertion
                    }
                )
                response.raise_for_status()
                token_data = response.json()

            self._access_token = token_data["access_token"]
            # Token expires in 1 hour, refresh 5 minutes before
            self._token_expires_at = now + timedelta(minutes=55)

            logger.debug("Obtained new Google Sheets access token")
            return self._access_token

        except FileNotFoundError:
            logger.error(f"Service account file not found: {self._service_account_file}")
            return None
        except Exception as e:
            logger.error(f"Failed to get access token: {e}")
            return None

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
        url = f"{self.base_url}/{self.spreadsheet_id}/values/{range_name}"

        async with httpx.AsyncClient() as client:
            # Try Service Account authentication first
            access_token = await self._get_access_token()

            if access_token:
                # Use Bearer token authentication
                headers = {"Authorization": f"Bearer {access_token}"}
                params = {"valueRenderOption": value_render_option}
                response = await client.get(url, headers=headers, params=params)
            else:
                # Fallback to API Key (only works for public sheets)
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
        url = f"{self.base_url}/{self.spreadsheet_id}"

        async with httpx.AsyncClient() as client:
            # Try Service Account authentication first
            access_token = await self._get_access_token()

            if access_token:
                headers = {"Authorization": f"Bearer {access_token}"}
                response = await client.get(url, headers=headers)
            else:
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
