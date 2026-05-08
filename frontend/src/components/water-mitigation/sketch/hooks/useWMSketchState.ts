/**
 * useWMSketchState
 *
 * useReducer-based state management for the WM sketch canvas overlay data.
 * Provides undo/redo (up to 50 entries), dirty-tracking, and named dispatch
 * helpers so consumers never call raw dispatch.
 */

import { useReducer, useCallback, useMemo } from 'react';
import type {
  WMOverlayData,
  WMDemolitionZone,
  WMEquipmentPlacement,
  WMContainmentZone,
  WMFloorProtection,
  WMContentProtection,
  WMTextAnnotation,
  WMShapeAnnotation,
  WMWall,
  WMRoom,
  WMSketchTool,
  WMSketchSelection,
  EquipmentType,
} from '../../../../types/wmSketch';
import { EMPTY_OVERLAY_DATA } from '../../../../types/wmSketch';

// ============================================================================
// Constants
// ============================================================================

const MAX_UNDO_STACK = 50;

// ============================================================================
// State Shape
// ============================================================================

export interface WMSketchLocalState {
  overlayData: WMOverlayData;
  activeTool: WMSketchTool;
  /** Currently selected elements (supports multi-select via Ctrl+click) */
  selections: WMSketchSelection[];
  /** @deprecated Use selections instead — kept as getter for single-select compat */
  selection: WMSketchSelection | null;
  /** ID of the DemoMaterialType currently active in the demolition tool */
  activeMaterialTypeId: string | null;
  /** Equipment type currently active in the equipment placement tool */
  activeEquipmentType: EquipmentType | null;
  /** True when overlayData has unsaved changes */
  isDirty: boolean;
  undoStack: WMOverlayData[];
  redoStack: WMOverlayData[];
}

// ============================================================================
// Action Types
// ============================================================================

type WMSketchAction =
  // Tool & selection
  | { type: 'SET_TOOL'; payload: WMSketchTool }
  | { type: 'SELECT_ELEMENT'; payload: WMSketchSelection }
  | { type: 'TOGGLE_SELECT_ELEMENT'; payload: WMSketchSelection }
  | { type: 'DESELECT' }
  | { type: 'SET_ACTIVE_MATERIAL_TYPE'; payload: string | null }
  | { type: 'SET_ACTIVE_EQUIPMENT_TYPE'; payload: EquipmentType | null }

  // Demolition zones
  | { type: 'ADD_DEMOLITION_ZONE'; payload: WMDemolitionZone }
  | { type: 'UPDATE_DEMOLITION_ZONE'; payload: Partial<WMDemolitionZone> & { id: string } }
  | { type: 'REMOVE_DEMOLITION_ZONE'; payload: string }
  | { type: 'COMBINE_DEMOLITION_ZONES'; payload: { removeIds: string[]; addZone: WMDemolitionZone } }
  | { type: 'UNGROUP_DEMOLITION_ZONE'; payload: { removeId: string; addZones: WMDemolitionZone[] } }

  // Equipment placements
  | { type: 'ADD_EQUIPMENT'; payload: WMEquipmentPlacement }
  | { type: 'UPDATE_EQUIPMENT'; payload: Partial<WMEquipmentPlacement> & { id: string } }
  | { type: 'REMOVE_EQUIPMENT'; payload: string }

  // Containment zones
  | { type: 'ADD_CONTAINMENT'; payload: WMContainmentZone }
  | { type: 'UPDATE_CONTAINMENT'; payload: Partial<WMContainmentZone> & { id: string } }
  | { type: 'REMOVE_CONTAINMENT'; payload: string }

  // Floor protection
  | { type: 'ADD_FLOOR_PROTECTION'; payload: WMFloorProtection }
  | { type: 'UPDATE_FLOOR_PROTECTION'; payload: Partial<WMFloorProtection> & { id: string } }
  | { type: 'REMOVE_FLOOR_PROTECTION'; payload: string }

  // Content protection
  | { type: 'ADD_CONTENT_PROTECTION'; payload: WMContentProtection }
  | { type: 'UPDATE_CONTENT_PROTECTION'; payload: Partial<WMContentProtection> & { id: string } }
  | { type: 'REMOVE_CONTENT_PROTECTION'; payload: string }

  // Text annotations
  | { type: 'ADD_TEXT_ANNOTATION'; payload: WMTextAnnotation }
  | { type: 'UPDATE_TEXT_ANNOTATION'; payload: Partial<WMTextAnnotation> & { id: string } }
  | { type: 'REMOVE_TEXT_ANNOTATION'; payload: string }

  // Shape annotations
  | { type: 'ADD_SHAPE'; payload: WMShapeAnnotation }
  | { type: 'UPDATE_SHAPE'; payload: Partial<WMShapeAnnotation> & { id: string } }
  | { type: 'REMOVE_SHAPE'; payload: string }

  // Walls
  | { type: 'ADD_WALL'; payload: WMWall }
  | { type: 'UPDATE_WALL'; payload: Partial<WMWall> & { id: string } }
  | { type: 'REMOVE_WALL'; payload: string }

  // Rooms
  | { type: 'ADD_ROOM'; payload: WMRoom }
  | { type: 'UPDATE_ROOM'; payload: Partial<WMRoom> & { id: string } }
  | { type: 'REMOVE_ROOM'; payload: string }

  // Batch operations
  | { type: 'BATCH_MOVE_SELECTED'; payload: { draggedId: string; newX: number; newY: number } }

  // Z-order
  | { type: 'BRING_TO_FRONT'; payload: string }
  | { type: 'SEND_TO_BACK'; payload: string }
  | { type: 'BRING_FORWARD'; payload: string }
  | { type: 'SEND_BACKWARD'; payload: string }

  // Persistence
  | { type: 'LOAD_OVERLAY_DATA'; payload: WMOverlayData }
  | { type: 'MARK_SAVED' }

  // Undo / redo
  | { type: 'UNDO' }
  | { type: 'REDO' };

