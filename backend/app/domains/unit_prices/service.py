"""
Company prices, and the price book each estimate is priced with.

A company's prices are the defaults (pricing.py) with its own figures over
them, material and labor apart. An estimate is pinned to a price book the
first time it is calculated; a copy in the same job keeps its book, and an
estimate is moved to today's prices only when someone asks
(repin_group) or its job changes company.
"""

import hashlib
import json
from typing import Any, Dict, Iterable, List, Optional, Tuple

from . import catalog
from .models import PriceBook, UnitPriceChange, UnitPriceOverride


class UnitPriceError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _inner(session: Any) -> Any:
    """The SQLAlchemy session behind whatever wrapper the caller holds"""
    for attr in ("_session", "session"):
        inner = getattr(session, attr, None)
        if inner is not None and hasattr(inner, "query"):
            return inner
    return session


def _money(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        number = round(float(value), 4)
    except (TypeError, ValueError):
        raise UnitPriceError(f"Not a number: {value!r}")
    if number < 0:
        raise UnitPriceError("A price can't be negative")
    return number


def values_hash(values: Dict[str, Tuple[float, float]]) -> str:
    canonical = json.dumps(
        {key: [round(float(m), 6), round(float(l), 6)] for key, (m, l) in sorted(values.items())},
        separators=(",", ":"), sort_keys=True,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class UnitPriceService:
    def __init__(self, session: Any):
        self.session = _inner(session)

    # ── A company's prices ──

    def _overrides(self, domain: str, company_id: Optional[str]) -> Dict[str, UnitPriceOverride]:
        if not company_id:
            return {}
        rows = self.session.query(UnitPriceOverride).filter(
            UnitPriceOverride.company_id == str(company_id),
            UnitPriceOverride.domain == domain,
        ).all()
        return {row.price_key: row for row in rows}

    def effective_values(self, domain: str, company_id: Optional[str]) -> Dict[str, Tuple[float, float]]:
        """Every price in the catalog: the company's figure where it has one,
        else the default, material and labor apart."""
        values = catalog.get_domain(domain).default_values()
        for key, row in self._overrides(domain, company_id).items():
            if key not in values:
                continue  # a price the code no longer has
            m, l = values[key]
            values[key] = (
                m if row.material is None else float(row.material),
                l if row.labor is None else float(row.labor),
            )
        return values

    def price_list(self, domain: str, company_id: Optional[str]) -> Dict[str, Any]:
        d = catalog.get_domain(domain)
        overrides = self._overrides(domain, company_id)
        staff_names = self._staff_names(o.updated_by_id for o in overrides.values())
        items = []
        for item in d.items():
            row = overrides.get(item.key)
            material = None if row is None else row.material
            labor = None if row is None else row.labor
            items.append({
                "key": item.key,
                "group": item.group,
                "label": item.label,
                "unit": item.unit,
                "kind": item.kind,
                "note": item.note,
                "default_material": round(item.material, 4),
                "default_labor": round(item.labor, 4),
                "material": material,
                "labor": labor,
                "updated_at": row.updated_at or row.created_at if row is not None else None,
                "updated_by": staff_names.get(str(row.updated_by_id)) if row is not None and row.updated_by_id else None,
            })
        return {
            "domain": d.key,
            "label": d.label,
            "company_id": str(company_id) if company_id else None,
            "items": items,
        }

    def save(
        self, domain: str, company_id: str, changes: Dict[str, Dict[str, Any]],
        staff_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Set a company's figures. Each change gives material and/or labor;
        a side given as null goes back to the default, a side left out stays."""
        if not company_id:
            raise UnitPriceError("Pick a company")
        items = catalog.get_domain(domain).item_map()
        overrides = self._overrides(domain, company_id)
        for key, change in changes.items():
            item = items.get(key)
            if item is None:
                raise UnitPriceError(f"No such price: {key}")
            row = overrides.get(key)
            old_m = None if row is None else row.material
            old_l = None if row is None else row.labor
            new_m = _money(change["material"]) if "material" in change else old_m
            new_l = _money(change["labor"]) if "labor" in change else old_l
            if item.kind == catalog.MATERIAL and new_l is not None:
                raise UnitPriceError(f"{item.label} is material only")
            if item.kind == catalog.LABOR and new_m is not None:
                raise UnitPriceError(f"{item.label} is labor only")
            if (new_m, new_l) == (old_m, old_l):
                continue
            if new_m is None and new_l is None:
                self.session.delete(row)
            elif row is None:
                row = UnitPriceOverride(
                    company_id=str(company_id), domain=domain, price_key=key,
                    material=new_m, labor=new_l, updated_by_id=staff_id,
                )
                self.session.add(row)
            else:
                row.material = new_m
                row.labor = new_l
                row.updated_by_id = staff_id
            self.session.add(UnitPriceChange(
                company_id=str(company_id), domain=domain, price_key=key,
                old_material=old_m, old_labor=old_l, new_material=new_m, new_labor=new_l,
                changed_by_id=staff_id,
            ))
        self.session.flush()
        return self.price_list(domain, company_id)

    def history(self, domain: str, company_id: str, limit: int = 200) -> List[Dict[str, Any]]:
        rows = self.session.query(UnitPriceChange).filter(
            UnitPriceChange.company_id == str(company_id),
            UnitPriceChange.domain == domain,
        ).order_by(UnitPriceChange.created_at.desc()).limit(limit).all()
        items = catalog.get_domain(domain).item_map()
        names = self._staff_names(r.changed_by_id for r in rows)
        return [{
            "key": r.price_key,
            "label": items[r.price_key].label if r.price_key in items else r.price_key,
            "group": items[r.price_key].group if r.price_key in items else None,
            "old_material": r.old_material, "old_labor": r.old_labor,
            "new_material": r.new_material, "new_labor": r.new_labor,
            "changed_by": names.get(str(r.changed_by_id)) if r.changed_by_id else None,
            "changed_at": r.created_at,
        } for r in rows]

    def _staff_names(self, ids: Iterable[Any]) -> Dict[str, str]:
        wanted = {str(i) for i in ids if i}
        if not wanted:
            return {}
        from app.domains.staff.models import Staff

        rows = self.session.query(Staff).filter(Staff.id.in_(list(wanted))).all()
        return {str(s.id): _staff_name(s) for s in rows}

    # ── Price books ──

    def current_book(self, domain: str, company_id: Optional[str]) -> PriceBook:
        """The book for today's prices for this company, stored once."""
        values = self.effective_values(domain, company_id)
        digest = values_hash(values)
        book = self.session.query(PriceBook).filter(
            PriceBook.domain == domain, PriceBook.values_hash == digest,
        ).first()
        if book is None:
            book = PriceBook(
                domain=domain, values_hash=digest,
                prices={key: [m, l] for key, (m, l) in values.items()},
            )
            self.session.add(book)
            self.session.flush()
        return book

    def book_for(self, domain: str, estimate: Any, members: Iterable[Any] = ()) -> PriceBook:
        """The book to price `estimate` with, pinning it first if it has none:
        the book another estimate of its job already has, so a job's options
        are priced alike, else today's prices for its company."""
        book = self._get_book(getattr(estimate, "price_book_id", None))
        if book is None:
            for member in members:
                book = self._get_book(getattr(member, "price_book_id", None))
                if book is not None:
                    break
        if book is None:
            book = self.current_book(domain, getattr(estimate, "company_id", None))
        if str(getattr(estimate, "price_book_id", None) or "") != str(book.id):
            estimate.price_book_id = book.id
        return book

    def prices_for(self, domain: str, estimate: Any) -> Dict[str, Any]:
        """The prices an estimate is (or, not yet priced, would be) priced
        with, without pinning it: for showing rates on its form."""
        book = self._get_book(getattr(estimate, "price_book_id", None))
        if book is not None:
            return book.prices
        values = self.effective_values(domain, getattr(estimate, "company_id", None))
        return {key: [m, l] for key, (m, l) in values.items()}

    def repin_group(self, domain: str, members: List[Any], company_id: Optional[str]) -> PriceBook:
        """Put every estimate of a job on today's prices."""
        book = self.current_book(domain, company_id)
        for member in members:
            member.price_book_id = book.id
        self.session.flush()
        return book

    def book_summary(self, domain: str, estimate: Any) -> Optional[Dict[str, Any]]:
        """When an estimate's prices are from, and whether today's differ."""
        book_id = getattr(estimate, "price_book_id", None)
        if not book_id:
            return None
        row = self.session.query(PriceBook.id, PriceBook.created_at, PriceBook.values_hash).filter(
            PriceBook.id == str(book_id)
        ).first()
        if row is None:
            return None
        current = values_hash(self.effective_values(domain, getattr(estimate, "company_id", None)))
        return {
            "id": str(row.id),
            "priced_at": row.created_at,
            "is_current": row.values_hash == current,
        }

    def _get_book(self, book_id: Any) -> Optional[PriceBook]:
        if not book_id:
            return None
        return self.session.query(PriceBook).filter(PriceBook.id == str(book_id)).first()


def _staff_name(staff: Any) -> str:
    first = getattr(staff, "first_name", None) or ""
    last = getattr(staff, "last_name", None) or ""
    name = f"{first} {last}".strip()
    return name or getattr(staff, "username", None) or getattr(staff, "email", None) or ""
