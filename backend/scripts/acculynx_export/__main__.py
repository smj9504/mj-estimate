"""
AccuLynx full export -> Google Shared Drive + Google Sheet.

Run from backend/:
    python -m scripts.acculynx_export check
    python -m scripts.acculynx_export collect [--limit 5] [--job-id ID ...] [--refresh]
    python -m scripts.acculynx_export web-login
    python -m scripts.acculynx_export web-discover --job-id ID
    python -m scripts.acculynx_export web-capture [--limit 5] [--job-id ID ...] [--section communications ...]
    python -m scripts.acculynx_export upload [--job-id ID ...]
    python -m scripts.acculynx_export build-sheet [--local-only]
    python -m scripts.acculynx_export verify

See README.md for the full procedure.
"""

import argparse
import json
import logging
import sys
from typing import List, Optional

from .config import ExportConfig


def _job_ids(cfg: ExportConfig, explicit: Optional[List[str]], limit: Optional[int]) -> List[str]:
    if explicit:
        return explicit
    index_path = cfg.raw_api_dir / "job_index.json"
    if index_path.exists():
        ids = [j["id"] for j in json.loads(index_path.read_text())]
    else:
        ids = sorted(p.stem for p in (cfg.raw_api_dir / "jobs").glob("*.json"))
    return ids[:limit] if limit else ids


def cmd_check(cfg: ExportConfig, args) -> None:
    from .api_reader import AccuLynxReader

    with AccuLynxReader(cfg.acculynx_api_key) as api:
        api.get("/diagnostics/ping")
        page = api.get("/jobs", {"pageSize": 1, "startDate": cfg.history_start_date,
                                 "endDate": "2100-01-01"})
        print(f"AccuLynx API OK - jobs in date range: {page.get('count')}")
    if cfg.shared_drive_id:
        from .drive_upload import DriveArchive

        drive = DriveArchive(cfg)
        print(f"Google Drive OK - archive folder: https://drive.google.com/drive/folders/{drive.root_id}")
        drive.save_state()
    else:
        print("ACCULYNX_EXPORT_SHARED_DRIVE_ID not set - Drive not checked")


def cmd_collect(cfg: ExportConfig, args) -> None:
    from .api_reader import AccuLynxReader
    from .collect_api import ApiCollector

    with AccuLynxReader(cfg.acculynx_api_key) as api:
        ApiCollector(cfg, api, refresh=args.refresh).run(only_job_ids=args.job_id, limit=args.limit)


def cmd_web_login(cfg: ExportConfig, args) -> None:
    from .web_capture import web_login

    web_login(cfg)


def cmd_web_discover(cfg: ExportConfig, args) -> None:
    from .web_capture import web_discover

    web_discover(cfg, args.job_id[0])


def cmd_web_capture(cfg: ExportConfig, args) -> None:
    from .web_capture import web_capture

    web_capture(cfg, _job_ids(cfg, args.job_id, args.limit), sections=args.section,
                headless=not args.show_browser, refresh=args.refresh)


def cmd_upload(cfg: ExportConfig, args) -> None:
    from .drive_upload import DriveArchive

    DriveArchive(cfg).run(_job_ids(cfg, args.job_id, args.limit))


def cmd_build_sheet(cfg: ExportConfig, args) -> None:
    from .sheet_builder import SheetBuilder

    if args.local_only:
        import csv

        state_path = cfg.state_dir / "drive_state.json"
        state = json.loads(state_path.read_text()) if state_path.exists() else None
        tabs = SheetBuilder(cfg, state).build()
        out = cfg.export_dir / "sheet_preview"
        out.mkdir(parents=True, exist_ok=True)
        for tab in tabs.values():
            with open(out / f"{tab.name.replace('/', '-')}.csv", "w", newline="", encoding="utf-8") as f:
                csv.writer(f).writerows(tab.as_values())
            print(f"{tab.name:20} {len(tab.rows):>7} rows")
        print(f"CSV preview written to {out}")
        return

    from .drive_upload import DriveArchive
    from .sheets_writer import write_spreadsheet

    drive = DriveArchive(cfg)
    tabs = SheetBuilder(cfg, drive.state).build()
    url = write_spreadsheet(cfg, drive, tabs)
    print(url)


