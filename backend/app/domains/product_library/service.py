"""
Product library: keeping products, their pictures, and reading new ones
off retailer listings.

Pictures are fetched from the retailer once and kept as our own files
(context "product"), so the library doesn't break when a retailer moves an
image, and the 3D view can load them from our own server.
"""

import asyncio
import io
import logging
import mimetypes
from datetime import datetime, timezone
from typing import List, Optional, Tuple
from urllib.parse import urlparse
from uuid import UUID

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.database_factory import get_database
from app.domains.file.service import FileService

from . import extract
from .catalog import CATEGORIES, retailer_of
from .fetch import MAX_IMAGE_BYTES, MAX_PAGE_BYTES, FetchError, fetch, page_fields, parse_page
from .models import Product
from .schemas import ProductCreate, ProductDraft, ProductSnapshot, ProductUpdate

logger = logging.getLogger(__name__)

IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"}


class ProductError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


class ProductService:
    def __init__(self, db: Session):
        self.db = db

    # ── Reading ──

    def list(
        self,
        q: Optional[str] = None,
        category: Optional[str] = None,
        trade: Optional[str] = None,
        include_archived: bool = False,
        limit: int = 60,
        offset: int = 0,
    ) -> Tuple[List[Product], int]:
        query = self.db.query(Product)
        if not include_archived:
            query = query.filter(Product.is_archived.is_(False))
        if category:
            query = query.filter(Product.category == category)
        elif trade:
            keys = [k for k, v in CATEGORIES.items() if v["trade"] in (trade, "both")]
            query = query.filter(Product.category.in_(keys))
        if q:
            like = f"%{q.strip()}%"
            query = query.filter(
                or_(
                    Product.title.ilike(like),
                    Product.brand.ilike(like),
                    Product.model_number.ilike(like),
                    Product.sku.ilike(like),
                    Product.finish.ilike(like),
                )
            )
        total = query.count()
        items = query.order_by(Product.updated_at.desc().nullslast(), Product.created_at.desc()).offset(offset).limit(limit).all()
        return items, total

    def get(self, product_id: UUID) -> Product:
        product = self.db.query(Product).filter(Product.id == product_id).first()
        if not product:
            raise ProductError("Product not found", status=404)
        return product

    # ── Writing ──

    async def create(self, data: ProductCreate, staff_id: Optional[UUID]) -> Product:
        fields = data.model_dump(exclude={"image_urls", "image_file_ids", "swatch_file_id"})
        fields["retailer"] = fields.get("retailer") or retailer_of(fields.get("source_url"))
        product = Product(**fields, created_by_id=staff_id, image_file_ids=[])
        self.db.add(product)
        # An id to file its pictures under.
        self.db.flush()
        fetched = await self._keep_images(product.id, data.image_urls)
        product.image_file_ids = fetched + list(data.image_file_ids)
        product.swatch_file_id = data.swatch_file_id
        self.db.flush()
        return product

    async def update(self, product_id: UUID, data: ProductUpdate) -> Product:
        product = self.get(product_id)
        sent = data.model_dump(exclude_unset=True, exclude={"image_urls", "image_file_ids"})
        for key, value in sent.items():
            setattr(product, key, value)
        if "source_url" in sent and "retailer" not in sent:
            product.retailer = retailer_of(product.source_url)
        images = list(data.image_file_ids) if data.image_file_ids is not None else list(product.image_file_ids or [])
        images += await self._keep_images(product.id, data.image_urls)
        product.image_file_ids = images
        self.db.flush()
        return product

    def archive(self, product_id: UUID) -> None:
        self.get(product_id).is_archived = True
        self.db.flush()

    async def keep_upload(self, product_id: UUID, data: bytes, filename: str, content_type: str, as_swatch: bool) -> Product:
        """A picture uploaded by hand: added to the product's pictures, or made its texture swatch."""
        product = self.get(product_id)
        if content_type not in IMAGE_TYPES:
            raise ProductError("Only JPEG, PNG, WebP, GIF or AVIF pictures")
        file_id = await self._store(product.id, data, filename, content_type, "swatch" if as_swatch else "image")
        if as_swatch:
            product.swatch_file_id = file_id
        else:
            product.image_file_ids = list(product.image_file_ids or []) + [file_id]
        self.db.flush()
        return product

    async def _keep_images(self, product_id: UUID, urls: List[str]) -> List[str]:
        """Fetch each picture and keep a copy; one that can't be had is skipped, not fatal."""
        kept: List[str] = []
        for url in urls:
            try:
                final_url, content_type, body = await asyncio.to_thread(fetch, url, MAX_IMAGE_BYTES)
            except FetchError as e:
                logger.warning("Product picture %s not kept: %s", url, e)
                continue
            content_type = content_type.split(";")[0].strip().lower()
            if content_type not in IMAGE_TYPES:
                guessed = mimetypes.guess_type(urlparse(final_url).path)[0]
                if guessed not in IMAGE_TYPES:
                    logger.warning("Product picture %s not kept: %s is not an image", url, content_type)
                    continue
                content_type = guessed
            name = urlparse(final_url).path.rsplit("/", 1)[-1] or "image"
            kept.append(await self._store(product_id, body, name, content_type, "image"))
        return kept

    async def _store(self, product_id: UUID, data: bytes, filename: str, content_type: str, category: str) -> str:
        files = FileService(get_database())
        record = await files.upload_file(
            file_data=io.BytesIO(data),
            original_filename=filename[:200],
            content_type=content_type,
            context="product",
            context_id=str(product_id),
            category=category,
        )
        return str(record["id"] if isinstance(record, dict) else record.id)

    # ── Reading listings ──

    def draft_from_url(self, url: str) -> ProductDraft:
        """Read a product off its page, fetched by the server: most big retailers turn that away (see draft_from_html)."""
        try:
            final_url, content_type, body = fetch(url, MAX_PAGE_BYTES)
        except FetchError as e:
            return ProductDraft(fields={"source_url": url, "retailer": retailer_of(url)}, blocked=e.blocked, note=str(e))
        if "html" not in content_type.lower():
            return ProductDraft(fields={"source_url": url, "retailer": retailer_of(url)}, note="That link isn't a web page")
        return self.draft_from_html(body.decode("utf-8", errors="replace"), url, final_url)

    def draft_from_html(self, html: str, url: str, final_url: Optional[str] = None) -> ProductDraft:
        """
        Read a product off a page's HTML: what the page states as data, and
        Claude's read of its text. The HTML comes from the server's own fetch,
        or from the person's browser (the library's bookmarklet), which the
        retailers don't turn away.
        """
        page = parse_page(html, final_url or url)
        base = {"source_url": url, "retailer": retailer_of(final_url or url)}
        if page.blocked:
            return ProductDraft(fields=base, blocked=True, note="The site showed a bot check instead of the product")
        stated, images = page_fields(page)
        try:
            read = extract.read_page(page, stated)
        except Exception as e:
            # What the page states is still worth having.
            logger.warning("Product page read failed for %s: %s", url, e)
            return ProductDraft(fields={**base, **extract.merge_fields(stated, {})}, image_urls=images, note=f"Read only the page's own data: {e}")
        return ProductDraft(fields={**base, **extract.merge_fields(stated, read)}, image_urls=images)

    def draft_from_screenshot(self, image: bytes, media_type: str, url: Optional[str]) -> ProductDraft:
        if media_type not in {"image/jpeg", "image/png", "image/webp", "image/gif"}:
            raise ProductError("A screenshot must be a JPEG, PNG, WebP or GIF")
        try:
            read = extract.read_screenshot(image, media_type, url)
        except Exception as e:
            raise ProductError(f"Couldn't read the screenshot: {e}", status=502)
        fields = extract.merge_fields({}, read)
        if url:
            fields.update({"source_url": url, "retailer": retailer_of(url)})
        return ProductDraft(fields=fields)


def snapshot(product: Product) -> ProductSnapshot:
    """What an estimate keeps of a product it uses: a copy, taken now."""
    return ProductSnapshot(
        product_id=product.id,
        category=product.category,
        title=product.title,
        brand=product.brand,
        model_number=product.model_number,
        sku=product.sku,
        finish=product.finish,
        retailer=product.retailer,
        source_url=product.source_url,
        price=product.price,
        price_unit=product.price_unit,
        box_sf=product.box_sf,
        width_in=product.width_in,
        depth_in=product.depth_in,
        height_in=product.height_in,
        tile_width_in=product.tile_width_in,
        tile_length_in=product.tile_length_in,
        image_file_ids=list(product.image_file_ids or []),
        swatch_file_id=product.swatch_file_id,
        look=dict(product.look or {}),
        taken_at=datetime.now(timezone.utc),
    )
