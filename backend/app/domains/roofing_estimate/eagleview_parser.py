"""
EagleView Measurement Report Parser (Python port)
Parses EagleView export JSON/XML data into structured roof measurement data.

Based on reference implementation in eagleview-parser.ts.
Supports:
  - Multiple structures (e.g., main house + detached garage)
  - Partial roof selection for replacement estimates
  - Structure-level filtering
"""

import math
import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ── Data Structures ──

class Point3D:
    __slots__ = ("x", "y", "z")

    def __init__(self, x: float, y: float, z: float):
        self.x = x
        self.y = y
        self.z = z


class RoofLine:
    __slots__ = ("id", "type", "pt_ids", "length", "structure_index")

    def __init__(self, id: str, type: str, pt_ids: List[str],
                 length: float, structure_index: int = 0):
        self.id = id
        self.type = type
        self.pt_ids = pt_ids
        self.length = length
        self.structure_index = structure_index


class RoofFace:
    __slots__ = ("id", "designator", "type", "area", "pitch",
                 "line_ids", "is_accessory", "structure_index",
                 "vertices", "centroid")

    def __init__(self, id: str, designator: str, type: str,
                 area: float, pitch: str, line_ids: List[str],
                 is_accessory: bool, structure_index: int = 0,
                 vertices: Optional[List[Dict]] = None,
                 centroid: Optional[Dict] = None):
        self.id = id
        self.designator = designator
        self.type = type
        self.area = area
        self.pitch = pitch
        self.line_ids = line_ids
        self.is_accessory = is_accessory
        self.structure_index = structure_index
        self.vertices = vertices or []
        self.centroid = centroid or {"x": 0, "y": 0}


class StructureInfo:
    """Summary info for a single structure in the report."""

    def __init__(self, index: int):
        self.index = index
        self.total_sf: float = 0
        self.facet_count: int = 0
        self.predominant_pitch: str = "?"
        self.pitch_min: Optional[str] = None
        self.pitch_max: Optional[str] = None
        self.complexity: str = "normal"
        self.face_ids: List[str] = []


class ParsedRoofData:
    """Structured result from parsing EagleView data."""

    def __init__(self):
        self.points: Dict[str, Point3D] = {}
        self.lines: Dict[str, RoofLine] = {}
        self.faces: List[RoofFace] = []
        self.structures: List[StructureInfo] = []


# ── Core Parser ──

def parse_eagleview(raw: dict) -> ParsedRoofData:
    """
    Parse EagleView export JSON into structured roof data.

    Handles both single and multi-structure reports:

    Single structure:
    {
      "EAGLEVIEW_EXPORT": {
        "STRUCTURES": {
          "ROOF": { "POINTS": {...}, "LINES": {...}, "FACES": {...} }
        }
      }
    }

    Multiple structures:
    {
      "EAGLEVIEW_EXPORT": {
        "STRUCTURES": {
          "ROOF": [
            { "POINTS": {...}, "LINES": {...}, "FACES": {...} },
            { "POINTS": {...}, "LINES": {...}, "FACES": {...} }
          ]
        }
      }
    }
    """
    result = ParsedRoofData()

    try:
        structures_node = raw["EAGLEVIEW_EXPORT"]["STRUCTURES"]
    except (KeyError, TypeError) as e:
        logger.error("Invalid EagleView data structure: %s", e)
        raise ValueError("Invalid EagleView export format") from e

    # Detect format:
    # Format A: STRUCTURES is an array of {ROOF: {...}} objects
    #   e.g. "STRUCTURES": [ {"ROOF": {...}}, {"ROOF": {...}} ]
    # Format B: STRUCTURES is a dict with ROOF key (single or array)
    #   e.g. "STRUCTURES": { "ROOF": {...} }
    #   e.g. "STRUCTURES": { "ROOF": [{...}, {...}] }

    roof_list: list = []

    if isinstance(structures_node, list):
        # Format A: array of structure objects, each with a ROOF key
        for struct_obj in structures_node:
            roof = struct_obj.get("ROOF") if isinstance(struct_obj, dict) else None
            if roof:
                roof_list.append(roof)
    elif isinstance(structures_node, dict):
        # Format B: dict with ROOF key
        roof_node = structures_node.get("ROOF")
        if roof_node is None:
            raise ValueError("No ROOF data found in EagleView export")
        roof_list = _ensure_list(roof_node)
    else:
        raise ValueError("Invalid STRUCTURES format in EagleView export")

    if not roof_list:
        raise ValueError("No ROOF data found in EagleView export")

    for struct_idx, roof in enumerate(roof_list):
        _parse_single_structure(roof, struct_idx, result)

    # Build structure summaries
    _build_structure_summaries(result)

    logger.info(
        "Parsed EagleView: %d structure(s), %d faces, %d lines",
        len(result.structures), len(result.faces), len(result.lines),
    )

    return result