// ============================================================================
// Helpers
// ============================================================================

/**
 * Clone and push current overlayData onto the undoStack, clear redoStack.
 * Returns the updated stacks ready to be spread into the next state.
 */
function pushUndo(
  state: WMSketchLocalState
): Pick<WMSketchLocalState, 'undoStack' | 'redoStack'> {
  const next = [state.overlayData, ...state.undoStack].slice(0, MAX_UNDO_STACK);
  return { undoStack: next, redoStack: [] };
}

/**
 * Build the default element_order array from overlay data (type-based z-order).
 * Used when element_order is absent (legacy data).
 */
function buildDefaultOrder(data: WMOverlayData): string[] {
  return [
    ...data.floor_protections.map((e) => e.id),
    ...(data.content_protections ?? []).map((e) => e.id),
    ...data.containment_zones.map((e) => e.id),
    ...data.demolition_zones.map((e) => e.id),
    ...data.equipment_placements.map((e) => e.id),
    ...(data.shapes ?? []).map((e) => e.id),
    ...(data.text_annotations ?? []).map((e) => e.id),
  ];
}

/** Ensure element_order exists and contains the given id */
function ensureOrder(data: WMOverlayData): string[] {
  return data.element_order ?? buildDefaultOrder(data);
}

/** Generic in-place update for an array of overlay elements by id */
function updateById<T extends { id: string }>(
  items: T[],
  patch: Partial<T> & { id: string }
): T[] {
  return items.map((item) =>
    item.id === patch.id ? { ...item, ...patch } : item
  );
}

// ============================================================================
// Reducer
// ============================================================================

