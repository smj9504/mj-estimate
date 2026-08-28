"""
GCS -> B2 object migration for rows left behind by the storage provider switch.

Rows written while STORAGE_PROVIDER=gcs keep their "gs://" reference forever,
so once the app moved to B2 those files are only reachable while the legacy
GCS credentials stay configured. This copies each still-referenced object into
the B2 bucket under the *same object key* and (optionally) repoints the rows,
after which GCS can be retired.

The copy is a plain byte-for-byte put - it deliberately bypasses
StorageOptimizer (WebP conversion, dedup, gzip), which would rewrite both the
bytes and the key and break every reference pointing at them.

Nothing is ever deleted from GCS.

Usage:
    # 1. See what would move (default - touches nothing)
    python migrate_gcs_to_b2.py

    # 2. Copy the objects into B2, leaving the rows alone. Safe to re-run:
    #    objects already in B2 are skipped. The app resolves rows through
    #    both providers, so it keeps working at every point in between.
    python migrate_gcs_to_b2.py --execute

    # 3. Repoint the rows at B2 once the copies are in place
    python migrate_gcs_to_b2.py --execute --update-db

    # Narrow the run while checking things out
    python migrate_gcs_to_b2.py --table files --limit 5

Environment (same variables the app uses):
    GCS_BUCKET_NAME, GCS_SERVICE_ACCOUNT_FILE
    B2_BUCKET_NAME, B2_KEY_ID, B2_APPLICATION_KEY, B2_ENDPOINT
"""

import argparse
import os
import sys
import tempfile
from collections import OrderedDict
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

# Add backend/ to path so `app.*` imports resolve when run as a script
sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy import inspect, text  # noqa: E402

from app.core.database_factory import get_database  # noqa: E402


class Colors:
    """Terminal colors, matching sync_db.py"""
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'


def info(msg):
    print(f"{Colors.CYAN}{msg}{Colors.ENDC}")


def ok(msg):
    print(f"{Colors.GREEN}[OK] {msg}{Colors.ENDC}")


def warn(msg):
    print(f"{Colors.YELLOW}[!] {msg}{Colors.ENDC}")


def fail(msg):
    print(f"{Colors.RED}[X] {msg}{Colors.ENDC}")


def header(msg):
    print(f"\n{Colors.BOLD}{Colors.BLUE}{'=' * 70}{Colors.ENDC}")
    print(f"{Colors.BOLD}{Colors.BLUE}{msg}{Colors.ENDC}")
    print(f"{Colors.BOLD}{Colors.BLUE}{'=' * 70}{Colors.ENDC}")


# ---------------------------------------------------------------------------
# What holds storage references
# ---------------------------------------------------------------------------

# (table, columns holding an object reference, column naming their provider).
# contract_instances appears twice because its two PDFs carry independent
# provider columns.
TARGETS: List[Tuple[str, Tuple[str, ...], str]] = [
    ("files", ("url", "thumbnail_url"), "storage_provider"),
    ("wm_photos",
     ("file_path", "storage_file_id", "storage_thumbnail_url", "storage_web_url"),
     "storage_provider"),
    ("wm_documents",
     ("file_path", "storage_file_id", "source_pdf_path", "source_storage_file_id"),
     "storage_provider"),
    ("contract_templates", ("file_url", "storage_file_id"), "storage_provider"),
    ("contract_instances", ("filled_pdf_url",), "filled_pdf_provider"),
    ("contract_instances", ("signed_pdf_url",), "signed_pdf_provider"),
    ("wm_floor_sketches",
     ("background_image_url", "storage_file_id"), "storage_provider"),
]


def object_key(value: Optional[str], provider: Optional[str]) -> Optional[str]:
    """The GCS object key a column value refers to, or None if it isn't one.

    Two shapes count as GCS references:
      - "gs://bucket/path/to/file" - explicit, whatever the provider column says
      - a bare "path/to/file" on a row whose provider column says 'gcs'

    Everything else is left alone. That matters for columns like
    wm_photos.storage_web_url, which often holds a CompanyCam CDN https:// URL
    rather than anything of ours.
    """
    if not value:
        return None
    value = value.strip()
    if value.startswith("gs://"):
        parts = value[len("gs://"):].split("/", 1)
        return parts[1] if len(parts) == 2 else None

    if (provider or "").lower() != "gcs":
        return None
    # Bare key on a gcs row - reject anything that is plainly not an object key.
    if "://" in value or value.startswith("/") or value[1:3] == ":\\":
        return None
    return value


