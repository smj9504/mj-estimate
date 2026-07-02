/**
 * BESketchTab - Bathroom Estimate Sketch main tab component
 *
 * Top-level component rendered inside BathroomEstimateDetail as the Sketch tab.
 * Composes: BESketchToolbar + BESketchCanvas + BESketchSidebar
 *
 * Usage:
 *   <BESketchTab
 *     estimateId="abc-123"
 *     estimateData={formValues}
 *     onSketchChange={handleSketchChange}
 *   />
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Layout, Button, Space, Typography, message, Spin, Tooltip, Grid, Drawer } from 'antd';
import {
  SaveOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ExpandOutlined,
} from '@ant-design/icons';
import type { BESketchData } from '../../../types/bathroomSketch';
import { EMPTY_BE_SKETCH } from '../../../types/bathroomSketch';
import { useBESketchState } from './hooks/useBESketchState';
import BESketchToolbar from './BESketchToolbar';
import BESketchCanvas from './BESketchCanvas';
import BESketchSidebar from './BESketchSidebar';
import { bathroomEstimateService } from '../../../services/bathroomEstimateService';

const { Sider, Content } = Layout;
const { Text } = Typography;
const { useBreakpoint } = Grid;

// ── Props ──

/** Extracted sketch data for syncing sketch → estimate form fields */
export interface SketchFixtureSync {
  // Room dimensions
  length_ft?: number;
  width_ft?: number;
  floor_sf?: number;
  wall_sf?: number;
  /** Paintable wall SF (total wall minus shower/tub/tile wall areas) */
  paint_wall_sf?: number;
  /** Tile wall SF (walls marked as 'tile' finish in sketch) */
  tile_wall_sf?: number;

  // Walls spec sync
  walls_spec?: Record<string, any>;

  // Fixture replace flags
  replace_tub?: boolean;
  replace_shower?: boolean;
  replace_vanity?: boolean;
  replace_toilet?: boolean;
  replace_mirror?: boolean;

  // Demo flags
  demo_walls?: boolean;
  replace_vanity_light?: boolean;
  water_damage?: boolean;
  repair_drywall_walls?: boolean;
  repair_drywall_walls_sf?: number;
  repair_drywall_ceiling?: boolean;
  repair_drywall_ceiling_sf?: number;

  // Specs
  bathtub_spec?: Record<string, any>;
  shower_spec?: Record<string, any>;
  vanity_spec?: Record<string, any>;
  toilet_spec?: Record<string, any>;

  // Electrical
  electrical_spec?: Record<string, any>;

  // Drywall repair (from sketch drywall zones)
  hidden_costs?: Record<string, any>;

  // Insulation (from sketch insulation zones)
  demo_insulation_walls?: boolean;
  demo_insulation_walls_sf?: number;
  demo_insulation_ceiling?: boolean;
  demo_insulation_ceiling_sf?: number;
  install_insulation_walls?: boolean;
  install_insulation_walls_sf?: number;
  install_insulation_ceiling?: boolean;
  install_insulation_ceiling_sf?: number;
}

export interface BESketchTabProps {
  /** Bathroom estimate ID for persistence */
  estimateId: string;
  /** Current estimate form data (for syncing dimensions, fixtures, etc.) */
  estimateData?: Record<string, any>;
  /** Callback when sketch data changes */
  onSketchChange?: (data: BESketchData) => void;
  /** Callback to sync fixture data → estimate form fields */
  onFixtureSync?: (sync: SketchFixtureSync) => void;
  /** Initial sketch data (loaded from backend) */
  initialSketchData?: BESketchData;
  /** Whether this tab is currently active */
  isActive?: boolean;
}

// ── Component ──

