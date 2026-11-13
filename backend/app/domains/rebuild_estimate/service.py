"""
Rebuild estimates: made, saved, and the trade estimates imported into them.
"""

import copy
import uuid
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy import desc, false, or_
from sqlalchemy.orm.attributes import flag_modified

from app.core.interfaces import DatabaseSession
from app.domains.auth.company_scope import document_condition, scoped

from .assemble import assemble
from .models import RebuildEstimate
from .schemas import ImportRequest, RebuildEstimateCreate, RebuildEstimateUpdate, SourceRoomRequest
from .sources import KIND_LABELS, KIND_PATHS, KINDS, fingerprint, importable, label_of, model_of, snapshot

_FIELDS = (
    "id", "claim_id", "company_id", "created_by_id", "status", "property_address", "city", "state", "zip_code",
    "include_overhead_profit", "overhead_pct", "profit_pct", "total", "notes", "created_at", "updated_at",
)


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _norm(name: Any) -> str:
    return " ".join(str(name or "").lower().split())


def _bad(detail: str) -> HTTPException:
    return HTTPException(status_code=400, detail=detail)


def _empty(measures: Optional[Dict[str, Any]]) -> bool:
    return not any((measures or {}).get(k) for k in ("floor_sf", "ceiling_sf", "wall_sf", "perimeter_lf"))


# Where a one-room estimate goes when no room has its name
_ROOM_WORD = {"bathroom": "bath", "cabinet": "kitchen"}