# ---------------------------------------------------------------------------
# Storage clients
# ---------------------------------------------------------------------------

def build_gcs_bucket():
    """GCS bucket handle built straight from env - no bucket auto-creation."""
    from google.cloud import storage
    from google.oauth2 import service_account

    bucket_name = os.getenv("GCS_BUCKET_NAME")
    if not bucket_name:
        raise RuntimeError("GCS_BUCKET_NAME is not set")

    sa_file = os.getenv("GCS_SERVICE_ACCOUNT_FILE")
    if sa_file:
        if not Path(sa_file).exists():
            raise RuntimeError(f"GCS_SERVICE_ACCOUNT_FILE not found: {sa_file}")
        creds = service_account.Credentials.from_service_account_file(sa_file)
        client = storage.Client(credentials=creds, project=creds.project_id)
    else:
        # Application default credentials (gcloud auth, workload identity, ...)
        client = storage.Client()

    bucket = client.bucket(bucket_name)
    if not bucket.exists():
        raise RuntimeError(f"GCS bucket does not exist or is not readable: {bucket_name}")
    return bucket, bucket_name


def build_b2_client():
    """B2 S3-compatible client built straight from env."""
    import boto3
    from botocore.client import Config

    bucket_name = os.getenv("B2_BUCKET_NAME")
    key_id = os.getenv("B2_KEY_ID")
    app_key = os.getenv("B2_APPLICATION_KEY")
    endpoint = os.getenv("B2_ENDPOINT")

    missing = [
        name for name, value in (
            ("B2_BUCKET_NAME", bucket_name),
            ("B2_KEY_ID", key_id),
            ("B2_APPLICATION_KEY", app_key),
            ("B2_ENDPOINT", endpoint),
        ) if not value
    ]
    if missing:
        raise RuntimeError(f"Missing B2 settings: {', '.join(missing)}")

    # boto3's signer needs a region even though B2 ignores it; derive it from
    # the endpoint host the way B2Provider does, to avoid slow auto-discovery.
    region_name = endpoint.split("//")[-1].split(".")[1]
    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=key_id,
        aws_secret_access_key=app_key,
        region_name=region_name,
        config=Config(signature_version="s3v4", retries={"max_attempts": 3, "mode": "standard"}),
    )
    try:
        # Surface a bad endpoint/credential here rather than on the first object.
        client.head_bucket(Bucket=bucket_name)
    except Exception as e:
        # A key scoped narrowly enough to lack HeadBucket can still read and
        # write objects, so this is a warning, not a stop.
        warn(f"Could not HEAD the B2 bucket ({e}) - continuing anyway")
    return client, bucket_name


def b2_has_object(client, bucket: str, key: str) -> bool:
    from botocore.exceptions import ClientError
    try:
        client.head_object(Bucket=bucket, Key=key)
        return True
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
            return False
        raise


def copy_object(gcs_bucket, b2_client, b2_bucket: str, key: str,
                overwrite: bool) -> str:
    """Copy one object GCS -> B2 at the same key.

    Returns 'copied' | 'exists' | 'missing'.
    """
    if not overwrite and b2_has_object(b2_client, b2_bucket, key):
        return "exists"

    blob = gcs_bucket.get_blob(key)
    if blob is None:
        return "missing"

    # Stream through a temp file - some of these are 100MB+ photo reports.
    with tempfile.TemporaryFile() as fh:
        blob.download_to_file(fh)
        fh.seek(0)
        extra = {"ContentType": blob.content_type} if blob.content_type else {}
        b2_client.upload_fileobj(fh, b2_bucket, key, ExtraArgs=extra or None)
    return "copied"


# ---------------------------------------------------------------------------
# Scan
# ---------------------------------------------------------------------------

class RowRef:
    """One row's GCS references, and how to repoint them."""

    def __init__(self, table, pk, ref_columns, provider_column):
        self.table = table
        self.pk = pk
        self.ref_columns = ref_columns          # {column: current value}
        self.provider_column = provider_column
        self.keys: Dict[str, str] = {}          # {column: object key}