def _parse_single_structure(
    roof: dict, struct_idx: int, result: ParsedRoofData
) -> None:
    """Parse a single ROOF structure and append to result."""
    # Prefix for IDs to avoid collisions between structures
    prefix = f"S{struct_idx + 1}_" if struct_idx > 0 else ""

    # Parse points
    point_list = _ensure_list(roof.get("POINTS", {}).get("POINT", []))
    for p in point_list:
        coords = str(p.get("@data", "0,0,0")).split(",")
        if len(coords) >= 3:
            x, y, z = float(coords[0]), float(coords[1]), float(coords[2])
            pid = prefix + p["@id"]
            result.points[pid] = Point3D(x, y, z)

    # Parse lines
    line_list = _ensure_list(roof.get("LINES", {}).get("LINE", []))
    for l_data in line_list:
        raw_pt_ids = str(l_data.get("@path", "")).split(",")
        pt_ids = [prefix + pid for pid in raw_pt_ids]
        length = _calc_line_length(pt_ids, result.points)
        lid = prefix + l_data["@id"]
        line = RoofLine(
            id=lid,
            type=l_data.get("@type", "OTHER"),
            pt_ids=pt_ids,
            length=length,
            structure_index=struct_idx,
        )
        result.lines[lid] = line

    # Parse faces
    face_list = _ensure_list(roof.get("FACES", {}).get("FACE", []))
    for f_data in face_list:
        poly = f_data.get("POLYGON", {})
        raw_path = str(poly.get("@path", "")).split(",")
        # Keep raw path order for polygon reconstruction
        raw_line_refs = [lid for lid in raw_path if lid.startswith("L")]
        line_ids = list(dict.fromkeys(
            prefix + lid for lid in raw_line_refs
        ))
        # Build ordered line refs with prefix for polygon
        ordered_refs = [prefix + lid for lid in raw_line_refs]

        area = float(poly.get("@unroundedsize", poly.get("@size", 0)))
        pitch = poly.get("@pitch", "?")
        designator = f_data.get("@designator", "")
        is_accessory = designator.isdigit()
        fid = prefix + f_data["@id"]

        # Build polygon vertices for visualization
        vertices = _build_polygon(ordered_refs, result.lines, result.points)
        centroid = _compute_centroid(vertices)

        face = RoofFace(
            id=fid,
            designator=designator,
            type=f_data.get("@type", ""),
            area=area,
            pitch=pitch,
            line_ids=line_ids,
            is_accessory=is_accessory,
            structure_index=struct_idx,
            vertices=vertices,
            centroid=centroid,
        )
        result.faces.append(face)


def _build_structure_summaries(result: ParsedRoofData) -> None:
    """Build per-structure summary info."""
    # Determine how many structures we have
    struct_indices = set()
    for f in result.faces:
        struct_indices.add(f.structure_index)

    for idx in sorted(struct_indices):
        info = StructureInfo(idx)
        struct_faces = [f for f in result.faces
                        if f.structure_index == idx and not f.is_accessory]
        info.facet_count = len(struct_faces)
        info.total_sf = sum(f.area for f in struct_faces)
        info.predominant_pitch = _get_predominant_pitch(struct_faces)

        # Pitch range
        pitches = _collect_numeric_pitches(struct_faces)
        if pitches:
            info.pitch_min = str(min(pitches))
            info.pitch_max = str(max(pitches))
        info.face_ids = [f.id for f in struct_faces]

        # Complexity heuristic
        if info.facet_count <= 4:
            info.complexity = "simple"
        elif info.facet_count <= 10:
            info.complexity = "normal"
        else:
            info.complexity = "complex"

        result.structures.append(info)


# ── Measurement Extraction ──

