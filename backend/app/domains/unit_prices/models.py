"""
Company prices and the price books estimates are pinned to.
"""

from sqlalchemy import Column, Float, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.types import JSON

from app.core.base_models import BaseModel
from app.core.database_factory import Base
from app.core.database_types import UUIDType


class UnitPriceOverride(Base, BaseModel):
    """A company's own figure for one price, material and labor apart.

    A side left NULL follows the default, so when the default is updated
    that side moves with it. A price with no row is the default.
    """
    __tablename__ = "unit_price_overrides"
    __table_args__ = (
        UniqueConstraint("company_id", "domain", "price_key", name="uq_unit_price_overrides_key"),
        Index("ix_unit_price_overrides_company_domain", "company_id", "domain"),
        {"extend_existing": True},
    )

    company_id = Column(UUIDType(), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    # bathroom / cabinet (unit_prices.catalog)
    domain = Column(String(20), nullable=False)
    # Path of the price in its pricing module, e.g. "DEMO_RATES.floor_tile_per_sf"
    price_key = Column(String(200), nullable=False)
    material = Column(Float, nullable=True)
    labor = Column(Float, nullable=True)
    updated_by_id = Column(UUIDType(), ForeignKey("staff.id", ondelete="SET NULL"), nullable=True)


class UnitPriceChange(Base, BaseModel):
    """One change to a company price: what it was, what it became, who did it.
    NULL is "the default" on either side."""
    __tablename__ = "unit_price_changes"
    __table_args__ = (
        Index("ix_unit_price_changes_company_domain", "company_id", "domain", "created_at"),
        {"extend_existing": True},
    )

    company_id = Column(UUIDType(), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    domain = Column(String(20), nullable=False)
    price_key = Column(String(200), nullable=False)
    old_material = Column(Float, nullable=True)
    old_labor = Column(Float, nullable=True)
    new_material = Column(Float, nullable=True)
    new_labor = Column(Float, nullable=True)
    changed_by_id = Column(UUIDType(), ForeignKey("staff.id", ondelete="SET NULL"), nullable=True)


class PriceBook(Base, BaseModel):
    """Every price as an estimate was priced with it, frozen.

    prices is {price_key: [material, labor]} for the whole catalog: the
    defaults with the company's figures over them. An estimate keeps its
    book, so a later default update or company edit doesn't move it. Books
    are shared: the same set of prices is stored once (values_hash).
    """
    __tablename__ = "price_books"
    __table_args__ = (
        Index("ix_price_books_domain_hash", "domain", "values_hash"),
        {"extend_existing": True},
    )

    domain = Column(String(20), nullable=False)
    prices = Column(JSON, nullable=False)
    values_hash = Column(String(64), nullable=False)
