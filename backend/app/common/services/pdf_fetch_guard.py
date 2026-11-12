"""Which URLs WeasyPrint may fetch while it draws a PDF.

The PDF templates put user-typed text into the HTML unescaped, so a line item
or note can carry a tag like ``<link rel=attachment href=file:///proc/self/environ>``
and WeasyPrint would read that file into the PDF. Every render therefore goes
through a fetcher that calls ``check_url`` first:

- ``data:`` passes (logos and pasted photos arrive that way).
- ``file:`` passes only inside the given folders (the templates' own CSS and
  the local uploads folder). Nothing else on the server's disk can be read.
- ``http(s):`` passes (storage and CompanyCam photos, Google Fonts), except
  that in production a host that resolves to a private, loopback or
  link-local address is refused, so a PDF can't be used to reach the
  server's own network.
- Anything else (ftp:, gopher:, ...) is refused.

Standard library only: the Windows dev renderer runs WeasyPrint in a
separate script and loads this file by path.
"""
from __future__ import annotations

import ipaddress
import socket
from pathlib import Path
from typing import Iterable
from urllib.parse import urlsplit
from urllib.request import url2pathname


class PDFFetchRefused(ValueError):
    """A PDF asked for a URL it may not fetch. WeasyPrint drops the resource."""


def _file_url_path(url: str) -> Path:
    parts = urlsplit(url)
    if parts.netloc not in ("", "localhost"):
        raise PDFFetchRefused(f"PDF may not read files from another host: {url[:120]}")
    return Path(url2pathname(parts.path)).resolve()


def _resolves_to_private_address(host: str | None) -> bool:
    if not host:
        return True
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False  # Unknown host: the fetch itself fails.
    for info in infos:
        address = ipaddress.ip_address(str(info[4][0]).split("%", 1)[0])
        if (
            address.is_private
            or address.is_loopback
            or address.is_link_local
            or address.is_reserved
            or address.is_multicast
            or address.is_unspecified
        ):
            return True
    return False


def check_url(
    url: str,
    file_roots: Iterable[str | Path],
    block_private_hosts: bool = False,
) -> None:
    """Raise PDFFetchRefused unless a PDF render may fetch ``url``."""
    scheme = urlsplit(url).scheme.lower()
    if scheme == "data":
        return
    if scheme in ("http", "https"):
        if block_private_hosts and _resolves_to_private_address(urlsplit(url).hostname):
            raise PDFFetchRefused(f"PDF may not fetch from a private address: {url[:120]}")
        return
    if scheme == "file":
        path = _file_url_path(url)
        for root in file_roots:
            if path.is_relative_to(Path(root).resolve()):
                return
        raise PDFFetchRefused(f"PDF may not read this file: {url[:120]}")
    raise PDFFetchRefused(f"PDF may not fetch {scheme or 'scheme-less'} URLs: {url[:120]}")
