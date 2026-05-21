"""
EagleView Siding Report XML Parser

Parses EagleView EAGLEVIEW_EXPORT XML files to extract wall measurements,
penetrations (windows/doors), material areas, corner lengths, and other
data needed for siding estimates.

Supports both legacy format (no subType) and newer format (with SUBTYPES).
"""

import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Dict, List, Optional


# ── Data Classes ──────────────────────────────────────────────────────────


@dataclass
class PenetrationData:
    """Window, door, or other wall opening."""
    id: str
    designator: str               # e.g. "G1", "E2"
    parent_wall_id: str           # parent FACE id
    parent_wall_designator: str   # parent FACE designator
    area: float                   # SF
    perimeter: float              # LF
    width: float                  # ft
    height: float                 # ft
    sub_type: str                 # WINDOW, DOOR, MAIN_DOOR, GARAGE_DOOR, NONE
    dimension_raw: str            # original "3 x 7" string


@dataclass
class MaterialZone:
    """Area of a specific material on a wall (siding or masonry)."""
    id: str
    designator: str
    material_id: str              # "2" = Siding, "3" = Masonry
    material_label: str           # "Siding", "Masonry"
    orientation: float
    area: float                   # SF (total)
    area_less_penetrations: float # SF (net)


@dataclass
class WallData:
    """A wall facet with its penetrations and material zones."""
    id: str
    designator: str               # A, B, C, D, E, F, G...
    orientation: float            # degrees
    direction: str                # N, S, E, W, NE, NW, SE, SW
    area: float                   # SF (total wall area)
    penetration_ids: List[str] = field(default_factory=list)
    penetrations: List[PenetrationData] = field(default_factory=list)
    material_zones: List[MaterialZone] = field(default_factory=list)

    @property
    def siding_area(self) -> float:
        return sum(z.area for z in self.material_zones if z.material_label == "Siding")

    @property
    def siding_area_net(self) -> float:
        return sum(z.area_less_penetrations for z in self.material_zones if z.material_label == "Siding")

    @property
    def masonry_area(self) -> float:
        return sum(z.area for z in self.material_zones if z.material_label == "Masonry")

    @property
    def total_penetration_area(self) -> float:
        return sum(p.area for p in self.penetrations)

    @property
    def window_count(self) -> int:
        return sum(1 for p in self.penetrations if p.sub_type in ("WINDOW", "NONE"))

    @property
    def door_count(self) -> int:
        return sum(1 for p in self.penetrations if p.sub_type in ("DOOR", "MAIN_DOOR", "GARAGE_DOOR"))


@dataclass
class StructureData:
    """A single structure (building) in the report."""
    roof_id: str
    walls: List[WallData] = field(default_factory=list)
    penetrations: List[PenetrationData] = field(default_factory=list)
    material_zones: List[MaterialZone] = field(default_factory=list)
    summary: Dict[str, float] = field(default_factory=dict)


