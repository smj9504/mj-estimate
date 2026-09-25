"""
Phase 2: capture what the AccuLynx API cannot read - Communications
(texts, emails, customer portal, crew messages, logged calls, notes),
Photos & Videos and Documents - through the AccuLynx web app.

The web app loads its data from JSON calls in the background. Instead of
scraping HTML, we open each job page in a real browser (Playwright),
record every JSON response the page receives, and download any file
URLs found in them with the same logged-in session.

Commands (see __main__.py):
    web-login      open a browser, log in by hand (MFA works), save the session
    web-discover   open one job, click through its tabs by hand; records a HAR
                   file + a summary of JSON endpoints so page templates can be set
    web-capture    visit every job's pages from web_pages.json and save
                   JSON + files under raw/web/<jobId>/ and files/<jobId>/

Requires Playwright locally:  pip install playwright && playwright install chromium
"""

import hashlib
import json
import logging
import mimetypes
import re
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Tuple
from urllib.parse import unquote, urlparse

from .config import ExportConfig

logger = logging.getLogger(__name__)

PAGES_FILE = Path(__file__).with_name("web_pages.json")
PAGES_EXAMPLE_FILE = Path(__file__).with_name("web_pages.example.json")

FILE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".heic", ".heif", ".webp", ".bmp", ".tif", ".tiff",
    ".mp4", ".mov", ".m4v", ".avi", ".wmv", ".3gp", ".webm",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt", ".rtf", ".ppt", ".pptx",
    ".esx", ".xml", ".zip", ".eml", ".msg", ".mp3", ".m4a", ".wav",
}
URL_KEY_HINT = re.compile(r"(url|uri|link|href|src|path|download)", re.I)
SMALL_VARIANT_HINT = re.compile(r"(thumb|small|preview|medium|icon)", re.I)


def _state_file(cfg: ExportConfig) -> Path:
    return cfg.state_dir / "acculynx_web_session.json"


def load_page_templates() -> Dict[str, str]:
    """
    Page templates per section, e.g.
        {"communications": "{base}/jobs/{jobId}/communications", ...}
    The real paths are confirmed with `web-discover` and saved to web_pages.json.
    """
    path = PAGES_FILE if PAGES_FILE.exists() else PAGES_EXAMPLE_FILE
    data = json.loads(path.read_text())
    return {k: v for k, v in data.items() if not k.startswith("_")}


# ---------------------------------------------------------------- login / discover


def web_login(cfg: ExportConfig) -> None:
    from playwright.sync_api import sync_playwright

    cfg.state_dir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        page.goto(cfg.acculynx_web_url)
        input("Log in to AccuLynx in the opened browser, then press Enter here... ")
        context.storage_state(path=str(_state_file(cfg)))
        browser.close()
    logger.info(f"Session saved to {_state_file(cfg)}")


def web_discover(cfg: ExportConfig, job_id: str) -> None:
    """Record one job's traffic while the user clicks through its tabs."""
    from playwright.sync_api import sync_playwright

    out_dir = cfg.raw_web_dir / "_discovery"
    out_dir.mkdir(parents=True, exist_ok=True)
    har_path = out_dir / f"{job_id}.har"
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(
            storage_state=str(_state_file(cfg)),
            record_har_path=str(har_path),
            record_har_content="embed",
        )
        page = context.new_page()
        page.goto(f"{cfg.acculynx_web_url}/jobs/{job_id}")
        input(
            "In the browser, open this job's Communications (every channel/thread), "
            "Photos & Videos, Documents, Estimates and any other tab you care about.\n"
            "Scroll to the bottom of long lists. Press Enter here when done... "
        )
        context.close()
        browser.close()

    summary = summarize_har(har_path)
    (out_dir / f"{job_id}_summary.json").write_text(json.dumps(summary, indent=1))
    logger.info(f"HAR saved to {har_path}")
    for row in summary:
        logger.info(f"  {row['count']:>3}x {row['method']} {row['path']}  keys={row['top_keys'][:8]}")


