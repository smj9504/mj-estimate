/**
 * Cabinet Estimate Sketch types.
 *
 * A small, cabinet-specific analog of types/wmSketch.ts — walls + placed
 * cabinet shapes only. No demolition/equipment/containment/room concepts;
 * a cabinet "room" is just whatever the drawn walls visually enclose.
 */

import type { CabType } from './cabinetEstimate';

export interface CabinetSketchWall {
  id: string;
  start_x: number;
  start_y: number;
  end_x: number;
  end_y: number;
  thickness: number;
  color: string;
  length_ft: number;
}

export interface CabinetSketchCabinet {
  id: string;
  /** Catalog code, e.g. "B30" — matches CABINET_PRESETS keys in CabinetBoxEditor.tsx */
  preset_code: string;
  cab_type: CabType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  label: string;
}

export interface CabinetSketchOverlayData {
  walls: CabinetSketchWall[];
  cabinets: CabinetSketchCabinet[];
  element_order: string[];
}

export interface CabinetSketch {
  id: string;
  estimate_id: string;
  canvas_width: number;
  canvas_height: number;
  scale_pixels_per_foot: number;
  overlay_data: CabinetSketchOverlayData;
}

export interface CabinetSketchUpdate {
  canvas_width?: number;
  canvas_height?: number;
  scale_pixels_per_foot?: number;
}

export const EMPTY_CABINET_OVERLAY_DATA: CabinetSketchOverlayData = {
  walls: [],
  cabinets: [],
  element_order: [],
};

/** Snap threshold in canvas pixels for wall endpoint snapping */
export const WALL_SNAP_THRESHOLD = 15;
export const DEFAULT_WALL_THICKNESS = 4;
export const DEFAULT_WALL_COLOR = '#333333';

export type CabinetSketchTool = 'select' | 'wall' | 'place_cabinet' | 'pan';

export interface CabinetSketchSelection {
  element_id: string;
  element_type: 'wall' | 'cabinet';
}