@dataclass
class EagleViewSidingReport:
    """Complete parsed EagleView siding report."""

    # Report info
    report_id: str = ""
    claim_id: str = ""

    # Location
    address: str = ""
    city: str = ""
    state: str = ""
    zip_code: str = ""
    latitude: float = 0.0
    longitude: float = 0.0

    # Structures
    structures: List[StructureData] = field(default_factory=list)

    # ── Overall Summary (from OVERALL_SUMMARY) ──
    total_wall_area: float = 0.0
    total_wall_area_less_penetrations: float = 0.0
    total_siding_area: float = 0.0
    total_siding_area_less_penetrations: float = 0.0
    total_masonry_area: float = 0.0
    total_masonry_area_less_penetrations: float = 0.0
    total_wall_facets: int = 0
    total_windows_and_doors: int = 0
    total_windows_and_doors_area: float = 0.0
    total_windows_and_doors_perimeter: float = 0.0
    fascia_lf: float = 0.0

    # Corner lengths (LF)
    inside_corners_lf: float = 0.0
    outside_corners_lf: float = 0.0
    obtuse_inside_corners_lf: float = 0.0
    obtuse_outside_corners_lf: float = 0.0

    # Siding-specific corners
    inside_siding_corners_lf: float = 0.0
    outside_siding_corners_lf: float = 0.0
    obtuse_inside_siding_corners_lf: float = 0.0
    obtuse_outside_siding_corners_lf: float = 0.0

    # Masonry corners
    inside_masonry_corners_lf: float = 0.0
    outside_masonry_corners_lf: float = 0.0

    # Siding-to-Masonry transition corners
    inside_siding_to_masonry_lf: float = 0.0
    outside_siding_to_masonry_lf: float = 0.0

    # Siding wall lengths
    top_siding_walls_lf: float = 0.0
    bottom_siding_walls_lf: float = 0.0
    top_masonry_walls_lf: float = 0.0
    bottom_masonry_walls_lf: float = 0.0

    # Materials map
    materials: Dict[str, str] = field(default_factory=dict)  # id → label

    # SubTypes map (newer format)
    sub_types: Dict[str, str] = field(default_factory=dict)  # id → label

    # All walls (flattened from all structures)
    @property
    def all_walls(self) -> List[WallData]:
        walls = []
        for s in self.structures:
            walls.extend(s.walls)
        return walls

    # All penetrations (flattened)
    @property
    def all_penetrations(self) -> List[PenetrationData]:
        pens = []
        for s in self.structures:
            pens.extend(s.penetrations)
        return pens

    def to_dict(self) -> dict:
        """Serialize to dict for JSON storage."""
        return {
            "report_id": self.report_id,
            "claim_id": self.claim_id,
            "address": self.address,
            "city": self.city,
            "state": self.state,
            "zip_code": self.zip_code,
            "latitude": self.latitude,
            "longitude": self.longitude,
            # Summary totals
            "total_wall_area": self.total_wall_area,
            "total_wall_area_less_penetrations": self.total_wall_area_less_penetrations,
            "total_siding_area": self.total_siding_area,
            "total_siding_area_less_penetrations": self.total_siding_area_less_penetrations,
            "total_masonry_area": self.total_masonry_area,
            "total_masonry_area_less_penetrations": self.total_masonry_area_less_penetrations,
            "total_wall_facets": self.total_wall_facets,
            "total_windows_and_doors": self.total_windows_and_doors,
            "total_windows_and_doors_area": self.total_windows_and_doors_area,
            "total_windows_and_doors_perimeter": self.total_windows_and_doors_perimeter,
            "fascia_lf": self.fascia_lf,
            # Corners
            "inside_corners_lf": self.inside_corners_lf,
            "outside_corners_lf": self.outside_corners_lf,
            "obtuse_inside_corners_lf": self.obtuse_inside_corners_lf,
            "obtuse_outside_corners_lf": self.obtuse_outside_corners_lf,
            "inside_siding_corners_lf": self.inside_siding_corners_lf,
            "outside_siding_corners_lf": self.outside_siding_corners_lf,
            "obtuse_inside_siding_corners_lf": self.obtuse_inside_siding_corners_lf,
            "obtuse_outside_siding_corners_lf": self.obtuse_outside_siding_corners_lf,
            "inside_masonry_corners_lf": self.inside_masonry_corners_lf,
            "outside_masonry_corners_lf": self.outside_masonry_corners_lf,
            "inside_siding_to_masonry_lf": self.inside_siding_to_masonry_lf,
            "outside_siding_to_masonry_lf": self.outside_siding_to_masonry_lf,
            # Siding wall lengths
            "top_siding_walls_lf": self.top_siding_walls_lf,
            "bottom_siding_walls_lf": self.bottom_siding_walls_lf,
            "top_masonry_walls_lf": self.top_masonry_walls_lf,
            "bottom_masonry_walls_lf": self.bottom_masonry_walls_lf,
            # Materials
            "materials": self.materials,
            "sub_types": self.sub_types,
            # Wall details
            "walls": [
                {
                    "id": w.id,
                    "designator": w.designator,
                    "orientation": w.orientation,
                    "direction": w.direction,
                    "area": w.area,
                    "siding_area": w.siding_area,
                    "siding_area_net": w.siding_area_net,
                    "masonry_area": w.masonry_area,
                    "window_count": w.window_count,
                    "door_count": w.door_count,
                    "total_penetration_area": w.total_penetration_area,
                    "penetrations": [
                        {
                            "designator": p.designator,
                            "area": p.area,
                            "perimeter": p.perimeter,
                            "width": p.width,
                            "height": p.height,
                            "sub_type": p.sub_type,
                            "dimension_raw": p.dimension_raw,
                        }
                        for p in w.penetrations
                    ],
                }
                for w in self.all_walls
            ],
        }


# ── Parser ────────────────────────────────────────────────────────────────


