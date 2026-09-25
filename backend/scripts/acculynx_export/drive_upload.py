"""
Phase 3: build the Shared Drive folder tree and upload files.

    <Shared Drive>/AccuLynx Archive/
        AccuLynx Archive (Google Sheet)
        _raw_json/acculynx_raw_<date>.zip        full raw dump (API + web)
        Jobs/<Job #> - <Job Name>/
            Photos & Videos/
            Documents/<AccuLynx document folder>/
            Communications/                      message attachments
            Estimates/ ...                       other captured sections
            acculynx_job_data.json               everything the API returned for the job

Uploads are recorded in state/drive_state.json so reruns skip what is
already on Drive.
"""

import json
import logging
import re
import shutil
from datetime import date
from pathlib import Path
from typing import Any, Dict, List, Optional

from .config import ExportConfig

logger = logging.getLogger(__name__)

FOLDER_MIME = "application/vnd.google-apps.folder"
SCOPES = ["https://www.googleapis.com/auth/drive"]

SECTION_FOLDERS = {
    "photos_videos": "Photos & Videos",
    "documents": "Documents",
    "communications": "Communications",
    "estimates": "Estimates",
    "measurements": "Measurements",
    "orders": "Orders",
    "tasks": "Tasks",
}
DOC_FOLDER_KEYS = ("folderName", "documentFolderName", "folder", "documentFolder", "category")


def sanitize(name: str, limit: int = 120) -> str:
    name = re.sub(r'[\\/:*?"<>|\r\n\t]+', " ", str(name or "")).strip()
    return re.sub(r"\s+", " ", name)[:limit] or "Untitled"


def job_folder_name(record: Dict[str, Any]) -> str:
    job = record.get("job") or record.get("listing") or {}
    number = job.get("jobNumber") or ""
    name = job.get("jobName") or ""
    if not name:
        addr = job.get("locationAddress") or {}
        name = " ".join(filter(None, [addr.get("street1"), addr.get("city")]))
    return sanitize(" - ".join(filter(None, [number, name])) or job.get("id", "job"))


def folder_link(folder_id: str) -> str:
    return f"https://drive.google.com/drive/folders/{folder_id}"


