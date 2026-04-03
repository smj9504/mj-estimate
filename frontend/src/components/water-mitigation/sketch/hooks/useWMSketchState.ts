/**
 * useWMSketchState
 *
 * useReducer-based state management for the WM sketch canvas overlay data.
 * Provides undo/redo (up to 50 entries), dirty-tracking, and named dispatch
 * helpers so consumers never call raw dispatch.
 */

import { useReducer, useCallback } from 'react';
import type {
  WMOverlayData,
  WMDemolitionZone,
  WMEquipmentPlacement,
  WMContainmentZone,
  WMFloorProtection,
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
  | { type: 'DESELECT' }
  | { type: 'SET_ACTIVE_MATERIAL_TYPE'; payload: string | null }
  | { type: 'SET_ACTIVE_EQUIPMENT_TYPE'; payload: EquipmentType | null }

  // Demolition zones
  | { type: 'ADD_DEMOLITION_ZONE'; payload: WMDemolitionZone }
  | { type: 'UPDATE_DEMOLITION_ZONE'; payload: Partial<WMDemolitionZone> & { id: string } }
  | { type: 'REMOVE_DEMOLITION_ZONE'; payload: string }

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

    case 'SELECT_ELEMENT':
      return { ...state, selection: action.payload };

    case 'DESELECT':
      return { ...state, selection: null };

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
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        selection:
          state.selection?.element_id === action.payload ? null : state.selection,
        overlayData: {
          ...state.overlayData,
          demolition_zones: state.overlayData.demolition_zones.filter(
            (z) => z.id !== action.payload
          ),
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
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        selection:
          state.selection?.element_id === action.payload ? null : state.selection,
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
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        selection:
          state.selection?.element_id === action.payload ? null : state.selection,
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
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        selection:
          state.selection?.element_id === action.payload ? null : state.selection,
        overlayData: {
          ...state.overlayData,
          floor_protections: state.overlayData.floor_protections.filter(
            (fp) => fp.id !== action.payload
          ),
        },
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
  deselect: () => void;
  setActiveMaterialType: (id: string | null) => void;
  setActiveEquipmentType: (type: EquipmentType | null) => void;

  // Demolition zones
  addDemolitionZone: (zone: WMDemolitionZone) => void;
  updateDemolitionZone: (patch: Partial<WMDemolitionZone> & { id: string }) => void;
  removeDemolitionZone: (id: string) => void;

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

  const deselect = useCallback(() => dispatch({ type: 'DESELECT' }), []);

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

  return {
    state,
    setTool,
    selectElement,
    deselect,
    setActiveMaterialType,
    setActiveEquipmentType,
    addDemolitionZone,
    updateDemolitionZone,
    removeDemolitionZone,
    addEquipment,
    updateEquipment,
    removeEquipment,
    addContainment,
    updateContainment,
    removeContainment,
    addFloorProtection,
    updateFloorProtection,
    removeFloorProtection,
    loadOverlayData,
    markSaved,
    undo,
    redo,
    canUndo: state.undoStack.length > 0,
    canRedo: state.redoStack.length > 0,
  };
}
