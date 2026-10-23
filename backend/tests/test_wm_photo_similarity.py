"""Gallery "Similar" sort: photo fingerprints and ordering; no database required."""
import io
import sys
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.domains.water_mitigation.photo_similarity import (
    SIMILAR_THRESHOLD,
    _distance_matrix,
    compute_visual_signature,
    order_by_similarity,
)
from app.domains.water_mitigation.repository import WMPhotoRepository

T0 = datetime(2026, 10, 1, 9, 0)


def scene(seed: int, size=(1200, 900), brightness=0) -> bytes:
    """A photo-like image: colored background with a few blocks, as JPEG."""
    img = Image.new("RGB", size, ((seed * 70) % 256, (seed * 130) % 256, (seed * 50) % 256))
    draw = ImageDraw.Draw(img)
    w, h = size
    for k in range(4):
        x = ((seed * 37 + k * 97) % 70) / 100 * w
        y = ((seed * 53 + k * 61) % 70) / 100 * h
        color = ((seed * 90 + k * 60) % 256, (k * 80) % 256, (seed * 20 + k * 40) % 256)
        draw.rectangle([x, y, x + w * 0.3, y + h * 0.3], fill=color)
    if brightness:
        img = img.point(lambda v: max(0, min(255, v + brightness)))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def distance(a: bytes, b: bytes) -> float:
    return _distance_matrix([compute_visual_signature(a), compute_visual_signature(b)])[0, 1]


def row(category, minutes, signature):
    return (str(uuid4()), category, T0 + timedelta(minutes=minutes), signature)


def test_resaved_copy_is_similar_and_other_scene_is_not():
    original = scene(1)
    smaller_brighter_copy = scene(1, size=(600, 450), brightness=12)
    assert distance(original, smaller_brighter_copy) <= SIMILAR_THRESHOLD
    assert distance(original, scene(2)) > SIMILAR_THRESHOLD


def test_unreadable_image_has_no_signature():
    assert compute_visual_signature(b"not an image") is None


def test_similar_photos_are_placed_together_within_a_category():
    a, b = compute_visual_signature(scene(1)), compute_visual_signature(scene(2))
    a_copy = compute_visual_signature(scene(1, size=(800, 600)))
    newest_a = row("day-1", 30, a)
    other = row("day-1", 20, b)
    older_a = row("day-1", 10, a_copy)

    ordered = order_by_similarity([older_a, other, newest_a])

    assert [o[0] for o in ordered] == [newest_a[0], older_a[0], other[0]]
    assert ordered[0][1:] == (1, 2, 1)
    assert ordered[1][1:] == (1, 2, 2)
    assert ordered[2][1:] == (None, 1, 1)


def test_categories_stay_separate_and_follow_gallery_order():
    sig = compute_visual_signature(scene(1))
    day3 = row("Day 3", 50, sig)
    overview = row("property-overview", 10, sig)
    uncategorized = row("", 5, compute_visual_signature(scene(2)))

    ordered = order_by_similarity([day3, overview, uncategorized])

    # Same image in two categories is not a group - only within a category
    assert [o[0] for o in ordered] == [uncategorized[0], overview[0], day3[0]]
    assert all(o[1] is None for o in ordered)


def test_photos_without_signature_keep_date_order():
    sig = compute_visual_signature(scene(1))
    pending = row("demolition", 40, None)
    unreadable = row("demolition", 5, "")
    signed = row("demolition", 20, sig)

    ordered = order_by_similarity([unreadable, signed, pending])

    assert [o[0] for o in ordered] == [pending[0], signed[0], unreadable[0]]


def test_backfill_fingerprints_readable_photos_and_marks_the_rest(tmp_path, monkeypatch):
    import asyncio
    from app.domains.water_mitigation import api

    good = tmp_path / "good.jpg"
    good.write_bytes(scene(1))
    broken = tmp_path / "broken.jpg"
    broken.write_bytes(b"not an image")

    def photo(path, mime="image/jpeg"):
        return SimpleNamespace(
            id=uuid4(), file_path=str(path), file_type="photo", mime_type=mime,
            storage_file_id=None, storage_provider="local", storage_thumbnail_url=None,
            source="manual_upload", visual_signature=None,
        )

    photos = [photo(good), photo(broken), photo(good, mime="video/mp4")]
    pending = SimpleNamespace(
        limit=lambda n: SimpleNamespace(all=lambda: photos[:n]),
        count=lambda: sum(1 for p in photos if p.visual_signature is None),
    )
    db = SimpleNamespace(
        query=lambda model: SimpleNamespace(filter=lambda *conditions: pending),
        commit=lambda: None,
    )
    monkeypatch.setattr(api, "_invalidate_photo_list_cache", lambda: None)

    result = asyncio.run(api.compute_photo_visual_signatures(uuid4(), limit=30, db=db))

    assert result == {"computed": 1, "failed": 2, "remaining": 0}
    assert photos[0].visual_signature == compute_visual_signature(scene(1))
    assert photos[1].visual_signature == ""
    assert photos[2].visual_signature == ""


def test_repository_pages_through_the_similarity_order():
    sig_a, sig_b = compute_visual_signature(scene(1)), compute_visual_signature(scene(3))
    rows = [row("day-1", m, sig_a if m % 2 else sig_b) for m in range(10)]
    expected = [o[0] for o in order_by_similarity(rows)]

    repo = object.__new__(WMPhotoRepository)
    repo._filtered_photos_query = lambda *args: SimpleNamespace(
        with_entities=lambda *cols: SimpleNamespace(all=lambda: rows)
    )
    repo.find_by_ids = lambda ids: [SimpleNamespace(id=i) for i in reversed(ids)]

    first, total, groups = repo.find_by_job_similarity_ordered(uuid4(), skip=0, page_size=4)
    second, _, _ = repo.find_by_job_similarity_ordered(uuid4(), skip=4, page_size=6)

    assert total == 10
    assert [p.id for p in first + second] == expected
    assert groups[first[0].id] == (1, 5, 1)
