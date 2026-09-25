"""
Settings for the one-off AccuLynx -> Google Drive / Google Sheets export.

Everything comes from environment variables (or backend/.env) so no secret
ever lands in the repo. See README.md for what each one is for.
"""

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parents[2] / ".env")
except ImportError:
    pass


@dataclass
class ExportConfig:
    # AccuLynx API key (Bearer token) - my.acculynx.com/apikeys
    acculynx_api_key: str = field(default_factory=lambda: os.getenv("ACCULYNX_API_KEY", ""))

    # Local working directory for raw JSON, downloaded files and state
    export_dir: Path = field(
        default_factory=lambda: Path(os.getenv("ACCULYNX_EXPORT_DIR", "acculynx_export_data")).resolve()
    )

    # Google service account: either a key file path or the JSON itself
    google_service_account_file: Optional[str] = field(
        default_factory=lambda: os.getenv("ACCULYNX_EXPORT_SERVICE_ACCOUNT_FILE")
        or os.getenv("GDRIVE_SERVICE_ACCOUNT_FILE")
    )
    google_service_account_json: Optional[str] = field(
        default_factory=lambda: os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
    )

    # Shared Drive that receives the archive (service accounts have no My Drive quota).
    shared_drive_id: str = field(default_factory=lambda: os.getenv("ACCULYNX_EXPORT_SHARED_DRIVE_ID", ""))
    # Optional folder inside the Shared Drive; defaults to the Shared Drive root.
    parent_folder_id: str = field(default_factory=lambda: os.getenv("ACCULYNX_EXPORT_PARENT_FOLDER_ID", ""))
    archive_folder_name: str = field(
        default_factory=lambda: os.getenv("ACCULYNX_EXPORT_FOLDER_NAME", "AccuLynx Archive")
    )
    spreadsheet_name: str = field(
        default_factory=lambda: os.getenv("ACCULYNX_EXPORT_SPREADSHEET_NAME", "AccuLynx Archive")
    )

    # AccuLynx web app (for Communications / Photos / Documents, which the API cannot read)
    acculynx_web_url: str = field(
        default_factory=lambda: os.getenv("ACCULYNX_WEB_URL", "https://my.acculynx.com")
    )

    # Earliest date used when listing jobs / appointments by date range
    history_start_date: str = field(
        default_factory=lambda: os.getenv("ACCULYNX_EXPORT_START_DATE", "2010-01-01")
    )

    # ---- derived paths ----
    @property
    def raw_api_dir(self) -> Path:
        return self.export_dir / "raw" / "api"

    @property
    def raw_web_dir(self) -> Path:
        return self.export_dir / "raw" / "web"

    @property
    def files_dir(self) -> Path:
        return self.export_dir / "files"

    @property
    def state_dir(self) -> Path:
        return self.export_dir / "state"

    def google_credentials(self, scopes):
        from google.oauth2 import service_account

        if self.google_service_account_json:
            info = json.loads(self.google_service_account_json)
            return service_account.Credentials.from_service_account_info(info, scopes=scopes)
        if self.google_service_account_file:
            return service_account.Credentials.from_service_account_file(
                self.google_service_account_file, scopes=scopes
            )
        raise RuntimeError(
            "Google credentials missing: set ACCULYNX_EXPORT_SERVICE_ACCOUNT_FILE "
            "(or GDRIVE_SERVICE_ACCOUNT_FILE / GOOGLE_SERVICE_ACCOUNT_JSON)"
        )