class RebuildEstimateService:
    def __init__(self, session: DatabaseSession):
        self.session = session

    # ── Reading ──

    def _find(self, estimate_id: str) -> Optional[RebuildEstimate]:
        return self.session.query(RebuildEstimate).filter(RebuildEstimate.id == estimate_id).first()

    def _row(self, est: RebuildEstimate) -> Dict[str, Any]:
        row = {name: getattr(est, name) for name in _FIELDS}
        for key in ("id", "claim_id", "company_id", "created_by_id"):
            row[key] = str(row[key]) if row[key] else None
        claim = est.claim_ref
        client = claim.client if claim else None
        row.update({
            "claim_number": claim.claim_number if claim else None,
            "client_name": client.display_name if client else None,
            "client_id": str(client.id) if client else None,
        })
        return row

    def get(self, estimate_id: str) -> Optional[Dict[str, Any]]:
        est = self._find(estimate_id)
        if est is None:
            return None
        row = self._row(est)
        row.update({
            "rooms": est.rooms or [],
            "lines": est.lines or [],
            "sources": [self._source_info(src) for src in est.sources or []],
            "assembled": assemble(est),
            "company_info": self._company_info(est),
        })
        return row

    def _source_info(self, src: Dict[str, Any]) -> Dict[str, Any]:
        """An imported estimate, and whether the original has moved on since"""
        model = model_of(src["kind"])
        original = self.session.query(model).filter(model.id == src["estimate_id"]).first()
        if original is None:
            state = "missing"
        elif fingerprint(original) != src.get("fingerprint"):
            state = "changed"
        else:
            state = "current"
        return {
            "id": src["id"], "kind": src["kind"], "estimate_id": src["estimate_id"], "label": src.get("label"),
            "op_included": bool(src.get("op_included")), "total": src.get("total") or 0,
            "line_count": len(src.get("lines") or []), "imported_at": src.get("imported_at"),
            "rooms": [{"key": r["key"], "name": r.get("name")} for r in src.get("rooms") or []],
            "room_map": src.get("room_map") or {}, "state": state,
            "path": f"{KIND_PATHS[src['kind']]}/{src['estimate_id']}",
        }

    def _company_info(self, est: RebuildEstimate) -> Optional[Dict[str, Any]]:
        if not est.company_id:
            return None
        from app.domains.company.models import Company

        company = self.session.query(Company).filter(Company.id == est.company_id).first()
        if company is None:
            return None
        return {
            "name": company.name, "address": company.address, "city": company.city, "state": company.state,
            "zipcode": company.zipcode, "phone": company.phone, "email": company.email,
            "website": company.website, "license_number": company.license_number, "logo": company.logo,
        }

    def list(self, claim_id: Optional[str] = None, search: Optional[str] = None, page: int = 1,
             page_size: int = 50, scope: Any = None) -> Tuple[List[Dict[str, Any]], int]:
        query = scoped(self.session.query(RebuildEstimate), scope)
        if claim_id:
            query = query.filter(RebuildEstimate.claim_id == claim_id)
        if search:
            term = f"%{search}%"
            query = query.filter(or_(RebuildEstimate.property_address.ilike(term),
                                     RebuildEstimate.zip_code.ilike(term), RebuildEstimate.notes.ilike(term)))
        total = query.count()
        rows = query.order_by(desc(RebuildEstimate.created_at)).offset((page - 1) * page_size).limit(page_size).all()
        items = []
        for est in rows:
            row = self._row(est)
            row["source_labels"] = [src.get("label") for src in est.sources or []]
            items.append(row)
        return items, total

    # ── Writing ──

    def create(self, data: RebuildEstimateCreate, created_by_id: Optional[str] = None) -> Dict[str, Any]:
        est = RebuildEstimate(
            id=str(uuid.uuid4()), created_by_id=created_by_id, status=data.status or "draft",
            rooms=[], sources=[], lines=[],
        )
        self.session.add(est)
        self._apply(est, data)
        self.session.flush()
        return self.get(str(est.id))

    def update(self, estimate_id: str, data: RebuildEstimateUpdate) -> Optional[Dict[str, Any]]:
        est = self._find(estimate_id)
        if est is None:
            return None
        self._apply(est, data)
        self.session.flush()
        return self.get(estimate_id)

    def _apply(self, est: RebuildEstimate, data: RebuildEstimateUpdate) -> None:
        changes = data.model_dump(exclude_unset=True, exclude={"rooms", "lines"})
        for key, value in changes.items():
            if key == "status" and value is None:
                continue
            setattr(est, key, value)
        rooms = [r.model_dump() for r in data.rooms] if data.rooms is not None else list(est.rooms or [])
        ids = {r["id"] for r in rooms}
        if data.rooms is not None:
            for src in est.sources or []:
                for room_id in (src.get("room_map") or {}).values():
                    if room_id not in ids:
                        gone = next((r.get("name") for r in est.rooms or [] if r.get("id") == room_id), "A room")
                        raise _bad(f"{gone} holds the lines imported from the {src.get('label')}: "
                                   f"move or remove those first.")
            est.rooms = rooms
            flag_modified(est, "rooms")
        if data.lines is not None:
            lines = [li.model_dump() for li in data.lines]
            for li in lines:
                if li["room_id"] is not None and li["room_id"] not in ids:
                    raise _bad(f'"{li["description"]}" is on a room that isn\'t on the estimate.')
            est.lines = lines
            flag_modified(est, "lines")
        self._total(est)

    def _total(self, est: RebuildEstimate) -> None:
        est.total = assemble(est)["total"]

    def delete(self, estimate_id: str) -> bool:
        est = self._find(estimate_id)
        if est is None:
            return False
        self.session.delete(est)
        self.session.flush()
        return True

    # ── Importing the trade estimates ──

    def importable(self, estimate_id: str, staff: Any) -> List[Dict[str, Any]]:
        """The trade estimates on its claim (or at its address, not on another
        claim), newest first, and whether each is already in"""
        est = self._find(estimate_id)
        if est is None:
            return []
        street = (est.property_address or "").split(",")[0].strip()
        if not est.claim_id and not street:
            return []
        imported = {(s["kind"], s["estimate_id"]) for s in est.sources or []}
        out = []
        for kind in KINDS:
            model = model_of(kind)
            query = scoped(self.session.query(model),
                           document_condition(self.session, staff, model.claim_id, model.company_id))
            at_address = model.property_address.ilike(f"%{street}%") if street else false()
            if est.claim_id:
                query = query.filter(or_(model.claim_id == est.claim_id, (model.claim_id.is_(None)) & at_address))
            else:
                query = query.filter(at_address)
            for other in query.order_by(desc(model.created_at)).limit(50).all():
                if kind == "bathroom" and other.kind == "existing":
                    continue
                lines = other.line_items or []
                out.append({
                    "kind": kind, "kind_label": KIND_LABELS[kind], "estimate_id": str(other.id),
                    "label": label_of(kind, other), "status": other.status,
                    "estimate_kind": other.kind, "option_label": other.option_label,
                    "property_address": other.property_address,
                    "line_count": len(lines), "total": round(sum(float(li.total or 0) for li in lines), 2),
                    "calculated": bool(lines),
                    "updated_at": other.updated_at or other.created_at,
                    "imported": (kind, str(other.id)) in imported,
                    "path": f"{KIND_PATHS[kind]}/{other.id}",
                })
        return out

    def _original(self, kind: str, estimate_id: str) -> Any:
        model = model_of(kind)
        original = self.session.query(model).filter(model.id == estimate_id).first()
        if original is None:
            raise HTTPException(status_code=404, detail="Estimate not found")
        if not importable(kind, original):
            raise _bad(f"Calculate the {KIND_LABELS[kind].lower()} first: it has no lines to bring in yet.")
        return original

    def import_source(self, estimate_id: str, req: ImportRequest) -> Optional[Dict[str, Any]]:
        est = self._find(estimate_id)
        if est is None:
            return None
        if any(s["kind"] == req.kind and s["estimate_id"] == req.estimate_id for s in est.sources or []):
            raise _bad("That estimate is already in.")
        original = self._original(req.kind, req.estimate_id)
        snap = snapshot(req.kind, original)
        snap["id"] = _new_id()
        sources = copy.deepcopy(est.sources or [])
        rooms = copy.deepcopy(est.rooms or [])
        snap["room_map"] = self._place(rooms, sources, snap, {})
        est.rooms, est.sources = rooms, [*sources, snap]
        if not est.property_address:
            # (a cabinet estimate has no city or state)
            for name in ("property_address", "city", "state", "zip_code"):
                setattr(est, name, getattr(original, name, None))
        flag_modified(est, "rooms")
        flag_modified(est, "sources")
        self._total(est)
        self.session.flush()
        return self.get(estimate_id)

    def refresh_source(self, estimate_id: str, source_id: str) -> Optional[Dict[str, Any]]:
        """Take the original's lines again, each room where it was"""
        est = self._find(estimate_id)
        if est is None:
            return None
        sources = copy.deepcopy(est.sources or [])
        src = self._source(sources, source_id)
        snap = snapshot(src["kind"], self._original(src["kind"], src["estimate_id"]))
        rooms = copy.deepcopy(est.rooms or [])
        others = [s for s in sources if s["id"] != source_id]
        snap["id"] = source_id
        snap["room_map"] = self._place(rooms, others, snap, src.get("room_map") or {})
        est.rooms = rooms
        est.sources = [snap if s["id"] == source_id else s for s in sources]
        flag_modified(est, "rooms")
        flag_modified(est, "sources")
        self._total(est)
        self.session.flush()
        return self.get(estimate_id)

    def move_source(self, estimate_id: str, source_id: str, req: SourceRoomRequest) -> Optional[Dict[str, Any]]:
        """A bathroom or kitchen estimate put in another room"""
        est = self._find(estimate_id)
        if est is None:
            return None
        sources = copy.deepcopy(est.sources or [])
        src = self._source(sources, source_id)
        keys = [r["key"] for r in src.get("rooms") or []]
        if len(keys) != 1:
            raise _bad("Only an estimate of one room (a bathroom, the kitchen) can be moved.")
        rooms = copy.deepcopy(est.rooms or [])
        if req.new_room_name:
            target = {"id": _new_id(), "name": req.new_room_name.strip(), "level_name": None,
                      "measures": dict((src["rooms"][0].get("measures") or {}))}
            rooms.append(target)
        else:
            target = next((r for r in rooms if r["id"] == req.room_id), None)
            if target is None:
                raise _bad("That room isn't on the estimate.")
            if _empty(target.get("measures")) and not _empty(src["rooms"][0].get("measures")):
                target["measures"] = dict(src["rooms"][0]["measures"])
        src["room_map"] = {keys[0]: target["id"]}
        est.rooms, est.sources = rooms, sources
        flag_modified(est, "rooms")
        flag_modified(est, "sources")
        self._total(est)
        self.session.flush()
        return self.get(estimate_id)

    def remove_source(self, estimate_id: str, source_id: str) -> Optional[Dict[str, Any]]:
        """Its lines leave; the rooms it brought stay, with whatever was added to them"""
        est = self._find(estimate_id)
        if est is None:
            return None
        sources = copy.deepcopy(est.sources or [])
        self._source(sources, source_id)
        est.sources = [s for s in sources if s["id"] != source_id]
        flag_modified(est, "sources")
        self._total(est)
        self.session.flush()
        return self.get(estimate_id)

    @staticmethod
    def _source(sources: List[Dict[str, Any]], source_id: str) -> Dict[str, Any]:
        src = next((s for s in sources if s.get("id") == source_id), None)
        if src is None:
            raise HTTPException(status_code=404, detail="Imported estimate not found")
        return src

    @staticmethod
    def _place(rooms: List[Dict[str, Any]], others: List[Dict[str, Any]], snap: Dict[str, Any],
               prior: Dict[str, str]) -> Dict[str, str]:
        """Each of the estimate's rooms onto a room of this one: where it was
        (a refresh), else the room of the same name, else (a bathroom, the
        kitchen) the one room whose name says so; else a new room. Two of its
        rooms never share one, nor do two bathrooms."""
        by_id = {r["id"]: r for r in rooms}
        same_kind = {room_id for s in others if s["kind"] == snap["kind"]
                     for room_id in (s.get("room_map") or {}).values()}
        taken: set = set()
        room_map: Dict[str, str] = {}
        for sroom in snap.get("rooms") or []:
            key = sroom["key"]
            target = by_id.get(prior.get(key, ""))
            free = [r for r in rooms if r["id"] not in taken and r["id"] not in same_kind]
            if target is None:
                target = next((r for r in free if _norm(r.get("name")) == _norm(sroom.get("name"))), None)
            word = _ROOM_WORD.get(snap["kind"])
            if target is None and word:
                matches = [r for r in free if word in _norm(r.get("name"))]
                target = matches[0] if len(matches) == 1 else None
            if target is None:
                names = {_norm(r.get("name")) for r in rooms}
                name = sroom.get("name") or "Room"
                if _norm(name) in names and sroom.get("level_name"):
                    name = f"{name} ({sroom['level_name']})"
                base, n = name, 2
                while _norm(name) in names:
                    name, n = f"{base} {n}", n + 1
                target = {"id": _new_id(), "name": name, "level_name": sroom.get("level_name"),
                          "measures": dict(sroom.get("measures") or {})}
                rooms.append(target)
                by_id[target["id"]] = target
            elif _empty(target.get("measures")) and not _empty(sroom.get("measures")):
                target["measures"] = dict(sroom["measures"])
            taken.add(target["id"])
            room_map[key] = target["id"]
        return room_map
