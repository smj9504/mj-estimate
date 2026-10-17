"""
Import the local AccuLynx backup (backend/scripts/acculynx_archive/data) into
the archive tables. Document files are not uploaded anywhere - they live in
Google Drive (backend/scripts/acculynx_archive/stage_for_drive.py builds the
folder tree to upload); only the document list is stored here.

For each non-cancelled job:
  1. find or create the client (see resolve_client)
  2. upsert the archived job row, with its Drive folder name
  3. one archived document row per file (name, AccuLynx folder, Drive path)
  4. store each Communication message as text, linking its attachments to
     those document rows

After the folders are in Drive, --drive-ids takes {folder name: Drive folder
id} and stores each job's folder id so the app links straight to it.

Safe to re-run: finished jobs are skipped, and an interrupted job resumes
where it stopped (documents/messages are keyed by their AccuLynx ids).

    cd backend
    .venv/Scripts/python.exe -m app.domains.acculynx_archive.importer --dry-run
    .venv/Scripts/python.exe -m app.domains.acculynx_archive.importer --limit 3
    .venv/Scripts/python.exe -m app.domains.acculynx_archive.importer
    .venv/Scripts/python.exe -m app.domains.acculynx_archive.importer --drive-ids ids.json
"""

import argparse
import json
import logging
import mimetypes
import os
import re
import sys
import time
from collections import Counter
from datetime import datetime
from decimal import Decimal
from html.parser import HTMLParser
from pathlib import Path
from typing import Optional

from sqlalchemy import func, text

from app.core.database_factory import get_database
from app.domains.client.address_utils import normalize_address
from app.domains.client.models import Client

from .models import AccuLynxArchivedDocument, AccuLynxArchivedJob, AccuLynxArchivedMessage

logger = logging.getLogger(__name__)

DEFAULT_DATA_DIR = Path(__file__).resolve().parents[3] / "scripts" / "acculynx_archive" / "data"
ATTACHMENT_FOLDER = "Email Attachments"
RECIPIENT_TYPES = {0: "to", 1: "cc", 2: "bcc"}


# ---------------------------------------------------------------- helpers

def long_path(p: Path) -> str:
    """Backup paths can pass Windows' 260-char limit."""
    s = str(p.resolve())
    return "\\\\?\\" + s if os.name == "nt" and not s.startswith("\\\\?\\") else s


def read_json(p: Path):
    with open(long_path(p), encoding="utf-8") as f:
        return json.load(f)


def parse_dt(value) -> Optional[datetime]:
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        pass
    try:  # document listing uses "05/01/2026 12:29 PM"
        return datetime.strptime(value, "%m/%d/%Y %I:%M %p")
    except ValueError:
        return None


def money(value) -> Optional[Decimal]:
    try:
        return Decimal(str(value)) if value is not None else None
    except Exception:
        return None


def state_abbr(state) -> Optional[str]:
    if isinstance(state, dict):
        return state.get("abbreviation") or state.get("name")
    return state or None


def digits(phone: Optional[str]) -> str:
    return "".join(ch for ch in (phone or "") if ch.isdigit())[-10:]


def clip(value, length: int):
    return value[:length] if isinstance(value, str) else value