def extract_measurements(
    data: ParsedRoofData,
    selected_face_ids: Optional[List[str]] = None,
    selected_structures: Optional[List[int]] = None,
) -> Dict[str, Any]:
    """
    Extract structured measurement values from parsed roof data.

    Args:
        data: ParsedRoofData from parse_eagleview()
        selected_face_ids: If provided, only include these faces
                          (for partial roof replacement)
        selected_structures: If provided, only include faces from
                           these structure indices (e.g., [0] for
                           main house only, [0,1] for both)

    Returns:
        Dict with all measurement values needed for estimate.
    """
    # Filter faces
    if selected_face_ids:
        faces = [f for f in data.faces if f.id in selected_face_ids]
    elif selected_structures is not None:
        faces = [f for f in data.faces
                 if f.structure_index in selected_structures
                 and not f.is_accessory]
    else:
        # Default: all non-accessory faces from all structures
        faces = [f for f in data.faces if not f.is_accessory]

    if not faces:
        return _empty_measurements(data)

    # Collect line IDs used by selected faces
    selected_line_ids = set()
    for face in faces:
        selected_line_ids.update(face.line_ids)

    # Calculate areas
    total_sf = sum(f.area for f in faces)

    # Determine predominant pitch
    predominant_pitch = _get_predominant_pitch(faces)

    # Sum line lengths by type
    line_totals = _sum_lines_by_type(data.lines, selected_line_ids)

    # Count accessories from selected structures
    selected_structs = set(f.structure_index for f in faces)
    accessories = [f for f in data.faces
                   if f.is_accessory
                   and f.structure_index in selected_structs]
    penetration_count = len(accessories)

    # Overall pitch range
    all_pitches = _collect_numeric_pitches(faces)
    pitch_min = str(min(all_pitches)) if all_pitches else None
    pitch_max = str(max(all_pitches)) if all_pitches else None

    return {
        "total_sf": round(total_sf, 1),
        "squares": round(total_sf / 100, 2),
        "predominant_pitch": predominant_pitch,
        "pitch_min": pitch_min,
        "pitch_max": pitch_max,
        "ridge_lf": round(line_totals.get("RIDGE", 0), 1),
        "hip_lf": round(line_totals.get("HIP", 0), 1),
        "valley_lf": round(line_totals.get("VALLEY", 0), 1),
        "eave_lf": round(line_totals.get("EAVE", 0), 1),
        "rake_lf": round(line_totals.get("RAKE", 0), 1),
        "step_flashing_lf": round(
            line_totals.get("STEPFLASH", 0) + line_totals.get("FLASHING", 0), 1
        ),
        "penetration_count": penetration_count,
        "structures": [
            {
                "index": s.index,
                "label": f"Structure #{s.index + 1}",
                "total_sf": round(s.total_sf, 1),
                "facet_count": s.facet_count,
                "predominant_pitch": s.predominant_pitch,
                "pitch_min": s.pitch_min,
                "pitch_max": s.pitch_max,
                "complexity": s.complexity,
            }
            for s in data.structures
        ],
        "faces": [
            {
                "id": f.id,
                "designator": f.designator,
                "area": round(f.area, 1),
                "pitch": f.pitch,
                "is_accessory": f.is_accessory,
                "structure_index": f.structure_index,
                "vertices": f.vertices,
                "centroid": f.centroid,
            }
            for f in faces
        ],
        "all_faces": [
            {
                "id": f.id,
                "designator": f.designator,
                "area": round(f.area, 1),
                "pitch": f.pitch,
                "is_accessory": f.is_accessory,
                "structure_index": f.structure_index,
                "vertices": f.vertices,
                "centroid": f.centroid,
            }
            for f in data.faces
        ],
        "lines": [
            {
                "id": l.id,
                "type": l.type,
                "length": round(l.length, 1),
                "structure_index": l.structure_index,
                "points": [
                    {"x": data.points[pid].x, "y": data.points[pid].y}
                    for pid in l.pt_ids if pid in data.points
                ],
            }
            for l in data.lines.values()
        ],
    }


# ── Geometry Helpers ──

def slope_factor(pitch: str) -> float:
    """Calculate slope factor from pitch string like '6/12'."""
    try:
        p = float(pitch.split("/")[0])
    except (ValueError, IndexError):
        return 1.0
    return math.sqrt(1 + (p / 12) ** 2)


# ── Internal Helpers ──