/** Build sync payload from sketch rooms + fixtures → estimate form fields */
function buildSketchSync(data: BESketchData): SketchFixtureSync {
  const { fixtures, rooms, walls } = data;
  const ppf = data.settings.pixelsPerFoot;
  const sync: SketchFixtureSync = {};

  // ── Room dimensions (all rooms combined) ──
  const bathroom = rooms.find(r => r.roomType === 'bathroom') || rooms[0];
  if (bathroom && bathroom.boundary.length >= 3) {
    // Primary bathroom bounding box → length/width fields
    const xs = bathroom.boundary.map(p => p.x);
    const ys = bathroom.boundary.map(p => p.y);
    const widthPx = Math.max(...xs) - Math.min(...xs);
    const depthPx = Math.max(...ys) - Math.min(...ys);
    const widthFt = Math.round((widthPx / ppf) * 4) / 4;
    const depthFt = Math.round((depthPx / ppf) * 4) / 4;
    sync.length_ft = widthFt;
    sync.width_ft = depthFt;

    // Floor SF: primary room minus fixture footprints + additional rooms
    const primaryFloorSF = widthFt * depthFt;
    let fixtureFootprintSF = 0;
    for (const fix of fixtures) {
      if (fix.type !== 'bathtub' && fix.type !== 'shower' && fix.type !== 'vanity') continue;
      fixtureFootprintSF += (fix.dimensions.width / 12) * (fix.dimensions.height / 12);
    }
    let totalFloorSF = Math.max(0, primaryFloorSF - fixtureFootprintSF);

    // Wall SF: primary room + additional rooms, minus door/window openings
    const heightFt = (bathroom.heightInches || 96) / 12;
    const perimeterFt = 2 * (widthFt + depthFt);
    const grossWallSF = perimeterFt * heightFt;

    // Deduct door/window openings from wall area
    let doorWindowDeductSF = 0;
    for (const fix of fixtures) {
      if (fix.type !== 'door' && fix.type !== 'window') continue;
      const fW = fix.dimensions.width / 12;  // ft
      const fH = fix.dimensions.height / 12; // ft
      doorWindowDeductSF += fW * fH;
    }
    let totalWallSF = Math.max(0, grossWallSF - doorWindowDeductSF);

    // Add additional rooms (non-sub-rooms)
    for (const rm of rooms) {
      if (rm.id === bathroom.id || rm.parentRoomId) continue;
      totalFloorSF += rm.netFloorAreaSF || rm.floorAreaSF || 0;
      totalWallSF += rm.wallAreaSF || 0;
    }

    sync.floor_sf = Math.round(totalFloorSF * 10) / 10;
    sync.wall_sf = Math.round(totalWallSF * 10) / 10;

    // ── Per-wall finish: calculate paint SF vs tile SF ──
    // Walls with finish='tile' → tile_wall_sf, rest → paint_wall_sf
    // Both exclude areas covered by shower/bathtub fixtures
    let coveredWallSF = 0;

    // Shower: walls touching bathroom walls
    const showerFix = fixtures.find(f => f.type === 'shower');
    if (showerFix) {
      const sp = showerFix.properties;
      const sLayout = sp.showerLayout ?? 'alcove';
      const sTileH = (sp.showerTileHeight ?? 96) / 12;
      const sW = showerFix.dimensions.width / 12;
      const sD = showerFix.dimensions.height / 12;
      if (sLayout === 'alcove') {
        coveredWallSF += (sW + 2 * sD) * sTileH;
      } else {
        coveredWallSF += (sW + sD) * sTileH;
      }
    }

    // Bathtub: walls covered by surround (skip freestanding)
    const tubFix = fixtures.find(f => f.type === 'bathtub');
    if (tubFix) {
      const tp = tubFix.properties;
      if ((tp.bathtubSubType ?? 'standard_alcove') !== 'freestanding') {
        const surrWalls = tp.surroundWallCount ?? 3;
        const surrH = (tp.surroundHeight ?? 60) / 12;
        const tW = tubFix.dimensions.width / 12;
        const tD = tubFix.dimensions.height / 12;
        let surrLen = 0;
        if (surrWalls >= 1) surrLen += tW;
        if (surrWalls >= 2) surrLen += tD;
        if (surrWalls >= 3) surrLen += tD;
        coveredWallSF += surrLen * surrH;
        coveredWallSF += surrLen * ((tp.deckHeight ?? 18) / 12);
      }
    }

    // Available wall SF (after shower/tub deduction)
    const availableWallSF = Math.max(0, grossWallSF - coveredWallSF);

    // Split available area by per-wall finish settings
    let tileWallSF = 0;
    let paintWallSF = 0;
    const roomWalls = walls.filter(w => bathroom.wallIds.includes(w.id));

    if (roomWalls.length > 0) {
      // Walls exist: use per-wall finish
      let totalWallLen = 0;
      let tileWallLen = 0;
      for (const w of roomWalls) {
        const wDx = w.end.x - w.start.x;
        const wDy = w.end.y - w.start.y;
        const wLen = Math.sqrt(wDx * wDx + wDy * wDy) / ppf; // ft
        totalWallLen += wLen;
        if (w.finish === 'tile') tileWallLen += wLen;
      }
      const tileRatio = totalWallLen > 0 ? tileWallLen / totalWallLen : 0;
      tileWallSF = Math.round(availableWallSF * tileRatio * 10) / 10;
      paintWallSF = Math.round((availableWallSF - tileWallSF) * 10) / 10;
    } else {
      // No explicit walls: all paint by default
      paintWallSF = Math.round(availableWallSF * 10) / 10;
    }

    sync.paint_wall_sf = paintWallSF;
    sync.tile_wall_sf = tileWallSF;

    // Determine wall_finish mode
    const hasAnyTile = tileWallSF > 0;
    const hasAnyPaint = paintWallSF > 0;
    if (hasAnyTile && hasAnyPaint) {
      sync.walls_spec = { wall_finish: 'paint_and_tile', paint_wall_sf: paintWallSF, tile_wall_sf: tileWallSF };
    } else if (hasAnyTile) {
      sync.walls_spec = { wall_finish: 'tile', tile_wall_sf: tileWallSF };
    } else {
      sync.walls_spec = { wall_finish: 'paint' };
    }
  }

  // ── Fixture flags & specs ──
  const bathtub = fixtures.find(f => f.type === 'bathtub');
  const shower = fixtures.find(f => f.type === 'shower');
  const vanities = fixtures.filter(f => f.type === 'vanity');
  const toilet = fixtures.find(f => f.type === 'toilet');
  const mirrors = fixtures.filter(f => f.type === 'mirror');
  const lights = fixtures.filter(f => f.type === 'light');

  sync.replace_tub = !!bathtub;
  sync.replace_shower = !!shower;
  sync.replace_vanity = vanities.length > 0;
  sync.replace_toilet = !!toilet;
  if (toilet) {
    sync.toilet_spec = { type: 'two_piece_standard' };
  }
  sync.replace_mirror = mirrors.length > 0;
  // Ceiling light → electrical_spec
  // Electrical spec: lights + defaults (GFCI, exhaust fan)
  const elecSpec: Record<string, any> = {
    gfci_count: 1,
    exhaust_fan_cfm: 80,
    exhaust_fan_switch: 'standard',
  };
  if (lights.length > 0) {
    // Non-sibling lights (exclude auto-generated recessed children)
    const parentLights = lights.filter((l) => !l.properties.recessedParentId);
    const childLights = lights.filter((l) => !!l.properties.recessedParentId);
    if (parentLights.length > 0) {
      const lp = parentLights[0].properties;
      const lightType = lp.lightType ?? 'standard';
      elecSpec.ceiling_fixture = lightType;
      if (lightType === 'recessed_multi') {
        // Use actual child count on canvas (user may have deleted some)
        const actualCount = childLights.filter(
          (c) => c.properties.recessedParentId === parentLights[0].id
        ).length;
        elecSpec.recessed_can_count = actualCount > 0 ? actualCount : (lp.lightCount ?? 4);
      }
    } else if (childLights.length > 0) {
      // Parent deleted but children remain — count them as recessed
      elecSpec.ceiling_fixture = 'recessed_multi';
      elecSpec.recessed_can_count = childLights.length;
    }
    sync.replace_vanity_light = true;
  } else {
    // All lights removed — clear ceiling fixture
    elecSpec.ceiling_fixture = undefined;
    sync.replace_vanity_light = false;
  }
  sync.electrical_spec = elecSpec;
  // demo_floor is a user decision — don't auto-set from sketch
  sync.demo_walls = !!(shower || bathtub);

  if (bathtub) {
    const p = bathtub.properties;
    const subType = p.bathtubSubType ?? 'standard_alcove';
    const typeMap: Record<string, string> = {
      standard_alcove: 'alcove', drop_in: 'drop_in',
      corner_garden: 'corner', freestanding: 'freestanding',
    };
    // Calculate surround tile SF
    const tubW = bathtub.dimensions.width;
    const tubD = bathtub.dimensions.height;
    const surrWallCount = p.surroundWallCount ?? 3;
    const surrHeight = p.surroundHeight ?? 60;
    let surrPerimeter = 0;
    if (surrWallCount >= 1) surrPerimeter += tubW;
    if (surrWallCount >= 2) surrPerimeter += tubD;
    if (surrWallCount >= 3) surrPerimeter += tubD;
    const surroundSF = Math.round((surrPerimeter * surrHeight) / 144 * 100) / 100;

    // Calculate deck tile SF
    const deckW = p.deckWidth ?? 0;
    const deckSides = p.deckTileSides ?? 0;
    let deckLen = 0;
    if (deckSides >= 1) deckLen += tubW;
    if (deckSides >= 2) deckLen += tubD;
    if (deckSides >= 3) deckLen += tubD;
    if (deckSides >= 4) deckLen += tubW;
    const cornerCount = Math.max(0, deckSides - 1);
    const deckSF = Math.round((deckLen * deckW + cornerCount * deckW * deckW) / 144 * 100) / 100;

    // Calculate front panel SF
    const deckH = p.deckHeight ?? 0;
    const frontPanelSF = p.hasFrontPanel && deckH > 0
      ? Math.round((deckLen * deckH) / 144 * 100) / 100
      : 0;

    sync.bathtub_spec = {
      type: typeMap[subType] ?? 'alcove',
      material: 'acrylic',
      surround_tile: !!p.hasSurround,
      surround_tile_sf: p.hasSurround ? surroundSF : 0,
      tub_length_in: Math.max(tubW, tubD),
      tub_depth_in: Math.min(tubW, tubD),
      surround_height_in: surrHeight,
      surround_wall_count: surrWallCount,
      deck_tile: deckW > 0 && deckSides > 0,
      deck_tile_sf: deckSF,
      deck_width_in: deckW,
      deck_tile_sides: deckSides,
      front_panel_tile: !!p.hasFrontPanel,
      front_panel_sf: frontPanelSF,
      deck_height_in: deckH,
    };
  }

  if (shower) {
    const p = shower.properties;
    sync.shower_spec = {
      type: (p.showerWallCount ?? 3) > 0 ? 'custom_tile' : 'one_piece',
      width_in: shower.dimensions.width,
      depth_in: shower.dimensions.height,
      tile_height_in: p.showerTileHeight ?? 84,
      niches: p.nicheCount ?? 0,
      bench: !!p.hasBench,
      bench_position: p.benchPosition ?? 'left',
      bench_length: p.benchLength ?? 36,
      curb_height: p.curbHeight ?? 4,
      door_type: p.showerDoorType ?? 'none',
      door_width_in: p.showerDoorWidth ?? Math.round(shower.dimensions.width * 0.5),
      fixed_panel_config: p.fixedPanelConfig ?? 'none',
      layout: p.showerLayout ?? 'alcove',
      wall_material: p.showerWallMaterial ?? 'tile',
    };
  }

  if (vanities.length > 0) {
    sync.vanity_spec = {
      items: vanities.map((v, i) => {
        const mirrorForVanity = mirrors[i] ?? mirrors[0];
        const sinkType = v.properties.vanitySubType ?? 'cabinet';
        return {
          sink_type: sinkType,
          width: v.dimensions.width,
          sinks: v.properties.sinkCount ?? 1,
          mirror_width: mirrorForVanity ? mirrorForVanity.dimensions.width : undefined,
          has_mirror: !!mirrorForVanity,
        };
      }),
    };
  } else if (mirrors.length > 0) {
    // Mirrors without vanity: still sync mirror replacement
    sync.vanity_spec = {
      items: mirrors.map(m => ({
        mirror_width: m.dimensions.width,
        has_mirror: true,
      })),
    };
  }

  // ── Drywall repair zones → hidden_costs + paint sync ──
  const dwZones = data.drywallRepairZones ?? [];
  if (dwZones.length > 0) {
    const totalDwSF = dwZones.reduce((sum, z) => sum + z.areaSF, 0);
    const hasFullRepair = dwZones.some(z => z.includeGluing);
    sync.hidden_costs = {
      drywall_patch: true,
      drywall_patch_sf: Math.round(totalDwSF * 10) / 10,
      drywall_patch_full: hasFullRepair,
    };

    // Seal & prime: only demo'd (repaired) areas
    const wallDwSF = dwZones.filter(z => z.surface === 'wall').reduce((s, z) => s + z.areaSF, 0);
    const ceilDwSF = dwZones.filter(z => z.surface === 'ceiling').reduce((s, z) => s + z.areaSF, 0);
    const hasWallDw = wallDwSF > 0;
    const hasCeilDw = ceilDwSF > 0;

    // Auto-set demo scope flags: water damage repair + drywall repair
    sync.water_damage = true;
    if (hasWallDw) {
      sync.repair_drywall_walls = true;
      sync.repair_drywall_walls_sf = Math.round(wallDwSF * 10) / 10;
    }
    if (hasCeilDw) {
      sync.repair_drywall_ceiling = true;
      sync.repair_drywall_ceiling_sf = Math.round(ceilDwSF * 10) / 10;
    }

    // Full paint: if ANY wall/ceiling drywall repair, paint entire area minus tub/shower

    // Calculate paintable wall SF: total wall SF minus bathtub/shower wall areas
    let fullPaintWallSF = 0;
    if (hasWallDw && bathroom) {
      let deductSF = 0;
      // Deduct bathtub surround area
      const bathtubFix = fixtures.find(f => f.type === 'bathtub');
      if (bathtubFix) {
        const wCount = bathtubFix.properties.surroundWallCount ?? 3;
        const sHeight = bathtubFix.properties.surroundHeight ?? 60;
        const tubW = bathtubFix.dimensions.width;
        const tubD = bathtubFix.dimensions.height;
        let perim = 0;
        if (wCount >= 1) perim += tubW;
        if (wCount >= 2) perim += tubD;
        if (wCount >= 3) perim += tubD;
        deductSF += (perim * sHeight) / 144;
      }
      // Deduct shower wall area
      const showerFix = fixtures.find(f => f.type === 'shower');
      if (showerFix) {
        const sWalls = showerFix.properties.showerWallCount ?? 3;
        const sTileH = showerFix.properties.showerTileHeight ?? 96;
        const sW = showerFix.dimensions.width;
        const sD = showerFix.dimensions.height;
        let perim = 0;
        if (sWalls >= 1) perim += sW;
        if (sWalls >= 2) perim += sD;
        if (sWalls >= 3) perim += sD;
        deductSF += (perim * sTileH) / 144;
      }
      fullPaintWallSF = Math.max(0, Math.round((bathroom.wallAreaSF - deductSF) * 10) / 10);
    }

    // Ceiling: use floor SF as ceiling area
    const fullPaintCeilSF = hasCeilDw && bathroom ? bathroom.floorAreaSF : 0;

    // Merge paint data into walls_spec
    const existingWallsSpec = sync.walls_spec ?? {};
    sync.walls_spec = {
      ...existingWallsSpec,
      paint_walls: hasWallDw,
      paint_ceiling: hasCeilDw,
      paint_grade: existingWallsSpec.paint_grade ?? 'mid',
      seal_prime_wall_sf: Math.round(wallDwSF * 10) / 10,
      seal_prime_ceiling_sf: Math.round(ceilDwSF * 10) / 10,
      full_paint_wall_sf: fullPaintWallSF,
      full_paint_ceiling_sf: Math.round(fullPaintCeilSF * 10) / 10,
    };
  }

  // ── Insulation zones → demo & install sync ──
  const insZones = data.insulationZones ?? [];
  if (insZones.length > 0) {
    const wallInsSF = insZones.filter(z => z.surface === 'wall').reduce((s, z) => s + z.areaSF, 0);
    const ceilInsSF = insZones.filter(z => z.surface === 'ceiling').reduce((s, z) => s + z.areaSF, 0);
    const demoWallInsSF = insZones.filter(z => z.surface === 'wall' && z.needsDemo).reduce((s, z) => s + z.areaSF, 0);
    const demoCeilInsSF = insZones.filter(z => z.surface === 'ceiling' && z.needsDemo).reduce((s, z) => s + z.areaSF, 0);

    // Demo flags
    if (demoWallInsSF > 0) {
      sync.demo_insulation_walls = true;
      sync.demo_insulation_walls_sf = Math.round(demoWallInsSF * 10) / 10;
    }
    if (demoCeilInsSF > 0) {
      sync.demo_insulation_ceiling = true;
      sync.demo_insulation_ceiling_sf = Math.round(demoCeilInsSF * 10) / 10;
    }

    // Install flags
    if (wallInsSF > 0) {
      sync.install_insulation_walls = true;
      sync.install_insulation_walls_sf = Math.round(wallInsSF * 10) / 10;
    }
    if (ceilInsSF > 0) {
      sync.install_insulation_ceiling = true;
      sync.install_insulation_ceiling_sf = Math.round(ceilInsSF * 10) / 10;
    }

    // Merge insulation info into walls_spec
    const existingWallsSpec = sync.walls_spec ?? {};
    const primaryType = insZones[0]?.insulationType ?? 'fiberglass_batt';
    const primaryRValue = insZones[0]?.rValue ?? 13;
    sync.walls_spec = {
      ...existingWallsSpec,
      insulation_walls: wallInsSF > 0,
      insulation_walls_sf: Math.round(wallInsSF * 10) / 10,
      insulation_ceiling: ceilInsSF > 0,
      insulation_ceiling_sf: Math.round(ceilInsSF * 10) / 10,
      insulation_type: primaryType,
      insulation_r_value: primaryRValue,
    };
  }

  return sync;
}