function wmSketchReducer(
  state: WMSketchLocalState,
  action: WMSketchAction
): WMSketchLocalState {
  switch (action.type) {
    // ------------------------------------------------------------------
    // Tool & selection — no overlay mutation, no dirty/undo changes
    // ------------------------------------------------------------------
    case 'SET_TOOL':
      return { ...state, activeTool: action.payload };

    case 'SELECT_ELEMENT': {
      const newSelections = [action.payload];
      return { ...state, selections: newSelections, selection: action.payload };
    }

    case 'TOGGLE_SELECT_ELEMENT': {
      const exists = state.selections.some(
        (s) => s.element_id === action.payload.element_id
      );
      const newSelections = exists
        ? state.selections.filter((s) => s.element_id !== action.payload.element_id)
        : [...state.selections, action.payload];
      return {
        ...state,
        selections: newSelections,
        selection: newSelections.length > 0 ? newSelections[newSelections.length - 1] : null,
      };
    }

    case 'DESELECT':
      return { ...state, selections: [], selection: null };

    case 'SET_ACTIVE_MATERIAL_TYPE':
      return { ...state, activeMaterialTypeId: action.payload };

    case 'SET_ACTIVE_EQUIPMENT_TYPE':
      return { ...state, activeEquipmentType: action.payload };

    // ------------------------------------------------------------------
    // Demolition zones
    // ------------------------------------------------------------------
    case 'ADD_DEMOLITION_ZONE': {
      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: {
          ...state.overlayData,
          demolition_zones: [...state.overlayData.demolition_zones, action.payload],
        },
      };
    }

    case 'UPDATE_DEMOLITION_ZONE': {
      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: {
          ...state.overlayData,
          demolition_zones: updateById(state.overlayData.demolition_zones, action.payload),
        },
      };
    }

    case 'REMOVE_DEMOLITION_ZONE': {
      const { undoStack, redoStack } = pushUndo(state);
      const newSelections = state.selections.filter((s) => s.element_id !== action.payload);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        selections: newSelections,
        selection: newSelections.length > 0 ? newSelections[newSelections.length - 1] : null,
        overlayData: {
          ...state.overlayData,
          demolition_zones: state.overlayData.demolition_zones.filter(
            (z) => z.id !== action.payload
          ),
        },
      };
    }

    case 'COMBINE_DEMOLITION_ZONES': {
      const { undoStack, redoStack } = pushUndo(state);
      const removeSet = new Set(action.payload.removeIds);
      const remaining = state.overlayData.demolition_zones.filter(
        (z) => !removeSet.has(z.id)
      );
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        selections: [],
        selection: null,
        overlayData: {
          ...state.overlayData,
          demolition_zones: [...remaining, action.payload.addZone],
        },
      };
    }

    case 'UNGROUP_DEMOLITION_ZONE': {
      const { undoStack, redoStack } = pushUndo(state);
      const remaining = state.overlayData.demolition_zones.filter(
        (z) => z.id !== action.payload.removeId
      );
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        selections: [],
        selection: null,
        overlayData: {
          ...state.overlayData,
          demolition_zones: [...remaining, ...action.payload.addZones],
        },
      };
    }

    // ------------------------------------------------------------------
    // Equipment placements
    // ------------------------------------------------------------------
    case 'ADD_EQUIPMENT': {
      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: {
          ...state.overlayData,
          equipment_placements: [
            ...state.overlayData.equipment_placements,
            action.payload,
          ],
        },
      };
    }

    case 'UPDATE_EQUIPMENT': {
      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: {
          ...state.overlayData,
          equipment_placements: updateById(
            state.overlayData.equipment_placements,
            action.payload
          ),
        },
      };
    }

    case 'REMOVE_EQUIPMENT': {
      const { undoStack, redoStack } = pushUndo(state);
      const newSelections = state.selections.filter((s) => s.element_id !== action.payload);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        selections: newSelections,
        selection: newSelections.length > 0 ? newSelections[newSelections.length - 1] : null,
        overlayData: {
          ...state.overlayData,
          equipment_placements: state.overlayData.equipment_placements.filter(
            (e) => e.id !== action.payload
          ),
        },
      };
    }

    // ------------------------------------------------------------------
    // Containment zones
    // ------------------------------------------------------------------
    case 'ADD_CONTAINMENT': {
      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: {
          ...state.overlayData,
          containment_zones: [
            ...state.overlayData.containment_zones,
            action.payload,
          ],
        },
      };
    }

    case 'UPDATE_CONTAINMENT': {
      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: {
          ...state.overlayData,
          containment_zones: updateById(
            state.overlayData.containment_zones,
            action.payload
          ),
        },
      };
    }

    case 'REMOVE_CONTAINMENT': {
      const { undoStack, redoStack } = pushUndo(state);
      const newSelections = state.selections.filter((s) => s.element_id !== action.payload);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        selections: newSelections,
        selection: newSelections.length > 0 ? newSelections[newSelections.length - 1] : null,
        overlayData: {
          ...state.overlayData,
          containment_zones: state.overlayData.containment_zones.filter(
            (c) => c.id !== action.payload
          ),
        },
      };
    }

    // ------------------------------------------------------------------
    // Floor protection strips
    // ------------------------------------------------------------------
    case 'ADD_FLOOR_PROTECTION': {
      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: {
          ...state.overlayData,
          floor_protections: [
            ...state.overlayData.floor_protections,
            action.payload,
          ],
        },
      };
    }

    case 'UPDATE_FLOOR_PROTECTION': {
      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: {
          ...state.overlayData,
          floor_protections: updateById(
            state.overlayData.floor_protections,
            action.payload
          ),
        },
      };
    }

    case 'REMOVE_FLOOR_PROTECTION': {
      const { undoStack, redoStack } = pushUndo(state);
      const newSelections = state.selections.filter((s) => s.element_id !== action.payload);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        selections: newSelections,
        selection: newSelections.length > 0 ? newSelections[newSelections.length - 1] : null,
        overlayData: {
          ...state.overlayData,
          floor_protections: state.overlayData.floor_protections.filter(
            (fp) => fp.id !== action.payload
          ),
        },
      };
    }

    // ------------------------------------------------------------------
    // Content protection
    // ------------------------------------------------------------------
    case 'ADD_CONTENT_PROTECTION': {
      const { undoStack, redoStack } = pushUndo(state);
      const existing = state.overlayData.content_protections ?? [];
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: {
          ...state.overlayData,
          content_protections: [...existing, action.payload],
        },
      };
    }

    case 'UPDATE_CONTENT_PROTECTION': {
      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: {
          ...state.overlayData,
          content_protections: updateById(
            state.overlayData.content_protections ?? [],
            action.payload
          ),
        },
      };
    }

    case 'REMOVE_CONTENT_PROTECTION': {
      const { undoStack, redoStack } = pushUndo(state);
      const newSelections = state.selections.filter((s) => s.element_id !== action.payload);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        selections: newSelections,
        selection: newSelections.length > 0 ? newSelections[newSelections.length - 1] : null,
        overlayData: {
          ...state.overlayData,
          content_protections: (state.overlayData.content_protections ?? []).filter(
            (cp) => cp.id !== action.payload
          ),
        },
      };
    }

    // ------------------------------------------------------------------
    // Text annotations
    // ------------------------------------------------------------------
    case 'ADD_TEXT_ANNOTATION': {
      const { undoStack, redoStack } = pushUndo(state);
      const existing = state.overlayData.text_annotations ?? [];
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: {
          ...state.overlayData,
          text_annotations: [...existing, action.payload],
        },
      };
    }

    case 'UPDATE_TEXT_ANNOTATION': {
      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: {
          ...state.overlayData,
          text_annotations: updateById(
            state.overlayData.text_annotations ?? [],
            action.payload
          ),
        },
      };
    }

    case 'REMOVE_TEXT_ANNOTATION': {
      const { undoStack, redoStack } = pushUndo(state);
      const newSelections = state.selections.filter((s) => s.element_id !== action.payload);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        selections: newSelections,
        selection: newSelections.length > 0 ? newSelections[newSelections.length - 1] : null,
        overlayData: {
          ...state.overlayData,
          text_annotations: (state.overlayData.text_annotations ?? []).filter(
            (t) => t.id !== action.payload
          ),
        },
      };
    }

    // ------------------------------------------------------------------
    // Shape annotations
    // ------------------------------------------------------------------
    case 'ADD_SHAPE': {
      const { undoStack, redoStack } = pushUndo(state);
      const existing = state.overlayData.shapes ?? [];
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: {
          ...state.overlayData,
          shapes: [...existing, action.payload],
        },
      };
    }

    case 'UPDATE_SHAPE': {
      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: {
          ...state.overlayData,
          shapes: updateById(state.overlayData.shapes ?? [], action.payload),
        },
      };
    }

    case 'REMOVE_SHAPE': {
      const { undoStack, redoStack } = pushUndo(state);
      const newSelections = state.selections.filter((s) => s.element_id !== action.payload);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        selections: newSelections,
        selection: newSelections.length > 0 ? newSelections[newSelections.length - 1] : null,
        overlayData: {
          ...state.overlayData,
          shapes: (state.overlayData.shapes ?? []).filter((s) => s.id !== action.payload),
        },
      };
    }

    // ------------------------------------------------------------------
    // Walls
    // ------------------------------------------------------------------
    case 'ADD_WALL': {
      const { undoStack, redoStack } = pushUndo(state);
      const existing = state.overlayData.walls ?? [];
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: { ...state.overlayData, walls: [...existing, action.payload] },
      };
    }

    case 'UPDATE_WALL': {
      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: {
          ...state.overlayData,
          walls: updateById(state.overlayData.walls ?? [], action.payload),
        },
      };
    }

    case 'REMOVE_WALL': {
      const { undoStack, redoStack } = pushUndo(state);
      const newSelections = state.selections.filter((s) => s.element_id !== action.payload);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        selections: newSelections,
        selection: newSelections.length > 0 ? newSelections[newSelections.length - 1] : null,
        overlayData: {
          ...state.overlayData,
          walls: (state.overlayData.walls ?? []).filter((w) => w.id !== action.payload),
        },
      };
    }

    // ------------------------------------------------------------------
    // Rooms
    // ------------------------------------------------------------------
    case 'ADD_ROOM': {
      const { undoStack, redoStack } = pushUndo(state);
      const existing = state.overlayData.rooms ?? [];
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: { ...state.overlayData, rooms: [...existing, action.payload] },
      };
    }

    case 'UPDATE_ROOM': {
      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: {
          ...state.overlayData,
          rooms: updateById(state.overlayData.rooms ?? [], action.payload),
        },
      };
    }

    case 'REMOVE_ROOM': {
      const { undoStack, redoStack } = pushUndo(state);
      const newSelections = state.selections.filter((s) => s.element_id !== action.payload);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        selections: newSelections,
        selection: newSelections.length > 0 ? newSelections[newSelections.length - 1] : null,
        overlayData: {
          ...state.overlayData,
          rooms: (state.overlayData.rooms ?? []).filter((r) => r.id !== action.payload),
        },
      };
    }

    // ------------------------------------------------------------------
    // Batch move all selected elements (single undo entry)
    // ------------------------------------------------------------------
    case 'BATCH_MOVE_SELECTED': {
      const { draggedId, newX, newY } = action.payload;
      const selectedIdSet = new Set(state.selections.map((s) => s.element_id));

      // Find the dragged element's old position to compute the delta
      let oldX = 0;
      let oldY = 0;
      const allElements = [
        ...state.overlayData.demolition_zones,
        ...state.overlayData.equipment_placements,
        ...state.overlayData.containment_zones,
        ...state.overlayData.floor_protections,
        ...(state.overlayData.content_protections ?? []),
        ...(state.overlayData.text_annotations ?? []),
        ...(state.overlayData.shapes ?? []),
      ];
      const draggedEl = allElements.find((el) => el.id === draggedId);
      if (draggedEl) {
        oldX = draggedEl.x;
        oldY = draggedEl.y;
      }
      const dx = newX - oldX;
      const dy = newY - oldY;

      const moveIfSelected = <T extends { id: string; x: number; y: number }>(
        items: T[],
      ): T[] =>
        items.map((item) =>
          selectedIdSet.has(item.id)
            ? { ...item, x: item.x + dx, y: item.y + dy }
            : item,
        );

      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: {
          ...state.overlayData,
          demolition_zones: moveIfSelected(state.overlayData.demolition_zones),
          equipment_placements: moveIfSelected(state.overlayData.equipment_placements),
          containment_zones: moveIfSelected(state.overlayData.containment_zones),
          floor_protections: moveIfSelected(state.overlayData.floor_protections),
          content_protections: moveIfSelected(state.overlayData.content_protections ?? []),
          text_annotations: moveIfSelected(state.overlayData.text_annotations ?? []),
          shapes: moveIfSelected(state.overlayData.shapes ?? []),
        },
      };
    }

    // ------------------------------------------------------------------
    // Z-order
    // ------------------------------------------------------------------
    case 'BRING_TO_FRONT': {
      const { undoStack, redoStack } = pushUndo(state);
      const order = ensureOrder(state.overlayData).filter((id) => id !== action.payload);
      order.push(action.payload);
      return {
        ...state, undoStack, redoStack, isDirty: true,
        overlayData: { ...state.overlayData, element_order: order },
      };
    }
    case 'SEND_TO_BACK': {
      const { undoStack, redoStack } = pushUndo(state);
      const order = ensureOrder(state.overlayData).filter((id) => id !== action.payload);
      order.unshift(action.payload);
      return {
        ...state, undoStack, redoStack, isDirty: true,
        overlayData: { ...state.overlayData, element_order: order },
      };
    }
    case 'BRING_FORWARD': {
      const { undoStack, redoStack } = pushUndo(state);
      const order = [...ensureOrder(state.overlayData)];
      const idx = order.indexOf(action.payload);
      if (idx >= 0 && idx < order.length - 1) {
        [order[idx], order[idx + 1]] = [order[idx + 1], order[idx]];
      }
      return {
        ...state, undoStack, redoStack, isDirty: true,
        overlayData: { ...state.overlayData, element_order: order },
      };
    }
    case 'SEND_BACKWARD': {
      const { undoStack, redoStack } = pushUndo(state);
      const order = [...ensureOrder(state.overlayData)];
      const idx = order.indexOf(action.payload);
      if (idx > 0) {
        [order[idx], order[idx - 1]] = [order[idx - 1], order[idx]];
      }
      return {
        ...state, undoStack, redoStack, isDirty: true,
        overlayData: { ...state.overlayData, element_order: order },
      };
    }

    // ------------------------------------------------------------------
    // Persistence
    // ------------------------------------------------------------------
    case 'LOAD_OVERLAY_DATA':
      // Full replace — reset undo/redo history and dirty flag.
      return {
        ...state,
        overlayData: action.payload,
        isDirty: false,
        undoStack: [],
        redoStack: [],
        selections: [],
        selection: null,
      };

    case 'MARK_SAVED':
      return { ...state, isDirty: false };

    // ------------------------------------------------------------------
    // Undo / Redo
    // ------------------------------------------------------------------
    case 'UNDO': {
      if (state.undoStack.length === 0) return state;

      const [previous, ...remainingUndo] = state.undoStack;
      return {
        ...state,
        overlayData: previous,
        undoStack: remainingUndo,
        redoStack: [state.overlayData, ...state.redoStack],
        isDirty: true,
        selections: [],
        selection: null,
      };
    }

    case 'REDO': {
      if (state.redoStack.length === 0) return state;

      const [next, ...remainingRedo] = state.redoStack;
      return {
        ...state,
        overlayData: next,
        redoStack: remainingRedo,
        undoStack: [state.overlayData, ...state.undoStack],
        isDirty: true,
        selections: [],
        selection: null,
      };
    }

    default:
      return state;
  }
}