class _TextExtractor(HTMLParser):
    SKIP = {"style", "script", "head", "title"}
    BLOCK = {"br", "p", "div", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table", "blockquote"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self._skip += 1
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP:
            self._skip = max(0, self._skip - 1)
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self._skip:
            self.parts.append(data)


def html_to_text(content: Optional[str]) -> str:
    if not content:
        return ""
    if "<" not in content:
        return content.strip()
    parser = _TextExtractor()
    parser.feed(content)
    parser.close()
    lines = [re.sub(r"[ \t ]+", " ", line).strip() for line in "".join(parser.parts).splitlines()]
    out, blank = [], False
    for line in lines:
        if line:
            out.append(line)
            blank = False
        elif not blank and out:
            out.append("")
            blank = True
    return "\n".join(out).strip()


# ---------------------------------------------------------------- importer

class ArchiveImporter:
    def __init__(self, data_dir: Path, dry_run: bool = False):
        self.data_dir = data_dir
        self.dry_run = dry_run
        # raw SQLAlchemy session - get_session() wraps it for the repositories
        self.session = get_database().SessionLocal()
        contacts = read_json(data_dir / "contacts.json").get("items", [])
        self.contacts = {c["id"]: c for c in contacts}
        self.stats = Counter()
        folders_file = data_dir / "drive_folders.json"
        self.drive_folders = read_json(folders_file) if folders_file.exists() else {}
        self._has_contact_links = self._table_exists("acculynx_contact_links")
        self._dry_new_contacts: set = set()  # dry run: contacts that would get a new client
        # a dry run may happen before the archive tables are created
        self._archive_tables = self._table_exists("acculynx_archived_jobs")

    def _table_exists(self, name: str) -> bool:
        try:
            self.session.execute(text(f"SELECT 1 FROM {name} LIMIT 1"))
            return True
        except Exception:
            self.session.rollback()
            return False

    def _find(self, model, **filters):
        if not self._archive_tables:
            return None
        return self.session.query(model).filter_by(**filters).first()

    # ---- client matching

    def _primary_contact(self, record: dict) -> dict:
        items = (record.get("contacts") or {}).get("items") or record["job"].get("contacts") or []
        primary = next((c for c in items if c.get("isPrimary")), items[0] if items else None)
        if not primary:
            return {}
        cid = (primary.get("contact") or {}).get("id") or primary.get("id")
        return self.contacts.get(cid) or primary.get("contact") or {}

    @staticmethod
    def _contact_fields(contact: dict) -> dict:
        name = " ".join(filter(None, [(contact.get("firstName") or "").strip(), (contact.get("lastName") or "").strip()]))
        name = name or (contact.get("companyName") or "").strip()
        phones = [p for p in contact.get("phoneNumbers") or [] if p.get("number")]
        emails = [e for e in contact.get("emailAddresses") or [] if e.get("address")]
        phone = next((p["number"] for p in phones if p.get("primary")), phones[0]["number"] if phones else None)
        email = next((e["address"] for e in emails if e.get("primary")), emails[0]["address"] if emails else None)
        return {"name": name, "phone": phone, "email": email}

    def resolve_client(self, record: dict, contact: dict) -> tuple[Optional[Client], str]:
        """
        Match order, most to least certain:
          1. contact already linked to a client by the old AccuLynx integration
          2. same contact already imported for another job
          3. same street address (and zip, when the client has one)
          4. same email, then same phone - only when exactly one client matches
        Returns (client or None, how it matched); None means "create one".
        """
        cid = contact.get("id")
        if cid and self._has_contact_links:
            row = self.session.execute(
                text("SELECT client_id FROM acculynx_contact_links WHERE acculynx_contact_id = :cid"),
                {"cid": cid},
            ).first()
            client = row and self.session.get(Client, row[0])
            if client:
                return client, "contact_link"

        if cid:
            prior = self._find(AccuLynxArchivedJob, acculynx_contact_id=cid)
            if prior:
                return self.session.get(Client, prior.client_id), "same_contact"
            if cid in self._dry_new_contacts:
                return None, "same_contact"

        loc = record["job"].get("locationAddress") or {}
        street = normalize_address(loc.get("street1") or "")
        if street:
            zip5 = (loc.get("zipCode") or "")[:5]
            candidates = [
                c for c in self.session.query(Client).filter(Client.normalized_address == street).all()
                if not c.zipcode or not zip5 or c.zipcode[:5] == zip5
            ]
            if len(candidates) == 1:
                return candidates[0], "address"

        fields = self._contact_fields(contact)
        if fields["email"]:
            found = self.session.query(Client).filter(
                func.lower(Client.email) == fields["email"].lower()
            ).all()
            if len(found) == 1:
                return found[0], "email"
        if len(digits(fields["phone"])) == 10:
            tail = digits(fields["phone"])
            found = [
                c for c in self.session.query(Client).filter(Client.phone.isnot(None)).all()
                if digits(c.phone) == tail
            ]
            if len(found) == 1:
                return found[0], "phone"

        return None, "new"

    def create_client(self, record: dict, contact: dict) -> Client:
        fields = self._contact_fields(contact)
        loc = record["job"].get("locationAddress") or contact.get("mailingAddress") or {}
        street = ", ".join(filter(None, [loc.get("street1"), loc.get("street2")])) or None
        job = record["job"]
        client = Client(
            display_name=clip(fields["name"] or job.get("jobName") or "AccuLynx client", 500),
            owners=[{
                "name": fields["name"] or job.get("jobName") or "",
                "phone": fields["phone"] or "",
                "email": fields["email"] or "",
                "is_primary": True,
            }],
            address=street,
            city=clip(loc.get("city"), 100),
            state=clip(state_abbr(loc.get("state")), 50),
            zipcode=clip(loc.get("zipCode"), 20),
            normalized_address=normalize_address(street) if street else None,
            phone=clip(fields["phone"], 50),
            email=clip(fields["email"], 255),
            notes="Imported from AccuLynx",
            source="acculynx",
            is_active=True,
        )
        self.session.add(client)
        self.session.flush()
        return client

    # ---- job row

    def build_job_fields(self, record: dict, contact: dict) -> dict:
        job = record["job"]
        loc = job.get("locationAddress") or {}
        insurance = record.get("insurance") or {}
        adjuster = record.get("adjuster") or {}
        financials = record.get("financials") or {}
        received = ((record.get("payments") or {}).get("receivedPayments") or {}).get("total")
        return {
            "acculynx_contact_id": contact.get("id"),
            "job_number": clip(job.get("jobNumber") or None, 50),
            "job_name": clip(job.get("jobName"), 500),
            "milestone": job.get("currentMilestone"),
            "trade_types": clip(", ".join(t.get("name", "") for t in job.get("tradeTypes") or []) or None, 255),
            "work_type": clip((job.get("workType") or {}).get("name"), 100),
            "address": ", ".join(filter(None, [loc.get("street1"), loc.get("street2")])) or None,
            "city": clip(loc.get("city"), 100),
            "state": clip(state_abbr(loc.get("state")), 50),
            "zipcode": clip(loc.get("zipCode"), 20),
            "job_created_at": parse_dt(job.get("createdDate")),
            "milestone_date": parse_dt(job.get("milestoneDate")),
            "insurance_company": clip(
                (insurance.get("insuranceCompany") or {}).get("name") or insurance.get("customInsuranceCompanyName") or None, 255),
            "claim_number": clip(insurance.get("claimNumber") or None, 100),
            "date_of_loss": parse_dt(insurance.get("dateOfLoss")),
            "damage_location": insurance.get("damageLocation") or insurance.get("damagelocation") or None,
            "adjuster_name": clip(adjuster.get("adjusterName") or None, 255),
            "adjuster_phone": clip((adjuster.get("phone") or {}).get("number") or None, 50),
            "adjuster_email": clip(adjuster.get("email") or None, 255),
            "approved_job_value": money(financials.get("approvedJobValue")),
            "total_received": money(received),
            "balance_due": money(financials.get("balanceDue")),
            # history is ~60MB across all jobs (the full user object repeated on
            # every row) and is only kept in the local backup
            "raw": {k: v for k, v in record.items() if k != "history"},
            "drive_folder_name": self.drive_folders.get(record["job"]["id"]),
        }

    # ---- documents

    @staticmethod
    def drive_path(local: str) -> str:
        """Where stage_for_drive.py put the file inside the job's Drive folder."""
        if local.startswith("documents/"):
            return local[len("documents/"):]
        if local.startswith("message_attachments/"):
            return ATTACHMENT_FOLDER + "/" + local[len("message_attachments/"):]
        return local

    def import_documents(self, archived: AccuLynxArchivedJob, job_dir: Path) -> dict:
        """
        Document list only - the files themselves live in the job's Google
        Drive folder. Returns {backup local path -> archived document id} so
        message attachments can point at the same document.
        """
        by_path: dict = {}
        docs_file = job_dir / "documents.json"
        if not os.path.exists(long_path(docs_file)):
            return by_path
        for folder in read_json(docs_file):
            for f in folder.get("Files") or []:
                local = f.get("_local_path")
                if not local or f.get("_error"):
                    self.stats["documents_missing_in_backup"] += 1
                    continue
                existing = self._find(AccuLynxArchivedDocument, acculynx_file_id=f["Id"])
                if existing:
                    by_path[local] = existing.id
                    continue
                self.stats["documents"] += 1
                if self.dry_run:
                    by_path[local] = "dry-run"
                    continue
                doc = AccuLynxArchivedDocument(
                    archived_job_id=archived.id,
                    acculynx_file_id=f["Id"],
                    folder_name=clip(folder.get("Name"), 255),
                    name=clip(f.get("Name") or Path(local).name, 500),
                    drive_path=self.drive_path(local),
                    content_type=clip(f.get("MIMEType") or mimetypes.guess_type(local)[0], 100),
                    size=f.get("Size"),
                    uploaded_by=clip(f.get("CreatedByDisplayName"), 255),
                    uploaded_at=parse_dt(f.get("ModifiedDateUTC")) or parse_dt(f.get("CreatedDate")),
                )
                self.session.add(doc)
                self.session.flush()
                by_path[local] = doc.id
        if not self.dry_run:
            self.session.commit()
        return by_path

    # ---- messages

    def import_messages(self, archived: AccuLynxArchivedJob, job_dir: Path, by_path: dict) -> None:
        comms_file = job_dir / "communications.json"
        if not os.path.exists(long_path(comms_file)):
            return
        for entry in read_json(comms_file):
            thread = entry.get("thread") or {}
            for m in thread.get("Messages") or []:
                mid = m.get("MessageId")
                if not mid or self._find(AccuLynxArchivedMessage, acculynx_message_id=mid):
                    continue
                self.stats["messages"] += 1
                attachments = []
                for a in m.get("Attachments") or []:
                    local = a.get("_local_path")
                    doc_id = by_path.get(local) if local else None
                    if local and not doc_id and not a.get("_error"):
                        # attachment never filed into a document folder
                        att_key = f"att:{a.get('Id')}"
                        existing = self._find(AccuLynxArchivedDocument, acculynx_file_id=att_key)
                        if existing:
                            doc_id = existing.id
                        elif not self.dry_run:
                            doc = AccuLynxArchivedDocument(
                                archived_job_id=archived.id, acculynx_file_id=att_key,
                                folder_name=ATTACHMENT_FOLDER, name=clip(a.get("Name") or Path(local).name, 500),
                                drive_path=self.drive_path(local),
                                content_type=clip(mimetypes.guess_type(local)[0], 100),
                                uploaded_at=parse_dt(m.get("CreatedDate")),
                            )
                            self.session.add(doc)
                            self.session.flush()
                            doc_id = doc.id
                            by_path[local] = doc_id
                        self.stats["email_attachments"] += 1
                    attachments.append({"name": a.get("Name"), "document_id": str(doc_id) if doc_id else None})

                creator = m.get("Creator") or {}
                if self.dry_run:
                    continue
                self.session.add(AccuLynxArchivedMessage(
                    archived_job_id=archived.id,
                    acculynx_message_id=mid,
                    thread_id=m.get("ThreadId") or thread.get("ThreadId"),
                    message_type=clip((m.get("MessageType") or thread.get("ThreadType") or {}).get("Name"), 30),
                    subject=m.get("Subject"),
                    sender_name=clip(creator.get("Name") or creator.get("Details"), 255),
                    sender_email=clip(m.get("ReplyEmail"), 255),
                    recipients=[
                        {"name": r.get("Name"), "email": r.get("Email") or r.get("PhoneNumber"),
                         "type": RECIPIENT_TYPES.get(r.get("RecipientType"), "to")}
                        for r in m.get("Recipients") or []
                    ],
                    sent_at=parse_dt(m.get("CreatedDate")),
                    body_text=html_to_text(m.get("Content")) or m.get("ContentPreview"),
                    attachments=attachments,
                ))
            if not self.dry_run:
                self.session.commit()

    # ---- driver

    def import_job(self, entry: dict) -> None:
        job_dir = self.data_dir / "jobs" / entry["folder"]
        record = read_json(job_dir / "job.json")
        archived = self._find(AccuLynxArchivedJob, acculynx_job_id=entry["id"])
        if archived and archived.import_status == "complete":
            self.stats["jobs_already_done"] += 1
            return

        contact = self._primary_contact(record)
        if archived:
            client_id = archived.client_id
        else:
            client, how = self.resolve_client(record, contact)
            self.stats[f"client_{how}"] += 1
            if self.dry_run:
                # count documents/messages without touching the database
                fake = AccuLynxArchivedJob(id=None)
                self.import_messages(fake, job_dir, self.import_documents(fake, job_dir))
                if how == "new" and contact.get("id"):
                    self._dry_new_contacts.add(contact["id"])
                return
            client = client or self.create_client(record, contact)
            client_id = client.id

        fields = self.build_job_fields(record, contact)
        if archived:
            for k, v in fields.items():
                setattr(archived, k, v)
        else:
            archived = AccuLynxArchivedJob(client_id=client_id, acculynx_job_id=entry["id"], **fields)
            self.session.add(archived)
        archived.import_status = "importing"
        self.session.commit()

        by_path = self.import_documents(archived, job_dir)
        self.import_messages(archived, job_dir, by_path)

        archived.document_count = self.session.query(AccuLynxArchivedDocument).filter_by(archived_job_id=archived.id).count()
        archived.message_count = self.session.query(AccuLynxArchivedMessage).filter_by(archived_job_id=archived.id).count()
        archived.import_status = "complete"
        self.session.commit()
        self.stats["jobs_imported"] += 1


def set_drive_ids(ids: dict) -> int:
    session = get_database().SessionLocal()
    by_name = {name.strip().lower(): fid for name, fid in ids.items()}
    matched = 0
    missing = []
    for job in session.query(AccuLynxArchivedJob).all():
        fid = by_name.get((job.drive_folder_name or "").strip().lower())
        if fid:
            job.drive_folder_id = fid
            matched += 1
        else:
            missing.append(job.drive_folder_name)
    session.commit()
    print(f"Drive folder id set on {matched} jobs; {len(missing)} without a match")
    for name in missing[:20]:
        print(f"  {name}")
    return 0


def _load_all_models() -> None:
    """Client's relationships name other domains' models by string, so every
    models module must be imported before the first query (the API server
    does this through its routers; a CLI has to do it itself)."""
    import importlib
    import pkgutil

    import app.domains as domains

    for mod in pkgutil.walk_packages(domains.__path__, prefix="app.domains."):
        if mod.name.rsplit(".", 1)[-1].endswith("models"):  # models, sketch_models, ...
            try:
                importlib.import_module(mod.name)
            except Exception as e:  # an optional integration missing its deps
                logger.warning("skipped %s: %s", mod.name, e)


def main() -> int:
    _load_all_models()
    parser = argparse.ArgumentParser(description="Import the AccuLynx backup into the archive tables")
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--dry-run", action="store_true", help="report matches/counts, write nothing")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--job", help="only this AccuLynx job id")
    parser.add_argument("--drive-ids", type=Path,
                        help="JSON {Drive folder name: folder id}; only sets drive_folder_id, imports nothing")
    args = parser.parse_args()
    logging.basicConfig(level=logging.WARNING)

    if args.drive_ids:
        return set_drive_ids(read_json(args.drive_ids))

    index = [j for j in read_json(args.data / "jobs_index.json") if j.get("milestone") != "Cancelled"]
    if args.job:
        index = [j for j in index if j["id"] == args.job]
    if args.limit:
        index = index[: args.limit]

    importer = ArchiveImporter(args.data, dry_run=args.dry_run)
    if not args.dry_run:
        from app.core.config import settings
        print(f"DB: {settings.DATABASE_URL.split('@')[-1].split('/')[0]}")
    started = time.monotonic()
    failed = []
    for n, entry in enumerate(index, 1):
        try:
            importer.import_job(entry)
        except Exception as e:
            importer.session.rollback()
            failed.append((entry["folder"], str(e)[:300]))
            logger.exception("job %s failed", entry["folder"])
        if n % 10 == 0 or n == len(index):
            print(f"  {n}/{len(index)}  [{time.monotonic() - started:.0f}s]  "
                  + ", ".join(f"{k}={v}" for k, v in sorted(importer.stats.items())))

    print("\nSummary:")
    for k, v in sorted(importer.stats.items()):
        print(f"  {k}: {v:,}" if isinstance(v, int) else f"  {k}: {v}")
    if failed:
        print(f"\n{len(failed)} jobs failed (re-run to retry):")
        for folder, err in failed:
            print(f"  {folder}: {err}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