def _safe_float(value: Optional[str], default: float = 0.0) -> float:
    if not value:
        return default
    try:
        return float(value)
    except (ValueError, TypeError):
        return default


def _safe_int(value: Optional[str], default: int = 0) -> int:
    if not value:
        return default
    try:
        return int(float(value))
    except (ValueError, TypeError):
        return default


def _parse_dimension(dim_str: str) -> tuple:
    """Parse '3 x 7' → (3.0, 7.0) = (width, height)."""
    if not dim_str:
        return (0.0, 0.0)
    parts = dim_str.split("x")
    if len(parts) != 2:
        return (0.0, 0.0)
    return (_safe_float(parts[0].strip()), _safe_float(parts[1].strip()))


def _orientation_to_direction(orientation: float, north_offset: float = 0.0) -> str:
    """Convert orientation degrees to compass direction."""
    # Normalize to 0-360
    angle = (orientation + north_offset) % 360

    if angle < 22.5 or angle >= 337.5:
        return "N"
    elif angle < 67.5:
        return "NE"
    elif angle < 112.5:
        return "E"
    elif angle < 157.5:
        return "SE"
    elif angle < 202.5:
        return "S"
    elif angle < 247.5:
        return "SW"
    elif angle < 292.5:
        return "W"
    else:
        return "NW"


def _guess_sub_type(width: float, height: float) -> str:
    """Guess penetration sub_type from dimensions when not provided."""
    if width == 0 and height == 0:
        return "NONE"
    # Garage doors: typically >= 7ft wide and >= 6ft tall
    if width >= 7 and height >= 6:
        return "GARAGE_DOOR"
    # Regular doors: height >= 6.5ft
    if height >= 6.5:
        return "DOOR"
    # Small openings (vents, etc.)
    if width <= 1.5 and height <= 1.5:
        return "NONE"
    return "WINDOW"