// ============================================================================
// Initial State Factory
// ============================================================================

function createInitialState(
  initialOverlay: WMOverlayData = EMPTY_OVERLAY_DATA
): WMSketchLocalState {
  return {
    overlayData: initialOverlay,
    activeTool: 'select',
    selections: [],
    selection: null,
    activeMaterialTypeId: null,
    activeEquipmentType: null,
    isDirty: false,
    undoStack: [],
    redoStack: [],
  };
}

// ============================================================================
// Hook Return Type
// ============================================================================

export interface WMSketchStateReturn {
  state: WMSketchLocalState;

  // Tool & selection
  setTool: (tool: WMSketchTool) => void;
  selectElement: (selection: WMSketchSelection) => void;
  toggleSelectElement: (selection: WMSketchSelection) => void;
  deselect: () => void;
  /** Set of currently selected element IDs (for O(1) lookup) */
  selectedIds: Set<string>;
  /** Move all selected elements by the delta computed from dragged element */
  batchMoveSelected: (draggedId: string, newX: number, newY: number) => void;
  setActiveMaterialType: (id: string | null) => void;
  setActiveEquipmentType: (type: EquipmentType | null) => void;

  // Demolition zones
  addDemolitionZone: (zone: WMDemolitionZone) => void;
  updateDemolitionZone: (patch: Partial<WMDemolitionZone> & { id: string }) => void;
  removeDemolitionZone: (id: string) => void;
  combineDemolitionZones: (removeIds: string[], addZone: WMDemolitionZone) => void;
  ungroupDemolitionZone: (removeId: string, addZones: WMDemolitionZone[]) => void;