def scan(engine, targets, limit: Optional[int]) -> Tuple[List[RowRef], "OrderedDict[str, int]"]:
    """Find rows referencing GCS objects, plus every distinct key they use."""
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    rows: List[RowRef] = []
    keys: "OrderedDict[str, int]" = OrderedDict()  # key -> reference count

    with engine.connect() as conn:
        for table, ref_columns, provider_column in targets:
            if table not in existing_tables:
                warn(f"{table}: table not present, skipping")
                continue

            table_columns = {c["name"] for c in inspector.get_columns(table)}
            usable = tuple(c for c in ref_columns if c in table_columns)
            skipped = set(ref_columns) - set(usable)
            if skipped:
                warn(f"{table}: no such column(s) {sorted(skipped)}, skipping those")
            if not usable or provider_column not in table_columns:
                warn(f"{table}: nothing usable to scan, skipping")
                continue

            select_columns = ", ".join(f'"{c}"' for c in usable + (provider_column,))
            conditions = " OR ".join(f"\"{c}\" LIKE 'gs://%'" for c in usable)
            sql = (
                f'SELECT id, {select_columns} FROM "{table}" '
                f'WHERE ({conditions}) OR LOWER("{provider_column}") = \'gcs\''
            )
            if limit:
                sql += f" LIMIT {int(limit)}"

            for record in conn.execute(text(sql)).mappings():
                provider = record.get(provider_column)
                ref = RowRef(
                    table, record["id"],
                    {c: record.get(c) for c in usable},
                    provider_column,
                )
                for column in usable:
                    key = object_key(record.get(column), provider)
                    if key:
                        ref.keys[column] = key
                        keys[key] = keys.get(key, 0) + 1
                if ref.keys:
                    rows.append(ref)

    return rows, keys


# ---------------------------------------------------------------------------
# DB update
# ---------------------------------------------------------------------------