def summarize_har(har_path: Path) -> List[Dict[str, Any]]:
    """Group the JSON responses in a HAR by endpoint path (ids collapsed)."""
    har = json.loads(har_path.read_text())
    groups: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for entry in har["log"]["entries"]:
        resp = entry["response"]
        if "json" not in (resp.get("content", {}).get("mimeType") or ""):
            continue
        url = urlparse(entry["request"]["url"])
        path = re.sub(r"[0-9a-fA-F-]{16,}|\b\d{3,}\b", "{id}", url.path)
        key = (entry["request"]["method"], f"{url.netloc}{path}")
        g = groups.setdefault(key, {"method": key[0], "path": key[1], "count": 0, "top_keys": [], "example_url": url.geturl()})
        g["count"] += 1
        try:
            body = json.loads(resp["content"].get("text") or "null")
            if isinstance(body, dict):
                g["top_keys"] = sorted(body.keys())
            elif isinstance(body, list) and body and isinstance(body[0], dict):
                g["top_keys"] = ["[]"] + sorted(body[0].keys())
        except (ValueError, TypeError):
            pass
    return sorted(groups.values(), key=lambda g: g["path"])


# ---------------------------------------------------------------- capture


def iter_file_refs(data: Any, context: Optional[Dict] = None) -> Iterator[Dict[str, Any]]:
    """
    Yield {"url", "meta"} for every downloadable file URL inside a JSON payload.
    `meta` is the dict that held the URL (name, folder, date, tags...), so the
    file can be labelled later. Thumbnail variants are skipped when the same
    object also carries a full-size URL.
    """
    if isinstance(data, list):
        for item in data:
            yield from iter_file_refs(item, context)
        return
    if not isinstance(data, dict):
        return

    url_fields = []
    for key, value in data.items():
        if isinstance(value, str) and value.startswith(("http://", "https://")) and _looks_like_file(key, value):
            url_fields.append((key, value))
    full_size = [kv for kv in url_fields if not SMALL_VARIANT_HINT.search(kv[0])]
    for key, value in (full_size or url_fields[:1]):
        meta = {k: v for k, v in data.items() if not isinstance(v, (dict, list))}
        yield {"url": value, "url_key": key, "meta": meta, "parent": context}

    for key, value in data.items():
        if isinstance(value, (dict, list)):
            parent = {k: v for k, v in data.items() if not isinstance(v, (dict, list))}
            yield from iter_file_refs(value, parent or context)


def _looks_like_file(key: str, url: str) -> bool:
    path = unquote(urlparse(url).path).lower()
    if Path(path).suffix in FILE_EXTENSIONS:
        return True
    return bool(URL_KEY_HINT.search(key)) and ("download" in path or "file" in path or "blob" in url)


def _file_name(ref: Dict[str, Any], content_type: Optional[str]) -> str:
    meta = ref["meta"]
    name = None
    for key in ("fileName", "filename", "originalFileName", "name", "title", "displayName"):
        if isinstance(meta.get(key), str) and meta[key].strip():
            name = meta[key].strip()
            break
    if not name:
        name = Path(unquote(urlparse(ref["url"]).path)).name or "file"
    if not Path(name).suffix:
        ext = Path(unquote(urlparse(ref["url"]).path)).suffix or mimetypes.guess_extension(content_type or "") or ""
        name += ext
    name = re.sub(r'[\\/:*?"<>|\r\n]+', "_", name)[:150]
    return name


