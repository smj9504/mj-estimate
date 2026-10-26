"""
Product library API: the company's products from retailers, and reading
new ones off a retailer link or a screenshot of the listing.
"""

import asyncio
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from app.core.database_factory import get_db
from app.domains.auth.dependencies import get_current_user

from . import catalog
from .schemas import (
    ExtractHtmlRequest,
    ExtractUrlRequest,
    ProductCreate,
    ProductDraft,
    ProductListResponse,
    ProductResponse,
    ProductUpdate,
)
from .service import ProductError, ProductService

router = APIRouter(prefix="/products", tags=["Product Library"])

# A screenshot or picture uploaded by hand.
MAX_UPLOAD_BYTES = 12 * 1024 * 1024


def _fail(e: ProductError) -> HTTPException:
    return HTTPException(status_code=e.status, detail=str(e))


async def _read_upload(file: UploadFile) -> bytes:
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="The picture is larger than 12 MB")
    return data


@router.get("/meta")
def product_meta(current_user=Depends(get_current_user)):
    """The categories, price units and retailers the library knows."""
    return catalog.meta()


@router.get("", response_model=ProductListResponse)
def list_products(
    q: Optional[str] = Query(None, max_length=200),
    category: Optional[str] = Query(None),
    trade: Optional[str] = Query(None, pattern="^(kitchen|bathroom)$"),
    include_archived: bool = Query(False),
    limit: int = Query(60, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    items, total = ProductService(db).list(q, category, trade, include_archived, limit, offset)
    return ProductListResponse(items=[ProductResponse.model_validate(p) for p in items], total=total)


@router.post("/extract/url", response_model=ProductDraft)
def extract_from_url(
    payload: ExtractUrlRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Read a product off its retailer page, to check and save. Nothing is stored."""
    return ProductService(db).draft_from_url(payload.url.strip())


@router.post("/extract/html", response_model=ProductDraft)
def extract_from_html(
    payload: ExtractHtmlRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Read a product off a page the person's browser sent (the bookmarklet): retailers don't turn that away. Nothing is stored."""
    return ProductService(db).draft_from_html(payload.html, payload.url.strip())


@router.post("/extract/screenshot", response_model=ProductDraft)
async def extract_from_screenshot(
    file: UploadFile = File(...),
    url: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Read a product off a screenshot of its listing (for a site that turns the server away)."""
    data = await _read_upload(file)
    try:
        return await asyncio.to_thread(
            ProductService(db).draft_from_screenshot, data, (file.content_type or "").lower(), url
        )
    except ProductError as e:
        raise _fail(e)


@router.get("/{product_id}", response_model=ProductResponse)
def get_product(product_id: UUID, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    try:
        return ProductService(db).get(product_id)
    except ProductError as e:
        raise _fail(e)


@router.post("", response_model=ProductResponse)
async def create_product(
    payload: ProductCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Save a product; the pictures it names by link are fetched and kept."""
    product = await ProductService(db).create(payload, getattr(current_user, "id", None))
    return ProductResponse.model_validate(product)


@router.put("/{product_id}", response_model=ProductResponse)
async def update_product(
    product_id: UUID,
    payload: ProductUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    try:
        product = await ProductService(db).update(product_id, payload)
    except ProductError as e:
        raise _fail(e)
    return ProductResponse.model_validate(product)


@router.post("/{product_id}/images", response_model=ProductResponse)
async def upload_product_image(
    product_id: UUID,
    file: UploadFile = File(...),
    swatch: bool = Form(False),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Add a picture by hand, or set the flat surface picture the 3D view uses as a texture (`swatch`)."""
    data = await _read_upload(file)
    try:
        product = await ProductService(db).keep_upload(
            product_id, data, file.filename or "image", (file.content_type or "").lower(), swatch
        )
    except ProductError as e:
        raise _fail(e)
    return ProductResponse.model_validate(product)


@router.delete("/{product_id}")
def archive_product(product_id: UUID, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Take a product out of the library. It stays in the estimates that copied it."""
    try:
        ProductService(db).archive(product_id)
    except ProductError as e:
        raise _fail(e)
    return {"archived": True}