  // Equipment
  addEquipment: (placement: WMEquipmentPlacement) => void;
  updateEquipment: (patch: Partial<WMEquipmentPlacement> & { id: string }) => void;
  removeEquipment: (id: string) => void;

  // Containment
  addContainment: (zone: WMContainmentZone) => void;
  updateContainment: (patch: Partial<WMContainmentZone> & { id: string }) => void;
  removeContainment: (id: string) => void;

  // Floor protection
  addFloorProtection: (fp: WMFloorProtection) => void;
  updateFloorProtection: (patch: Partial<WMFloorProtection> & { id: string }) => void;
  removeFloorProtection: (id: string) => void;

  // Content protection
  addContentProtection: (cp: WMContentProtection) => void;
  updateContentProtection: (patch: Partial<WMContentProtection> & { id: string }) => void;
  removeContentProtection: (id: string) => void;

  // Text annotations
  addTextAnnotation: (annotation: WMTextAnnotation) => void;
  updateTextAnnotation: (patch: Partial<WMTextAnnotation> & { id: string }) => void;
  removeTextAnnotation: (id: string) => void;

  // Shape annotations
  addShape: (shape: WMShapeAnnotation) => void;
  updateShape: (patch: Partial<WMShapeAnnotation> & { id: string }) => void;
  removeShape: (id: string) => void;