const BESketchTab: React.FC<BESketchTabProps> = ({
  estimateId,
  estimateData,
  onSketchChange,
  onFixtureSync,
  initialSketchData,
  isActive = false,
}) => {
  const api = useBESketchState();
  const lastLoadedRef = useRef<string | null>(null);

  // Load sketch_data when estimate data arrives or changes
  useEffect(() => {
    if (!initialSketchData) return;
    // Compare by a stable signature to avoid re-loading our own saves
    const sig = JSON.stringify({
      r: initialSketchData.rooms?.length ?? 0,
      f: initialSketchData.fixtures?.length ?? 0,
      w: initialSketchData.walls?.length ?? 0,
      v: initialSketchData.version,
    });
    if (sig !== lastLoadedRef.current) {
      lastLoadedRef.current = sig;
      api.loadSketch(initialSketchData);
    }
  }, [initialSketchData, api]);

  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const containerRef = useRef<HTMLDivElement>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [zoomLevel, setZoomLevel] = useState(1);
  const stageRef = useRef<any>(null); // Konva.Stage ref passed to canvas

  // ── Zoom controls ──
  const handleZoom = useCallback((direction: 'in' | 'out' | 'fit') => {
    const stage = stageRef.current;
    if (!stage) return;
    if (direction === 'fit') {
      stage.scale({ x: 1, y: 1 });
      stage.position({ x: 0, y: 0 });
      setZoomLevel(1);
    } else {
      const scaleBy = 1.25;
      const oldScale = stage.scaleX();
      const center = { x: canvasSize.width / 2, y: canvasSize.height / 2 };
      const mousePointTo = {
        x: (center.x - stage.x()) / oldScale,
        y: (center.y - stage.y()) / oldScale,
      };
      const newScale = direction === 'in'
        ? Math.min(5, oldScale * scaleBy)
        : Math.max(0.2, oldScale / scaleBy);
      stage.scale({ x: newScale, y: newScale });
      stage.position({
        x: center.x - mousePointTo.x * newScale,
        y: center.y - mousePointTo.y * newScale,
      });
      setZoomLevel(newScale);
    }
    stage.batchDraw();
  }, [canvasSize]);

  // ── Expose sketch capture for PDF export ──
  useEffect(() => {
    (window as any).__beSketchCapture = () => {
      const stage = stageRef.current;
      if (!stage) return undefined;
      const d = api.data;
      if (!d.rooms.length && !d.fixtures.length && !d.walls.length) return undefined;
      try {
        // Compute content bounding box from data
        const allX: number[] = [];
        const allY: number[] = [];
        const ppf = d.settings.pixelsPerFoot;
        d.rooms.forEach(r => r.boundary.forEach(p => { allX.push(p.x); allY.push(p.y); }));
        d.walls.forEach(w => { allX.push(w.start.x, w.end.x); allY.push(w.start.y, w.end.y); });
        d.fixtures.forEach(f => {
          const hw = (f.dimensions.width / 12) * ppf / 2;
          const hh = (f.dimensions.height / 12) * ppf / 2;
          allX.push(f.position.x - hw, f.position.x + hw);
          allY.push(f.position.y - hh, f.position.y + hh);
        });
        // Include tile zones and damage zones in bounding box
        (d.tileZones ?? []).forEach((z: any) => (z.boundary ?? []).forEach((p: any) => { allX.push(p.x); allY.push(p.y); }));
        (d.damageZones ?? []).forEach((z: any) => (z.boundary ?? []).forEach((p: any) => { allX.push(p.x); allY.push(p.y); }));
        if (!allX.length) return undefined;
        const pad = 40;
        const minX = Math.max(0, Math.min(...allX) - pad);
        const minY = Math.max(0, Math.min(...allY) - pad);
        const maxX = Math.max(...allX) + pad;
        const maxY = Math.max(...allY) + pad;
        const cropW = maxX - minX;
        const cropH = maxY - minY;

        // Save current state
        const oldScale = { x: stage.scaleX(), y: stage.scaleY() };
        const oldPos = { x: stage.x(), y: stage.y() };
        const oldW = stage.width();
        const oldH = stage.height();

        // Expand stage to cover all content
        const needW = Math.max(oldW, maxX + pad);
        const needH = Math.max(oldH, maxY + pad);
        stage.scale({ x: 1, y: 1 });
        stage.position({ x: 0, y: 0 });
        stage.width(needW);
        stage.height(needH);

        // Hide grid layer (first) and dimension labels layer (last)
        const layers = stage.getLayers();
        const hiddenLayers: any[] = [];
        layers.forEach((layer: any, idx: number) => {
          if (idx === 0 || idx === layers.length - 1) {
            if (layer.visible()) {
              layer.visible(false);
              hiddenLayers.push(layer);
            }
          }
        });
        const overlays = document.querySelectorAll<HTMLElement>('[data-sketch-overlay]');
        overlays.forEach(el => { el.style.display = 'none'; });

        // Synchronous full redraw at new size
        stage.draw();

        // Capture content region
        const dataUrl = stage.toDataURL({
          pixelRatio: 2,
          x: minX,
          y: minY,
          width: cropW,
          height: cropH,
        });
        console.log('[SketchCapture]', { minX, minY, cropW, cropH, needW, needH, oldW, oldH });

        // Restore everything
        stage.width(oldW);
        stage.height(oldH);
        stage.scale(oldScale);
        stage.position(oldPos);
        hiddenLayers.forEach(l => l.visible(true));
        overlays.forEach(el => { el.style.display = ''; });
        stage.draw();
        return dataUrl.replace(/^data:image\/png;base64,/, '');
      } catch (e) {
        return undefined;
      }
    };
    return () => { delete (window as any).__beSketchCapture; };
  }, [api.data]);

  // ── Resize observer ──
  useEffect(() => {
    if (!containerRef.current || !isActive) return;

    const updateSize = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const sidebarW = isMobile ? 0 : (sidebarCollapsed ? 0 : 260);
      setCanvasSize({
        width: Math.max(200, rect.width - sidebarW - 2),
        height: Math.max(200, rect.height - 2),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [isActive, sidebarCollapsed, isMobile]);

  // ── Notify parent on changes ──
  useEffect(() => {
    if (api.isDirty && onSketchChange) {
      onSketchChange(api.data);
    }
  }, [api.data, api.isDirty, onSketchChange]);

  // ── Sync sketch (rooms + fixtures) → estimate form fields ──
  const initialSyncDone = useRef(false);
  useEffect(() => {
    if (!onFixtureSync) return;
    // On edit: sync when sketch is dirty (user changed something)
    // On load: sync once when sketch has fixtures (e.g. saved from another env)
    if (api.isDirty) {
      const sync = buildSketchSync(api.data);
      onFixtureSync(sync);
    } else if (!initialSyncDone.current && api.data.fixtures.length > 0) {
      initialSyncDone.current = true;
      const sync = buildSketchSync(api.data);
      onFixtureSync(sync);
    }
  }, [api.data.fixtures, api.data.rooms, api.isDirty, onFixtureSync]);

  // ── Save handler ──
  const handleSave = useCallback(async () => {
    try {
      await bathroomEstimateService.update(estimateId, {
        sketch_data: api.data as any,
      });
      api.setIsDirty(false);
      message.success('Sketch saved');
    } catch (err) {
      message.error('Failed to save sketch');
      console.error('Sketch save error:', err);
    }
  }, [api, estimateId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 300 }}>
      {/* Top bar: Toolbar + Save */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0, borderBottom: '1px solid #e8e8e8',
        minWidth: 0,
      }}>
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <BESketchToolbar
            api={api}
            onZoomIn={() => handleZoom('in')}
            onZoomOut={() => handleZoom('out')}
            onZoomFit={() => handleZoom('fit')}
            zoomLevel={zoomLevel}
            canvasSize={canvasSize}
          />
        </div>
        <Space size={4} style={{ padding: '4px 8px', flexShrink: 0 }}>
          {api.isDirty && <Text type="warning" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>*</Text>}
          <Tooltip title="Save sketch (Ctrl+S)">
            <Button
              size="small"
              icon={<SaveOutlined />}
              type={api.isDirty ? 'primary' : 'default'}
              onClick={handleSave}
            />
          </Tooltip>
          {isMobile ? (
            <Tooltip title="Show panels">
              <Button
                size="small"
                icon={<MenuUnfoldOutlined />}
                onClick={() => setDrawerOpen(true)}
              />
            </Tooltip>
          ) : (
            <Tooltip title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}>
              <Button
                size="small"
                icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              />
            </Tooltip>
          )}
        </Space>
      </div>

      {/* Main area: Canvas + Sidebar */}
      <div
        ref={containerRef}
        style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative', minHeight: 0 }}
      >
        <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
          <BESketchCanvas api={api} width={canvasSize.width} height={canvasSize.height} stageRef={stageRef} onZoomChange={setZoomLevel} />
        </div>

        {/* Desktop: inline sidebar */}
        {!isMobile && !sidebarCollapsed && (
          <BESketchSidebar api={api} width={260} />
        )}
      </div>

      {/* Mobile: Drawer sidebar */}
      {isMobile && (
        <Drawer
          title="Sketch Panels"
          placement="bottom"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          height="70vh"
          styles={{ body: { padding: 0 } }}
        >
          <BESketchSidebar api={api} width="100%" />
        </Drawer>
      )}

      {/* Status bar (compact) */}
      <div
        style={{
          padding: '2px 8px',
          borderTop: '1px solid #e8e8e8',
          backgroundColor: '#fafafa',
          fontSize: 10,
          display: 'flex',
          gap: 12,
          color: '#888',
          flexShrink: 0,
        }}
      >
        <span><strong style={{ textTransform: 'capitalize' }}>{api.activeTool.replace('_', ' ')}</strong></span>
        <span>W:{api.data.walls.length}</span>
        <span>R:{api.data.rooms.length}</span>
        <span>F:{api.data.fixtures.length}</span>
        {(api.data.drywallRepairZones ?? []).length > 0 && (
          <span style={{ color: '#d46b08' }}>DW:{api.data.drywallRepairZones.length}</span>
        )}
        {(api.data.insulationZones ?? []).length > 0 && (
          <span style={{ color: '#ad1457' }}>INS:{api.data.insulationZones.length}</span>
        )}
        {!isMobile && <span>Scale: {api.data.settings.pixelsPerFoot} px/ft</span>}
        {api.selectedId && !isMobile && <span>Selected: {api.selectedId.slice(0, 15)}</span>}
      </div>
    </div>
  );
};

export default BESketchTab;