class DriveArchive:
    def __init__(self, cfg: ExportConfig):
        from googleapiclient.discovery import build

        if not cfg.shared_drive_id:
            raise RuntimeError("ACCULYNX_EXPORT_SHARED_DRIVE_ID is not set")
        self.cfg = cfg
        self.service = build("drive", "v3", credentials=cfg.google_credentials(SCOPES), cache_discovery=False)
        self.state_path = cfg.state_dir / "drive_state.json"
        self.state: Dict[str, Any] = (
            json.loads(self.state_path.read_text()) if self.state_path.exists()
            else {"folders": {}, "files": {}, "jobs": {}}
        )

    def save_state(self) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.state, indent=1, ensure_ascii=False))
        tmp.replace(self.state_path)

    # ---------------- folders ----------------

    def _find_child(self, name: str, parent_id: str, mime: Optional[str] = None) -> Optional[str]:
        escaped = name.replace("\\", "\\\\").replace("'", "\\'")
        q = f"name = '{escaped}' and '{parent_id}' in parents and trashed = false"
        if mime:
            q += f" and mimeType = '{mime}'"
        res = self.service.files().list(
            q=q, fields="files(id)", corpora="drive", driveId=self.cfg.shared_drive_id,
            includeItemsFromAllDrives=True, supportsAllDrives=True, pageSize=1,
        ).execute()
        files = res.get("files", [])
        return files[0]["id"] if files else None

    def folder(self, path: List[str]) -> str:
        """Get or create a nested folder path under the archive root; cached in state."""
        parent = self.cfg.parent_folder_id or self.cfg.shared_drive_id
        key = ""
        for part in [self.cfg.archive_folder_name] + path:
            part = sanitize(part)
            key = f"{key}/{part}"
            cached = self.state["folders"].get(key)
            if cached:
                parent = cached
                continue
            folder_id = self._find_child(part, parent, FOLDER_MIME)
            if not folder_id:
                folder_id = self.service.files().create(
                    body={"name": part, "mimeType": FOLDER_MIME, "parents": [parent]},
                    fields="id", supportsAllDrives=True,
                ).execute()["id"]
            self.state["folders"][key] = folder_id
            parent = folder_id
        return parent

    @property
    def root_id(self) -> str:
        return self.folder([])

    # ---------------- files ----------------

    def upload(self, local: Path, folder_path: List[str], name: Optional[str] = None,
               state_key: Optional[str] = None, replace: bool = False) -> Dict[str, str]:
        from googleapiclient.http import MediaFileUpload

        key = state_key or str(local)
        existing = self.state["files"].get(key)
        if existing and not replace:
            return existing
        parent = self.folder(folder_path)
        name = name or local.name
        media = MediaFileUpload(str(local), resumable=local.stat().st_size > 5 * 1024 * 1024)
        if existing and replace:
            f = self.service.files().update(
                fileId=existing["id"], media_body=media, fields="id,webViewLink", supportsAllDrives=True
            ).execute()
        else:
            f = self.service.files().create(
                body={"name": name, "parents": [parent]}, media_body=media,
                fields="id,webViewLink", supportsAllDrives=True,
            ).execute()
        info = {"id": f["id"], "link": f.get("webViewLink", ""), "path": "/".join(
            [self.cfg.archive_folder_name] + folder_path + [name])}
        self.state["files"][key] = info
        return info

    # ---------------- driver ----------------

    def upload_job(self, job_id: str, record: Dict[str, Any]) -> Dict[str, Any]:
        job_state = self.state["jobs"].setdefault(job_id, {})
        name = job_state.get("folder_name") or job_folder_name(record)
        # leads without a Job # can share a name - never let two jobs share a folder
        taken = {j.get("folder_name") for jid, j in self.state["jobs"].items() if jid != job_id}
        if name in taken:
            name = f"{name} ({job_id[:8]})"
        job_state["folder_name"] = name
        base = ["Jobs", name]
        job_folder = self.folder(base)
        job_state.update({"folder_id": job_folder, "folder_link": folder_link(job_folder),
                          "folder_path": "/".join([self.cfg.archive_folder_name] + base)})

        # the job's API data, always refreshed
        api_json = self.cfg.raw_api_dir / "jobs" / f"{job_id}.json"
        if api_json.exists():
            self.upload(api_json, base, name="acculynx_job_data.json", state_key=f"job-data:{job_id}", replace=True)

        counts: Dict[str, int] = {}
        job_files_dir = self.cfg.files_dir / job_id
        for manifest_path in sorted(job_files_dir.glob("*/_manifest.json")):
            section = manifest_path.parent.name
            manifest = json.loads(manifest_path.read_text())
            changed = False
            for key, entry in manifest.items():
                if "local_path" not in entry:
                    continue
                folder_path = base + [SECTION_FOLDERS.get(section, sanitize(section.replace("_", " ").title()))]
                if section == "documents":
                    sub = next((entry["meta"].get(k) for k in DOC_FOLDER_KEYS
                                if isinstance(entry["meta"].get(k), str) and entry["meta"].get(k)), None)
                    if sub:
                        folder_path.append(sub)
                local = self.cfg.files_dir / entry["local_path"]
                info = self.upload(local, folder_path, name=entry["file_name"], state_key=f"file:{entry['local_path']}")
                if entry.get("drive") != info:
                    entry["drive"] = info
                    changed = True
                counts[section] = counts.get(section, 0) + 1
            if changed:
                manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1, default=str))
        job_state["file_counts"] = counts
        return job_state

    def upload_raw_archive(self) -> Dict[str, str]:
        raw_root = self.cfg.export_dir / "raw"
        zip_base = self.cfg.state_dir / f"acculynx_raw_{date.today().isoformat()}"
        archive = shutil.make_archive(str(zip_base), "zip", root_dir=raw_root)
        info = self.upload(Path(archive), ["_raw_json"], state_key=f"raw-zip:{Path(archive).name}", replace=True)
        self.state["raw_archive"] = info
        return info

    def run(self, job_ids: List[str]) -> None:
        self.folder(["Jobs"])
        for n, job_id in enumerate(job_ids, 1):
            path = self.cfg.raw_api_dir / "jobs" / f"{job_id}.json"
            record = json.loads(path.read_text()) if path.exists() else {"listing": {"id": job_id}}
            try:
                self.upload_job(job_id, record)
            except Exception as e:
                logger.error(f"Drive upload job {job_id}: {e}")
                self.state["jobs"].setdefault(job_id, {})["error"] = str(e)
            self.save_state()
            if n % 10 == 0 or n == len(job_ids):
                logger.info(f"Drive upload {n}/{len(job_ids)}")
        self.upload_raw_archive()
        self.save_state()