def repoint_rows(engine, rows: List[RowRef], copied_ok: Set[str], b2_bucket: str) -> int:
    """Rewrite gs:// values to b2:// and flip the provider column.

    Only rows whose every object made it into B2 are touched - repointing a row
    at an object that isn't there would turn a working legacy row into a broken
    one. Bare-key columns keep their value; only the provider column changes.
    """
    updated = 0
    with engine.begin() as conn:
        for ref in rows:
            if any(key not in copied_ok for key in ref.keys.values()):
                continue

            assignments = {}
            for column, key in ref.keys.items():
                value = (ref.ref_columns.get(column) or "").strip()
                if value.startswith("gs://"):
                    assignments[column] = f"b2://{b2_bucket}/{key}"
            assignments[ref.provider_column] = "b2"

            set_clause = ", ".join(f'"{c}" = :{c}' for c in assignments)
            params = dict(assignments)
            params["_pk"] = ref.pk
            conn.execute(
                text(f'UPDATE "{ref.table}" SET {set_clause} WHERE id = :_pk'),
                params,
            )
            updated += 1
    return updated


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Copy still-referenced GCS objects into B2 under the same keys",
    )
    parser.add_argument("--execute", action="store_true",
                        help="actually copy objects (default is a dry run)")
    parser.add_argument("--update-db", action="store_true",
                        help="repoint rows at B2 after a successful copy (needs --execute)")
    parser.add_argument("--overwrite", action="store_true",
                        help="re-copy objects that already exist in B2")
    parser.add_argument("--table", action="append", metavar="NAME",
                        help="limit to this table (repeatable)")
    parser.add_argument("--limit", type=int, metavar="N",
                        help="scan at most N rows per table")
    args = parser.parse_args()

    if args.update_db and not args.execute:
        fail("--update-db requires --execute (rows must not outrun the objects)")
        return 1

    targets = TARGETS
    if args.table:
        wanted = set(args.table)
        targets = [t for t in TARGETS if t[0] in wanted]
        unknown = wanted - {t[0] for t in TARGETS}
        if unknown:
            fail(f"Unknown table(s): {', '.join(sorted(unknown))}")
            return 1
        if not targets:
            fail("No matching tables")
            return 1

    header("GCS -> B2 migration" + ("" if args.execute else "  (DRY RUN)"))

    # --- scan ---------------------------------------------------------------
    db = get_database()
    engine = db.engine
    info("Scanning for rows that still reference GCS...")
    rows, keys = scan(engine, targets, args.limit)

    if not keys:
        ok("No GCS references found - nothing to migrate.")
        return 0

    per_table: "OrderedDict[str, int]" = OrderedDict()
    for ref in rows:
        per_table[ref.table] = per_table.get(ref.table, 0) + 1

    print()
    info(f"{len(rows)} row(s) reference {len(keys)} distinct object(s):")
    for table, count in per_table.items():
        print(f"    {table:<22} {count} row(s)")

    print()
    info("Connecting to storage...")
    try:
        gcs_bucket, gcs_name = build_gcs_bucket()
        b2_client, b2_name = build_b2_client()
    except Exception as e:
        fail(f"Storage connection failed: {e}")
        if args.execute:
            return 1
        # A dry run is still worth reporting without the buckets - the caller
        # at least learns which rows are involved.
        warn("Listing references without checking where the objects actually are.")
        for key, count in list(keys.items())[:20]:
            suffix = f"  (x{count} rows)" if count > 1 else ""
            print(f"    {key}{suffix}")
        if len(keys) > 20:
            print(f"    ... and {len(keys) - 20} more")
        return 1
    ok(f"gs://{gcs_name}  ->  b2://{b2_name}")

    if not args.execute:
        # The useful question a dry run answers: where does each object
        # actually live right now?
        header("Where each object is")
        tally = {"to_copy": 0, "already": 0, "gone": 0}
        for key in keys:
            in_gcs = gcs_bucket.get_blob(key) is not None
            in_b2 = b2_has_object(b2_client, b2_name, key)
            if in_b2:
                tally["already"] += 1
                print(f"    {Colors.GREEN}already in B2{Colors.ENDC}  {key}")
            elif in_gcs:
                tally["to_copy"] += 1
                print(f"    {Colors.CYAN}GCS only     {Colors.ENDC}  {key}")
            else:
                tally["gone"] += 1
                print(f"    {Colors.RED}MISSING      {Colors.ENDC}  {key}")

        header("Summary")
        print(f"    would copy GCS -> B2   {tally['to_copy']}")
        print(f"    already in B2          {tally['already']}")
        print(f"    in neither (dangling)  {tally['gone']}")
        print()
        warn("Dry run - nothing copied. Re-run with --execute to copy,")
        warn("then --execute --update-db to repoint the rows.")
        return 0

    header("Copying objects")
    copied_ok: Set[str] = set()
    counts = {"copied": 0, "exists": 0, "missing": 0, "failed": 0}

    for index, key in enumerate(keys, start=1):
        prefix = f"[{index}/{len(keys)}]"
        try:
            result = copy_object(gcs_bucket, b2_client, b2_name, key, args.overwrite)
            counts[result] += 1
            if result == "copied":
                copied_ok.add(key)
                ok(f"{prefix} {key}")
            elif result == "exists":
                copied_ok.add(key)
                print(f"    {prefix} already in B2: {key}")
            else:
                warn(f"{prefix} not in GCS either (dangling row): {key}")
        except Exception as e:
            counts["failed"] += 1
            fail(f"{prefix} {key}: {e}")

    header("Summary")
    print(f"    copied      {counts['copied']}")
    print(f"    already in B2 {counts['exists']}")
    print(f"    missing     {counts['missing']}")
    print(f"    failed      {counts['failed']}")

    # --- repoint ------------------------------------------------------------
    if args.update_db:
        print()
        info("Repointing rows at B2...")
        try:
            updated = repoint_rows(engine, rows, copied_ok, b2_name)
        except Exception as e:
            fail(f"Row update failed (objects are still copied, safe to re-run): {e}")
            return 1
        ok(f"{updated} row(s) updated")
        held_back = len(rows) - updated
        if held_back:
            warn(f"{held_back} row(s) left pointing at GCS - their objects "
                 f"did not all copy. Fix those, then re-run.")
    else:
        print()
        info("Objects copied. Rows still say gs:// - the app resolves through")
        info("both providers, so nothing is broken. Re-run with --update-db")
        info("to repoint them and retire GCS.")

    return 1 if counts["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