def parse_eagleview_xml(xml_content: str) -> EagleViewSidingReport:
    """
    Parse EagleView XML content and return structured siding report data.

    Args:
        xml_content: Raw XML string content

    Returns:
        EagleViewSidingReport with all parsed data
    """
    root = ET.fromstring(xml_content)
    report = EagleViewSidingReport()

    # ── REPORT ──
    report_el = root.find("REPORT")
    if report_el is not None:
        report.report_id = report_el.get("reportId", "")
        report.claim_id = report_el.get("claimId", "")

    # ── LOCATION ──
    location_el = root.find("LOCATION")
    if location_el is not None:
        report.address = location_el.get("address", "")
        report.city = location_el.get("city", "")
        report.state = location_el.get("state", "")
        report.zip_code = location_el.get("postal", "")
        report.latitude = _safe_float(location_el.get("lat"))
        report.longitude = _safe_float(location_el.get("long"))

    # ── MATERIALS ──
    materials_el = root.find("MATERIALS")
    if materials_el is not None:
        for mat in materials_el.findall("MATERIAL"):
            mat_id = mat.get("id", "")
            mat_label = mat.get("label", "")
            report.materials[mat_id] = mat_label

    # ── SUBTYPES (newer format) ──
    subtypes_el = root.find("SUBTYPES")
    if subtypes_el is not None:
        for st in subtypes_el.findall("SUBTYPE"):
            st_id = st.get("id", "")
            st_label = st.get("label", "")
            report.sub_types[st_id] = st_label

    # ── STRUCTURES ──
    for structures_el in root.findall("STRUCTURES"):
        north_orientation = _safe_float(structures_el.get("northorientation"))

        for roof_el in structures_el.findall("ROOF"):
            structure = StructureData(roof_id=roof_el.get("id", ""))

            # Collect all faces
            faces_el = roof_el.find("FACES")
            if faces_el is None:
                continue

            # First pass: collect walls and penetrations
            wall_faces = {}       # id → FACE element
            pen_faces = {}        # id → FACE element
            material_faces = []   # MATERIAL face elements

            for face in faces_el.findall("FACE"):
                face_type = face.get("type", "")
                if face_type == "WALL":
                    wall_faces[face.get("id", "")] = face
                elif face_type == "WALLPENETRATION":
                    pen_faces[face.get("id", "")] = face
                elif face_type == "MATERIAL":
                    material_faces.append(face)

            # Parse penetrations
            penetrations_by_id = {}
            for face_id, face in pen_faces.items():
                polygon = face.find("POLYGON")
                if polygon is None:
                    continue

                dim_raw = polygon.get("dimension", polygon.get("unroundeddimension", ""))
                width, height = _parse_dimension(dim_raw)

                # Determine sub_type
                sub_type_id = face.get("subType", "")
                if sub_type_id and sub_type_id in report.sub_types:
                    sub_type = report.sub_types[sub_type_id]
                elif sub_type_id and sub_type_id != "1":
                    sub_type = sub_type_id
                else:
                    sub_type = _guess_sub_type(width, height)

                pen = PenetrationData(
                    id=face_id,
                    designator=face.get("designator", ""),
                    parent_wall_id="",  # will be set below
                    parent_wall_designator="",
                    area=_safe_float(polygon.get("size")),
                    perimeter=_safe_float(polygon.get("perimeter")),
                    width=width,
                    height=height,
                    sub_type=sub_type,
                    dimension_raw=dim_raw,
                )
                penetrations_by_id[face_id] = pen
                structure.penetrations.append(pen)

            # Parse material zones
            for face in material_faces:
                polygon = face.find("POLYGON")
                if polygon is None:
                    continue

                mat_id = face.get("material", "")
                mat_label = report.materials.get(mat_id, "Unknown")

                # Skip non-siding/masonry materials
                if mat_label not in ("Siding", "Masonry"):
                    continue

                zone = MaterialZone(
                    id=face.get("id", ""),
                    designator=face.get("designator", ""),
                    material_id=mat_id,
                    material_label=mat_label,
                    orientation=_safe_float(polygon.get("orientation")),
                    area=_safe_float(polygon.get("size")),
                    area_less_penetrations=_safe_float(
                        polygon.get("sizelesspenetrations",
                                    polygon.get("size"))
                    ),
                )
                structure.material_zones.append(zone)

            # Parse walls and link penetrations/materials
            for face_id, face in wall_faces.items():
                polygon = face.find("POLYGON")
                if polygon is None:
                    continue

                orientation = _safe_float(polygon.get("orientation"))
                direction = _orientation_to_direction(orientation)

                # Parse children (penetration IDs)
                children_str = face.get("children", "")
                child_ids = [c.strip() for c in children_str.split(",") if c.strip()]

                wall = WallData(
                    id=face_id,
                    designator=face.get("designator", ""),
                    orientation=orientation,
                    direction=direction,
                    area=_safe_float(polygon.get("size")),
                    penetration_ids=child_ids,
                )

                # Link penetrations to wall
                for child_id in child_ids:
                    if child_id in penetrations_by_id:
                        pen = penetrations_by_id[child_id]
                        pen.parent_wall_id = face_id
                        pen.parent_wall_designator = wall.designator
                        wall.penetrations.append(pen)

                # Link material zones to wall by orientation proximity
                for zone in structure.material_zones:
                    # Material zones on the same wall share similar orientation
                    orient_diff = abs(zone.orientation - wall.orientation) % 360
                    if orient_diff > 180:
                        orient_diff = 360 - orient_diff
                    if orient_diff < 30:  # within 30 degrees
                        wall.material_zones.append(zone)

                structure.walls.append(wall)

            # Parse per-structure summary if present
            summary_el = roof_el.find("SUMMARY")
            if summary_el is not None:
                for attr in summary_el.findall("ATTRIBUTE"):
                    name = attr.get("name", "")
                    value = _safe_float(attr.get("value"))
                    structure.summary[name] = value

            report.structures.append(structure)

    # ── OVERALL_SUMMARY ──
    overall = root.find("OVERALL_SUMMARY")
    if overall is not None:
        attrs = {}
        for attr in overall.findall("ATTRIBUTE"):
            attrs[attr.get("name", "")] = attr.get("value", "")

        report.total_wall_area = _safe_float(attrs.get("TotalWallArea"))
        report.total_wall_area_less_penetrations = _safe_float(
            attrs.get("TotalWallAreaLessPenetrations")
        )
        report.total_siding_area = _safe_float(attrs.get("TotalSidingArea"))
        report.total_siding_area_less_penetrations = _safe_float(
            attrs.get("TotalSidingAreaLessPenetrations")
        )
        report.total_masonry_area = _safe_float(attrs.get("TotalMasonryArea"))
        report.total_masonry_area_less_penetrations = _safe_float(
            attrs.get("TotalMasonryAreaLessPenetrations")
        )
        report.total_wall_facets = _safe_int(attrs.get("TotalWallFacets"))
        report.total_windows_and_doors = _safe_int(attrs.get("TotalWindowsAndDoors"))
        report.total_windows_and_doors_area = _safe_float(
            attrs.get("TotalWindowsAndDoorsArea")
        )
        report.total_windows_and_doors_perimeter = _safe_float(
            attrs.get("TotalWindowsAndDoorsPerimeter")
        )
        report.fascia_lf = _safe_float(attrs.get("Fascia"))

        # Corner lengths
        report.inside_corners_lf = _safe_float(
            attrs.get("TotalInsideCornersLength")
        )
        report.outside_corners_lf = _safe_float(
            attrs.get("TotalOutsideCornersLength")
        )
        report.obtuse_inside_corners_lf = _safe_float(
            attrs.get("TotalObtuseInsideCornersLength")
        )
        report.obtuse_outside_corners_lf = _safe_float(
            attrs.get("TotalObtuseOutsideCornersLength")
        )

        # Siding corners
        report.inside_siding_corners_lf = _safe_float(
            attrs.get("TotalInsideSidingCornersLength")
        )
        report.outside_siding_corners_lf = _safe_float(
            attrs.get("TotalOutsideSidingCornersLength")
        )
        report.obtuse_inside_siding_corners_lf = _safe_float(
            attrs.get("TotalObtuseInsideSidingCornersLength")
        )
        report.obtuse_outside_siding_corners_lf = _safe_float(
            attrs.get("TotalObtuseOutsideSidingCornersLength")
        )

        # Masonry corners
        report.inside_masonry_corners_lf = _safe_float(
            attrs.get("TotalInsideMasonryCornersLength")
        )
        report.outside_masonry_corners_lf = _safe_float(
            attrs.get("TotalOutsideMasonryCornersLength")
        )

        # Siding-to-Masonry transition corners
        report.inside_siding_to_masonry_lf = _safe_float(
            attrs.get("TotalInsideSidingToMasonryCornersLength")
        )
        report.outside_siding_to_masonry_lf = _safe_float(
            attrs.get("TotalOutsideSidingToMasonryCornersLength")
        )

        # Wall lengths
        report.top_siding_walls_lf = _safe_float(
            attrs.get("TotalTopSidingWallsLength")
        )
        report.bottom_siding_walls_lf = _safe_float(
            attrs.get("TotalBottomSidingWallsLength")
        )
        report.top_masonry_walls_lf = _safe_float(
            attrs.get("TotalTopMasonryWallsLength")
        )
        report.bottom_masonry_walls_lf = _safe_float(
            attrs.get("TotalBottomMasonryWallsLength")
        )

    # If no OVERALL_SUMMARY but TotalWallArea is 0, compute from walls
    if report.total_wall_area == 0 and report.total_siding_area == 0:
        _compute_totals_from_structures(report)

    return report