def web_capture(cfg: ExportConfig, job_ids: List[str], sections: Optional[List[str]] = None,
                headless: bool = True, refresh: bool = False) -> None:
    from playwright.sync_api import sync_playwright

    templates = load_page_templates()
    if sections:
        templates = {k: v for k, v in templates.items() if k in sections}
    if not _state_file(cfg).exists():
        raise RuntimeError("No saved AccuLynx session - run `web-login` first")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        context = browser.new_context(storage_state=str(_state_file(cfg)), accept_downloads=True)
        for n, job_id in enumerate(job_ids, 1):
            done_marker = cfg.raw_web_dir / job_id / "_done.json"
            if done_marker.exists() and not refresh:
                continue
            summary = {}
            for section, template in templates.items():
                url = template.format(base=cfg.acculynx_web_url, jobId=job_id)
                try:
                    summary[section] = _capture_section(cfg, context, job_id, section, url)
                except Exception as e:
                    logger.error(f"job {job_id} {section}: {e}")
                    summary[section] = {"error": str(e)}
            done_marker.parent.mkdir(parents=True, exist_ok=True)
            done_marker.write_text(json.dumps(summary, indent=1))
            logger.info(f"Web capture {n}/{len(job_ids)} job {job_id}: {summary}")
            # keep the session fresh for long runs
            context.storage_state(path=str(_state_file(cfg)))
        browser.close()


def _capture_section(cfg: ExportConfig, context, job_id: str, section: str, url: str) -> Dict[str, Any]:
    json_dir = cfg.raw_web_dir / job_id / section
    json_dir.mkdir(parents=True, exist_ok=True)
    responses: List[Dict[str, Any]] = []

    def on_response(resp):
        if "json" not in (resp.headers.get("content-type") or ""):
            return
        try:
            responses.append({"url": resp.url, "status": resp.status, "body": resp.json()})
        except Exception:
            pass

    page = context.new_page()
    page.on("response", on_response)
    page.goto(url, wait_until="networkidle", timeout=90_000)
    if "login" in page.url.lower() or "signin" in page.url.lower():
        page.close()
        raise RuntimeError("AccuLynx session expired - run `web-login` again")
    _scroll_to_end(page)
    page.close()

    for i, r in enumerate(responses):
        (json_dir / f"{i:03d}.json").write_text(json.dumps(r, ensure_ascii=False, indent=1))

    # download every file referenced by the captured JSON
    file_dir = cfg.files_dir / job_id / section
    file_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = file_dir / "_manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    seen = set(manifest)
    for r in responses:
        for ref in iter_file_refs(r["body"]):
            key = hashlib.sha1(ref["url"].split("?")[0].encode()).hexdigest()[:16]
            if key in seen:
                continue
            seen.add(key)
            try:
                resp = context.request.get(ref["url"], timeout=120_000)
                if not resp.ok:
                    manifest[key] = {**ref, "error": f"HTTP {resp.status}"}
                    continue
                name = _file_name(ref, resp.headers.get("content-type"))
                local = file_dir / f"{key}_{name}"
                local.write_bytes(resp.body())
                manifest[key] = {**ref, "local_path": str(local.relative_to(cfg.files_dir)),
                                 "file_name": name, "size": local.stat().st_size,
                                 "content_type": resp.headers.get("content-type")}
            except Exception as e:
                manifest[key] = {**ref, "error": str(e)}
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1, default=str))
    ok = sum(1 for m in manifest.values() if "local_path" in m)
    return {"json_responses": len(responses), "files": ok, "file_errors": len(manifest) - ok}


def _scroll_to_end(page, max_rounds: int = 60) -> None:
    """Scroll lazily-loaded lists (message feeds, photo grids) until nothing new appears."""
    last_height = -1
    for _ in range(max_rounds):
        height = page.evaluate(
            "() => { const els=[document.scrollingElement, ...document.querySelectorAll('*')]"
            ".filter(e => e && e.scrollHeight > e.clientHeight + 50);"
            " els.forEach(e => e.scrollTop = e.scrollHeight);"
            " return els.reduce((s, e) => s + e.scrollHeight, 0); }"
        )
        page.wait_for_timeout(1200)
        if height == last_height:
            break
        last_height = height
    page.wait_for_load_state("networkidle")
