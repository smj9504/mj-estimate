"""
Visual similarity ordering for Water Mitigation photos.

Each photo gets a small fingerprint (WMPhoto.visual_signature) so the gallery
can show photos that look alike next to each other, which makes it easier to
spot duplicates to delete by hand. Pure image math - no AI calls.

Signature: 16 hex chars of a 64-bit dHash (structure) followed by 96 hex
chars of a 4x4 RGB thumbnail (color layout). An empty string marks a photo
whose image could not be read, so it isn't retried on every backfill.
"""

import io
import logging
from collections import defaultdict
from typing import Iterable, Optional

import numpy as np

logger = logging.getLogger(__name__)

SIGNATURE_LENGTH = 16 + 96

# Combined distance (fraction of differing dHash bits + 2 x mean color
# difference) at or below which two photos count as similar. Tuned on archived
# jobs: the same spot or meter shot reframed lands under ~0.35, while unrelated
# pairs sit around 0.8 (1st percentile ~0.46).
SIMILAR_THRESHOLD = 0.30

# Category order for the "All" view, matching the photo gallery sidebar
CATEGORY_ORDER = [
    "uncategorized",
    "property-overview",
    "wet-area",
    "personal-properties",
    "pre-mitigation-moving",
    "demolition",
    "containment",
    "protection",
    "drying-process",
    "day-1",
    "day-2",
    "day-3",
    "documentation",
]


def compute_visual_signature(image_data: bytes) -> Optional[str]:
    """Fingerprint an image. Returns None if it can't be decoded."""
    try:
        from PIL import Image, ImageOps

        img = Image.open(io.BytesIO(image_data))
        img.draft("RGB", (64, 64))  # decode JPEGs at reduced scale - much faster
        img = ImageOps.exif_transpose(img).convert("RGB")

        gray = np.asarray(img.convert("L").resize((9, 8), Image.LANCZOS), dtype=np.int16)
        bits = (gray[:, :-1] > gray[:, 1:]).flatten()
        dhash = int("".join("1" if b else "0" for b in bits), 2)

        colors = img.resize((4, 4), Image.BOX).tobytes()
        return f"{dhash:016x}{colors.hex()}"
    except Exception as e:
        logger.warning(f"Failed to compute visual signature: {e}")
        return None


def _distance_matrix(signatures: list[str]) -> np.ndarray:
    """Pairwise combined distance between signatures."""
    n = len(signatures)
    hashes = np.array([int(s[:16], 16) for s in signatures], dtype=">u8")
    bits = np.unpackbits(hashes.view(np.uint8).reshape(n, 8), axis=1)
    shape = (bits[:, None, :] != bits[None, :, :]).mean(axis=2)

    colors = np.array(
        [np.frombuffer(bytes.fromhex(s[16:]), dtype=np.uint8) for s in signatures],
        dtype=np.int16,
    )
    color = np.abs(colors[:, None, :] - colors[None, :, :]).mean(axis=2) / 255

    return shape + 2 * color


def _normalize_category(category: Optional[str]) -> str:
    normalized = (category or "").strip().lower().replace(" ", "-").replace("_", "-")
    return normalized or "uncategorized"


def _category_sort_key(category: str) -> tuple:
    if category in CATEGORY_ORDER:
        return (CATEGORY_ORDER.index(category), "")
    return (len(CATEGORY_ORDER), category)


def _timestamp(captured_date) -> float:
    return captured_date.timestamp() if captured_date else float("-inf")


def _order_category(rows: list) -> list[list]:
    """
    Split one category's rows into clusters of similar photos.

    Clusters are ordered by their newest photo (newest first, like the
    default gallery order). Inside a cluster each photo is followed by the
    most similar one not yet placed.
    """
    signed = [i for i, r in enumerate(rows) if r[3] and len(r[3]) == SIGNATURE_LENGTH]
    parent = list(range(len(rows)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    dist = None
    if len(signed) >= 2:
        dist = _distance_matrix([rows[i][3] for i in signed])
        for a, b in np.argwhere(np.triu(dist <= SIMILAR_THRESHOLD, k=1)):
            parent[find(signed[a])] = find(signed[b])

    members = defaultdict(list)
    for i in range(len(rows)):
        members[find(i)].append(i)

    position = {row_index: k for k, row_index in enumerate(signed)}
    newest_first = lambda i: (-_timestamp(rows[i][2]), str(rows[i][0]))

    clusters = []
    for indices in members.values():
        indices.sort(key=newest_first)
        chain = [indices[0]]
        remaining = indices[1:]
        while remaining:
            last = position[chain[-1]]
            nearest = min(remaining, key=lambda i: dist[last, position[i]])
            chain.append(nearest)
            remaining.remove(nearest)
        clusters.append(chain)

    clusters.sort(key=lambda chain: newest_first(chain[0]))
    return [[rows[i] for i in chain] for chain in clusters]


def order_by_similarity(rows: Iterable[tuple]) -> list[tuple]:
    """
    Order photos so similar ones sit next to each other within each category.

    rows: (photo_id, category, captured_date, visual_signature)
    Returns (photo_id, group, group_size, index_in_group) in display order.
    group numbers run 1, 2, 3... across the whole result and are None for
    photos with no similar neighbor.
    """
    by_category = defaultdict(list)
    for row in rows:
        by_category[_normalize_category(row[1])].append(row)

    ordered = []
    group = 0
    for category in sorted(by_category, key=_category_sort_key):
        for cluster in _order_category(by_category[category]):
            if len(cluster) == 1:
                ordered.append((cluster[0][0], None, 1, 1))
                continue
            group += 1
            for index, row in enumerate(cluster, start=1):
                ordered.append((row[0], group, len(cluster), index))

    return ordered