def _compute_totals_from_structures(report: EagleViewSidingReport):
    """Fallback: compute totals from individual structure data."""
    for structure in report.structures:
        for key, value in structure.summary.items():
            current = getattr(report, _attr_name(key), None)
            if current is not None and isinstance(current, (int, float)):
                setattr(report, _attr_name(key), current + value)


def _attr_name(summary_key: str) -> str:
    """Map OVERALL_SUMMARY attribute name to report field name."""
    mapping = {
        "TotalWallArea": "total_wall_area",
        "TotalWallAreaLessPenetrations": "total_wall_area_less_penetrations",
        "TotalSidingArea": "total_siding_area",
        "TotalSidingAreaLessPenetrations": "total_siding_area_less_penetrations",
        "TotalMasonryArea": "total_masonry_area",
        "TotalMasonryAreaLessPenetrations": "total_masonry_area_less_penetrations",
        "TotalWallFacets": "total_wall_facets",
        "TotalWindowsAndDoors": "total_windows_and_doors",
        "TotalWindowsAndDoorsArea": "total_windows_and_doors_area",
        "TotalWindowsAndDoorsPerimeter": "total_windows_and_doors_perimeter",
        "Fascia": "fascia_lf",
        "TotalInsideCornersLength": "inside_corners_lf",
        "TotalOutsideCornersLength": "outside_corners_lf",
    }
    return mapping.get(summary_key, "")


def parse_eagleview_file(file_path: str) -> EagleViewSidingReport:
    """Parse EagleView XML file from a file path."""
    with open(file_path, "r", encoding="utf-8") as f:
        return parse_eagleview_xml(f.read())