  // Walls
  addWall: (wall: WMWall) => void;
  updateWall: (patch: Partial<WMWall> & { id: string }) => void;
  removeWall: (id: string) => void;

  // Rooms
  addRoom: (room: WMRoom) => void;
  updateRoom: (patch: Partial<WMRoom> & { id: string }) => void;
  removeRoom: (id: string) => void;

  // Z-order
  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;
  bringForward: (id: string) => void;
  sendBackward: (id: string) => void;

  // Persistence
  loadOverlayData: (data: WMOverlayData) => void;
  markSaved: () => void;

  // Undo / redo
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * useWMSketchState
 *
 * Manages all mutable canvas state for a single WM floor sketch:
 * overlay data, active tool, selection, undo/redo history, and dirty flag.
 *
 * @param initialOverlay - Optional overlay data to seed the state on first render.
 *                         Pass the loaded server response here when editing an
 *                         existing floor sketch.
 */
export function useWMSketchState(
  initialOverlay: WMOverlayData = EMPTY_OVERLAY_DATA
): WMSketchStateReturn {
  const [state, dispatch] = useReducer(
    wmSketchReducer,
    initialOverlay,
    createInitialState
  );

  // ------------------------------------------------------------------
  // Named dispatch helpers — stable references via useCallback
  // ------------------------------------------------------------------

  const setTool = useCallback(
    (tool: WMSketchTool) => dispatch({ type: 'SET_TOOL', payload: tool }),
    []
  );

  const selectElement = useCallback(
    (selection: WMSketchSelection) =>
      dispatch({ type: 'SELECT_ELEMENT', payload: selection }),
    []
  );

  const toggleSelectElement = useCallback(
    (selection: WMSketchSelection) =>
      dispatch({ type: 'TOGGLE_SELECT_ELEMENT', payload: selection }),
    []
  );

  const deselect = useCallback(() => dispatch({ type: 'DESELECT' }), []);

  const batchMoveSelected = useCallback(
    (draggedId: string, newX: number, newY: number) =>
      dispatch({ type: 'BATCH_MOVE_SELECTED', payload: { draggedId, newX, newY } }),
    []
  );

  const setActiveMaterialType = useCallback(
    (id: string | null) =>
      dispatch({ type: 'SET_ACTIVE_MATERIAL_TYPE', payload: id }),
    []
  );

  const setActiveEquipmentType = useCallback(
    (type: EquipmentType | null) =>
      dispatch({ type: 'SET_ACTIVE_EQUIPMENT_TYPE', payload: type }),
    []
  );

  // Demolition zones
  const addDemolitionZone = useCallback(
    (zone: WMDemolitionZone) =>
      dispatch({ type: 'ADD_DEMOLITION_ZONE', payload: zone }),
    []
  );

  const updateDemolitionZone = useCallback(
    (patch: Partial<WMDemolitionZone> & { id: string }) =>
      dispatch({ type: 'UPDATE_DEMOLITION_ZONE', payload: patch }),
    []
  );

  const removeDemolitionZone = useCallback(
    (id: string) => dispatch({ type: 'REMOVE_DEMOLITION_ZONE', payload: id }),
    []
  );

  const combineDemolitionZones = useCallback(
    (removeIds: string[], addZone: WMDemolitionZone) =>
      dispatch({ type: 'COMBINE_DEMOLITION_ZONES', payload: { removeIds, addZone } }),
    []
  );

  const ungroupDemolitionZone = useCallback(
    (removeId: string, addZones: WMDemolitionZone[]) =>
      dispatch({ type: 'UNGROUP_DEMOLITION_ZONE', payload: { removeId, addZones } }),
    []
  );

  // Equipment
  const addEquipment = useCallback(
    (placement: WMEquipmentPlacement) =>
      dispatch({ type: 'ADD_EQUIPMENT', payload: placement }),
    []
  );

  const updateEquipment = useCallback(
    (patch: Partial<WMEquipmentPlacement> & { id: string }) =>
      dispatch({ type: 'UPDATE_EQUIPMENT', payload: patch }),
    []
  );

  const removeEquipment = useCallback(
    (id: string) => dispatch({ type: 'REMOVE_EQUIPMENT', payload: id }),
    []
  );

  // Containment
  const addContainment = useCallback(
    (zone: WMContainmentZone) =>
      dispatch({ type: 'ADD_CONTAINMENT', payload: zone }),
    []
  );

  const updateContainment = useCallback(
    (patch: Partial<WMContainmentZone> & { id: string }) =>
      dispatch({ type: 'UPDATE_CONTAINMENT', payload: patch }),
    []
  );

  const removeContainment = useCallback(
    (id: string) => dispatch({ type: 'REMOVE_CONTAINMENT', payload: id }),
    []
  );

  // Floor protection
  const addFloorProtection = useCallback(
    (fp: WMFloorProtection) =>
      dispatch({ type: 'ADD_FLOOR_PROTECTION', payload: fp }),
    []
  );

  const updateFloorProtection = useCallback(
    (patch: Partial<WMFloorProtection> & { id: string }) =>
      dispatch({ type: 'UPDATE_FLOOR_PROTECTION', payload: patch }),
    []
  );

  const removeFloorProtection = useCallback(
    (id: string) => dispatch({ type: 'REMOVE_FLOOR_PROTECTION', payload: id }),
    []
  );

  // Content protection
  const addContentProtection = useCallback(
    (cp: WMContentProtection) =>
      dispatch({ type: 'ADD_CONTENT_PROTECTION', payload: cp }),
    []
  );

  const updateContentProtection = useCallback(
    (patch: Partial<WMContentProtection> & { id: string }) =>
      dispatch({ type: 'UPDATE_CONTENT_PROTECTION', payload: patch }),
    []
  );

  const removeContentProtection = useCallback(
    (id: string) => dispatch({ type: 'REMOVE_CONTENT_PROTECTION', payload: id }),
    []
  );

  // Text annotations
  const addTextAnnotation = useCallback(
    (annotation: WMTextAnnotation) =>
      dispatch({ type: 'ADD_TEXT_ANNOTATION', payload: annotation }),
    []
  );

  const updateTextAnnotation = useCallback(
    (patch: Partial<WMTextAnnotation> & { id: string }) =>
      dispatch({ type: 'UPDATE_TEXT_ANNOTATION', payload: patch }),
    []
  );

  const removeTextAnnotation = useCallback(
    (id: string) => dispatch({ type: 'REMOVE_TEXT_ANNOTATION', payload: id }),
    []
  );

  // Shape annotations
  const addShape = useCallback(
    (shape: WMShapeAnnotation) => dispatch({ type: 'ADD_SHAPE', payload: shape }),
    []
  );

  const updateShape = useCallback(
    (patch: Partial<WMShapeAnnotation> & { id: string }) =>
      dispatch({ type: 'UPDATE_SHAPE', payload: patch }),
    []
  );

  const removeShape = useCallback(
    (id: string) => dispatch({ type: 'REMOVE_SHAPE', payload: id }),
    []
  );

  // Walls
  const addWall = useCallback(
    (wall: WMWall) => dispatch({ type: 'ADD_WALL', payload: wall }),
    []
  );

  const updateWall = useCallback(
    (patch: Partial<WMWall> & { id: string }) =>
      dispatch({ type: 'UPDATE_WALL', payload: patch }),
    []
  );

  const removeWall = useCallback(
    (id: string) => dispatch({ type: 'REMOVE_WALL', payload: id }),
    []
  );

  // Rooms
  const addRoom = useCallback(
    (room: WMRoom) => dispatch({ type: 'ADD_ROOM', payload: room }),
    []
  );

  const updateRoom = useCallback(
    (patch: Partial<WMRoom> & { id: string }) =>
      dispatch({ type: 'UPDATE_ROOM', payload: patch }),
    []
  );

  const removeRoom = useCallback(
    (id: string) => dispatch({ type: 'REMOVE_ROOM', payload: id }),
    []
  );

  // Z-order
  const bringToFront = useCallback(
    (id: string) => dispatch({ type: 'BRING_TO_FRONT', payload: id }),
    []
  );
  const sendToBack = useCallback(
    (id: string) => dispatch({ type: 'SEND_TO_BACK', payload: id }),
    []
  );
  const bringForward = useCallback(
    (id: string) => dispatch({ type: 'BRING_FORWARD', payload: id }),
    []
  );
  const sendBackward = useCallback(
    (id: string) => dispatch({ type: 'SEND_BACKWARD', payload: id }),
    []
  );

  // Persistence
  const loadOverlayData = useCallback(
    (data: WMOverlayData) =>
      dispatch({ type: 'LOAD_OVERLAY_DATA', payload: data }),
    []
  );

  const markSaved = useCallback(() => dispatch({ type: 'MARK_SAVED' }), []);

  // Undo / redo
  const undo = useCallback(() => dispatch({ type: 'UNDO' }), []);
  const redo = useCallback(() => dispatch({ type: 'REDO' }), []);

  // Memoised set of selected element IDs for O(1) lookup in renderers
  const selectedIds = useMemo(
    () => new Set(state.selections.map((s) => s.element_id)),
    [state.selections]
  );

  return {
    state,
    setTool,
    selectElement,
    toggleSelectElement,
    deselect,
    selectedIds,
    batchMoveSelected,
    setActiveMaterialType,
    setActiveEquipmentType,
    addDemolitionZone,
    updateDemolitionZone,
    removeDemolitionZone,
    combineDemolitionZones,
    ungroupDemolitionZone,
    addEquipment,
    updateEquipment,
    removeEquipment,
    addContainment,
    updateContainment,
    removeContainment,
    addFloorProtection,
    updateFloorProtection,
    removeFloorProtection,
    addContentProtection,
    updateContentProtection,
    removeContentProtection,
    addTextAnnotation,
    updateTextAnnotation,
    removeTextAnnotation,
    addShape,
    updateShape,
    removeShape,
    addWall,
    updateWall,
    removeWall,
    addRoom,
    updateRoom,
    removeRoom,
    bringToFront,
    sendToBack,
    bringForward,
    sendBackward,
    loadOverlayData,
    markSaved,
    undo,
    redo,
    canUndo: state.undoStack.length > 0,
    canRedo: state.redoStack.length > 0,
  };
}
