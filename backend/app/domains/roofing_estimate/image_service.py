"""
Photos attached to a roofing estimate and printed at the end of its PDF.

One address often has several structures; an aerial with the roof
marked, or a photo of the existing roof, tells the customer which roof
the quote covers. Images are stored on the row (see
RoofingEstimateImage), so the PDF renders without outside storage.
"""

import io
import logging
from typing import Any, Dict, List, Optional, Tuple

from app.core.interfaces import DatabaseSession

from .models import RoofingEstimate, RoofingEstimateImage

logger = logging.getLogger(__name__)

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
# Phone photos arrive at 4000px+. 2000px on the long side is sharp at
# the PDF's half-page width and keeps each stored image a few hundred KB.
MAX_EDGE_PX = 2000
JPEG_QUALITY = 85


class ImageError(ValueError):
    """Upload rejected — the message is shown to the user."""


def normalize_image(data: bytes) -> Tuple[bytes, str]:
    """Upright, downsized JPEG/PNG from whatever the browser sent.

    Phone photos carry their rotation in EXIF, which reportlab ignores,
    so it is applied here. Images with transparency stay PNG (a marked-up
    screenshot); everything else becomes JPEG.
    """
    if len(data) > MAX_UPLOAD_BYTES:
        raise ImageError("Image is larger than 20 MB.")
    try:
        from PIL import Image, ImageOps
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception:
        raise ImageError(
            "Unsupported image. Upload a JPG, PNG or WebP file "
            "(iPhone HEIC photos: export as JPG first).")

    img = ImageOps.exif_transpose(img)
    img.thumbnail((MAX_EDGE_PX, MAX_EDGE_PX))

    has_alpha = img.mode in ("RGBA", "LA") or (
        img.mode == "P" and "transparency" in img.info)
    buf = io.BytesIO()
    if has_alpha:
        img.convert("RGBA").save(buf, format="PNG", optimize=True)
        return buf.getvalue(), "image/png"
    img.convert("RGB").save(
        buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    return buf.getvalue(), "image/jpeg"


def _to_dict(img: RoofingEstimateImage) -> Dict[str, Any]:
    return {
        "id": str(img.id),
        "estimate_id": str(img.estimate_id),
        "caption": img.caption,
        "file_name": img.file_name,
        "content_type": img.content_type,
        "display_order": img.display_order or 0,
        "created_at": img.created_at,
    }


class RoofingImageService:
    def __init__(self, session: DatabaseSession):
        self.session = session

    def _query(self, estimate_id: str):
        return (
            self.session.query(RoofingEstimateImage)
            .filter(RoofingEstimateImage.estimate_id == estimate_id)
        )

    def _get(self, estimate_id: str,
             image_id: str) -> Optional[RoofingEstimateImage]:
        return (
            self._query(estimate_id)
            .filter(RoofingEstimateImage.id == image_id)
            .first()
        )

    def list_images(self, estimate_id: str) -> List[Dict[str, Any]]:
        rows = self._query(estimate_id).order_by(
            RoofingEstimateImage.display_order,
            RoofingEstimateImage.created_at,
        ).all()
        return [_to_dict(r) for r in rows]

    def add_image(
        self, estimate_id: str, data: bytes,
        file_name: Optional[str], caption: Optional[str],
    ) -> Optional[Dict[str, Any]]:
        exists = (
            self.session.query(RoofingEstimate.id)
            .filter(RoofingEstimate.id == estimate_id)
            .first()
        )
        if not exists:
            return None
        image_bytes, mime = normalize_image(data)
        last = (
            self._query(estimate_id)
            .order_by(RoofingEstimateImage.display_order.desc())
            .first()
        )
        img = RoofingEstimateImage(
            estimate_id=estimate_id,
            image_data=image_bytes,
            content_type=mime,
            file_name=(file_name or "")[:255] or None,
            caption=(caption or "").strip()[:500] or None,
            display_order=((last.display_order or 0) + 1) if last else 0,
        )
        self.session.add(img)
        self.session.flush()
        return _to_dict(img)

    def update_image(
        self, estimate_id: str, image_id: str,
        caption: Optional[str] = None,
        display_order: Optional[int] = None,
    ) -> Optional[Dict[str, Any]]:
        img = self._get(estimate_id, image_id)
        if not img:
            return None
        if caption is not None:
            img.caption = caption.strip()[:500] or None
        if display_order is not None:
            img.display_order = display_order
        self.session.flush()
        return _to_dict(img)

    def delete_image(self, estimate_id: str, image_id: str) -> bool:
        img = self._get(estimate_id, image_id)
        if not img:
            return False
        self.session.delete(img)
        self.session.flush()
        return True

    def get_content(
        self, estimate_id: str, image_id: str,
    ) -> Optional[Tuple[bytes, str]]:
        img = self._get(estimate_id, image_id)
        if not img:
            return None
        return img.image_data, img.content_type

    def pdf_images(self, estimate_id: str) -> List[Dict[str, Any]]:
        """Bytes and captions, in display order, for the PDF."""
        from sqlalchemy.orm import undefer
        rows = (
            self._query(estimate_id)
            .options(undefer(RoofingEstimateImage.image_data))
            .order_by(
                RoofingEstimateImage.display_order,
                RoofingEstimateImage.created_at,
            )
            .all()
        )
        return [
            {"data": r.image_data, "caption": r.caption or ""}
            for r in rows if r.image_data
        ]