def cmd_verify(cfg: ExportConfig, args) -> None:
    """Compare what AccuLynx reported with what landed locally and on Drive."""
    index_path = cfg.raw_api_dir / "job_index.json"
    listed = json.loads(index_path.read_text()) if index_path.exists() else []
    job_files = {p.stem for p in (cfg.raw_api_dir / "jobs").glob("*.json")}
    with_errors = []
    for p in (cfg.raw_api_dir / "jobs").glob("*.json"):
        errs = json.loads(p.read_text()).get("errors")
        if errs:
            with_errors.append((p.stem, errs))
    web_done = {p.parent.name for p in cfg.raw_web_dir.glob("*/_done.json")}
    file_ok = file_err = 0
    for m in cfg.files_dir.glob("*/*/_manifest.json"):
        for entry in json.loads(m.read_text()).values():
            if "local_path" in entry:
                file_ok += 1
            else:
                file_err += 1
    state_path = cfg.state_dir / "drive_state.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {"jobs": {}, "files": {}}
    uploaded = sum(1 for k in state["files"] if k.startswith("file:"))

    print(f"Jobs listed by API:            {len(listed)}")
    print(f"Jobs with API data saved:      {len(job_files)}")
    print(f"Jobs missing API data:         {len({j['id'] for j in listed} - job_files)}")
    print(f"Jobs with partial API errors:  {len(with_errors)}")
    print(f"Jobs web-captured:             {len(web_done)}")
    print(f"Files downloaded / failed:     {file_ok} / {file_err}")
    print(f"Files uploaded to Drive:       {uploaded}")
    print(f"Jobs with Drive folder:        {sum(1 for j in state['jobs'].values() if j.get('folder_id'))}")
    for job_id, errs in with_errors[:20]:
        print(f"  {job_id}: {errs}")


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(prog="acculynx_export", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    def job_args(p, refresh=True):
        p.add_argument("--job-id", action="append", help="limit to these AccuLynx job ids (repeatable)")
        p.add_argument("--limit", type=int, help="only the first N jobs (for a test run)")
        if refresh:
            p.add_argument("--refresh", action="store_true", help="re-download even if already saved")

    sub.add_parser("check").set_defaults(fn=cmd_check)
    p = sub.add_parser("collect")
    job_args(p)
    p.set_defaults(fn=cmd_collect)
    sub.add_parser("web-login").set_defaults(fn=cmd_web_login)
    p = sub.add_parser("web-discover")
    p.add_argument("--job-id", action="append", required=True)
    p.set_defaults(fn=cmd_web_discover)
    p = sub.add_parser("web-capture")
    job_args(p)
    p.add_argument("--section", action="append", help="only these sections from web_pages.json")
    p.add_argument("--show-browser", action="store_true")
    p.set_defaults(fn=cmd_web_capture)
    p = sub.add_parser("upload")
    job_args(p, refresh=False)
    p.set_defaults(fn=cmd_upload)
    p = sub.add_parser("build-sheet")
    p.add_argument("--local-only", action="store_true", help="write CSV previews instead of the Google Sheet")
    p.set_defaults(fn=cmd_build_sheet)
    sub.add_parser("verify").set_defaults(fn=cmd_verify)

    args = parser.parse_args(argv)
    cfg = ExportConfig()
    cfg.export_dir.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[logging.StreamHandler(sys.stdout),
                  logging.FileHandler(cfg.export_dir / "export.log", encoding="utf-8")],
    )
    args.fn(cfg, args)


if __name__ == "__main__":
    main()