def _build_polygon(
    ordered_line_ids: List[str],
    lines: Dict[str, RoofLine],
    points: Dict[str, Point3D],
) -> List[Dict[str, float]]:
    """Reconstruct 2D polygon vertices from ordered line IDs.

    Traces through line segments in order, building a closed polygon
    by following point connections. Returns list of {x, y} dicts.
    """
    if not ordered_line_ids:
        return []

    # Count how many times each line ID appears
    quota: Dict[str, int] = {}
    for lid in ordered_line_ids:
        quota[lid] = quota.get(lid, 0) + 1

    # Build segment data
    seg_data: Dict[str, Dict] = {}
    for lid in quota:
        line = lines.get(lid)
        if not line:
            continue
        pt_ids = [pid for pid in line.pt_ids if pid in points]
        if len(pt_ids) < 2:
            continue
        seg_data[lid] = {
            "pt_ids": pt_ids,
            "first": pt_ids[0],
            "last": pt_ids[-1],
        }

    if not seg_data:
        return []

    # Build adjacency graph
    adj: Dict[str, List[Dict]] = {}
    for lid, seg in seg_data.items():
        count = quota.get(lid, 1)
        for k in range(count):
            fwd = {"to": seg["last"], "lid": lid, "rev": False,
                    "key": f"{lid}:{k}"}
            rev = {"to": seg["first"], "lid": lid, "rev": True,
                    "key": f"{lid}:{k}r"}
            adj.setdefault(seg["first"], []).append(fwd)
            adj.setdefault(seg["last"], []).append(rev)

    # Start from first segment's first point
    first_seg = seg_data.get(ordered_line_ids[0])
    start_id = first_seg["first"] if first_seg else next(iter(adj), None)
    if not start_id:
        return []

    used_keys: set = set()
    chain: List[str] = [start_id]
    cur = start_id
    path_idx = 0
    total_steps = len(ordered_line_ids)

    for _ in range(total_steps * 2):
        edges = [e for e in adj.get(cur, []) if e["key"] not in used_keys]
        if not edges:
            break

        # Prefer edge matching the expected line order
        target_lid = ordered_line_ids[path_idx % len(ordered_line_ids)]
        preferred = next((e for e in edges if e["lid"] == target_lid), None)
        edge = preferred or edges[0]

        used_keys.add(edge["key"])
        # Mark twin as used too
        twin = next(
            (e for e in adj.get(edge["to"], [])
             if e["lid"] == edge["lid"] and e["rev"] != edge["rev"]
             and e["key"] not in used_keys),
            None,
        )
        if twin:
            used_keys.add(twin["key"])

        seg = seg_data[edge["lid"]]
        pts = list(reversed(seg["pt_ids"])) if edge["rev"] else seg["pt_ids"]
        for pid in pts[1:]:
            if pid in points:
                chain.append(pid)

        cur = edge["to"]
        path_idx += 1

    # Deduplicate consecutive points and close polygon
    result: List[str] = []
    for pid in chain:
        if not result or result[-1] != pid:
            result.append(pid)
    if len(result) > 1 and result[0] == result[-1]:
        result.pop()

    return [{"x": points[pid].x, "y": points[pid].y}
            for pid in result if pid in points]


def _compute_centroid(vertices: List[Dict[str, float]]) -> Dict[str, float]:
    """Compute centroid of polygon vertices."""
    if not vertices:
        return {"x": 0, "y": 0}
    return {
        "x": sum(v["x"] for v in vertices) / len(vertices),
        "y": sum(v["y"] for v in vertices) / len(vertices),
    }


def _ensure_list(val: Any) -> list:
    """Ensure value is a list (EagleView XML sometimes returns single dict)."""
    if isinstance(val, list):
        return val
    if val is None:
        return []
    return [val]


def _calc_line_length(pt_ids: List[str], points: Dict[str, Point3D]) -> float:
    """Calculate 3D line length from point sequence."""
    length = 0.0
    for i in range(len(pt_ids) - 1):
        a = points.get(pt_ids[i])
        b = points.get(pt_ids[i + 1])
        if a and b:
            length += math.sqrt(
                (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2
            )
    return length


def _get_predominant_pitch(faces: List[RoofFace]) -> str:
    """Find the most common pitch among faces (weighted by area)."""
    pitch_area: Dict[str, float] = {}
    for f in faces:
        if f.pitch and f.pitch != "?":
            pitch_area[f.pitch] = pitch_area.get(f.pitch, 0) + f.area

    if not pitch_area:
        return "6/12"

    return max(pitch_area, key=pitch_area.get)


def _collect_numeric_pitches(faces: List[RoofFace]) -> List[float]:
    """Extract numeric pitch values from faces for range calculation."""
    values = []
    for f in faces:
        if not f.pitch or f.pitch == "?":
            continue
        try:
            # Handle both "6/12" and plain "6" formats
            val = float(f.pitch.split("/")[0]) if "/" in f.pitch else float(f.pitch)
            values.append(val)
        except (ValueError, IndexError):
            continue
    return values


def _sum_lines_by_type(
    lines: Dict[str, RoofLine],
    selected_ids: set,
) -> Dict[str, float]:
    """Sum line lengths grouped by type, filtered to selected IDs."""
    totals: Dict[str, float] = {}
    for line in lines.values():
        if line.id in selected_ids:
            totals[line.type] = totals.get(line.type, 0) + line.length
    return totals


def _empty_measurements(data: Optional[ParsedRoofData] = None) -> Dict[str, Any]:
    """Return zeroed measurement dict."""
    structures = []
    if data:
        structures = [
            {
                "index": s.index,
                "label": f"Structure #{s.index + 1}",
                "total_sf": round(s.total_sf, 1),
                "facet_count": s.facet_count,
                "predominant_pitch": s.predominant_pitch,
                "complexity": s.complexity,
            }
            for s in data.structures
        ]
    return {
        "total_sf": 0,
        "squares": 0,
        "predominant_pitch": None,
        "ridge_lf": 0,
        "hip_lf": 0,
        "valley_lf": 0,
        "eave_lf": 0,
        "rake_lf": 0,
        "step_flashing_lf": 0,
        "penetration_count": 0,
        "structures": structures,
        "faces": [],
        "all_faces": [],
        "lines": [],
    }
