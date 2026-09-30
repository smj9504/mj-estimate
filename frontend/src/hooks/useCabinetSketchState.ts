/**
 * useCabinetSketchState
 *
 * useReducer-based state management for the cabinet sketch canvas overlay
 * data. Trimmed down from the water mitigation sketch's useWMSketchState:
 * only walls + placed cabinets, selection, batch-move, z-order, and
 * undo/redo (up to 50 entries) — no demolition/equipment/containment/room
 * concepts.
 */

import { useReducer, useCallback, useMemo } from 'react';
import type {
  CabinetSketchOverlayData,
  CabinetSketchWall,
  CabinetSketchCabinet,
  CabinetSketchTool,
  CabinetSketchSelection,
} from '../types/cabinetSketch';
import { EMPTY_CABINET_OVERLAY_DATA } from '../types/cabinetSketch';

const MAX_UNDO_STACK = 50;

export interface CabinetSketchLocalState {
  overlayData: CabinetSketchOverlayData;
  activeTool: CabinetSketchTool;
  /** Catalog code awaiting placement when activeTool === 'place_cabinet' */
  activePresetCode: string | null;
  selections: CabinetSketchSelection[];
  isDirty: boolean;
  undoStack: CabinetSketchOverlayData[];
  redoStack: CabinetSketchOverlayData[];
}

type CabinetSketchAction =
  | { type: 'SET_TOOL'; payload: CabinetSketchTool }
  | { type: 'SET_ACTIVE_PRESET'; payload: string | null }
  | { type: 'SELECT_ELEMENT'; payload: CabinetSketchSelection }
  | { type: 'TOGGLE_SELECT_ELEMENT'; payload: CabinetSketchSelection }
  | { type: 'DESELECT' }
  | { type: 'ADD_WALL'; payload: CabinetSketchWall }
  | { type: 'UPDATE_WALL'; payload: Partial<CabinetSketchWall> & { id: string } }
  | { type: 'REMOVE_WALL'; payload: string }
  | { type: 'ADD_CABINET'; payload: CabinetSketchCabinet }
  | { type: 'UPDATE_CABINET'; payload: Partial<CabinetSketchCabinet> & { id: string } }
  | { type: 'REMOVE_CABINET'; payload: string }
  | { type: 'BATCH_MOVE_SELECTED'; payload: { draggedId: string; newX: number; newY: number } }
  | { type: 'BRING_TO_FRONT'; payload: string }
  | { type: 'SEND_TO_BACK'; payload: string }
  | { type: 'BRING_FORWARD'; payload: string }
  | { type: 'SEND_BACKWARD'; payload: string }
  | { type: 'LOAD_OVERLAY_DATA'; payload: CabinetSketchOverlayData }
  | { type: 'MARK_SAVED' }
  | { type: 'UNDO' }
  | { type: 'REDO' };

function pushUndo(
  state: CabinetSketchLocalState
): Pick<CabinetSketchLocalState, 'undoStack' | 'redoStack'> {
  const next = [state.overlayData, ...state.undoStack].slice(0, MAX_UNDO_STACK);
  return { undoStack: next, redoStack: [] };
}

function buildDefaultOrder(data: CabinetSketchOverlayData): string[] {
  return [...data.walls.map((w) => w.id), ...data.cabinets.map((c) => c.id)];
}

function ensureOrder(data: CabinetSketchOverlayData): string[] {
  return data.element_order && data.element_order.length > 0
    ? data.element_order
    : buildDefaultOrder(data);
}

function updateById<T extends { id: string }>(
  items: T[],
  patch: Partial<T> & { id: string }
): T[] {
  return items.map((item) => (item.id === patch.id ? { ...item, ...patch } : item));
}

function cabinetSketchReducer(
  state: CabinetSketchLocalState,
  action: CabinetSketchAction
): CabinetSketchLocalState {
  switch (action.type) {
    case 'SET_TOOL':
      return { ...state, activeTool: action.payload };

    case 'SET_ACTIVE_PRESET':
      return { ...state, activePresetCode: action.payload };

    case 'SELECT_ELEMENT':
      return { ...state, selections: [action.payload] };

    case 'TOGGLE_SELECT_ELEMENT': {
      const exists = state.selections.some((s) => s.element_id === action.payload.element_id);
      const newSelections = exists
        ? state.selections.filter((s) => s.element_id !== action.payload.element_id)
        : [...state.selections, action.payload];
      return { ...state, selections: newSelections };
    }

    case 'DESELECT':
      return { ...state, selections: [] };

    case 'ADD_WALL': {
      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: { ...state.overlayData, walls: [...state.overlayData.walls, action.payload] },
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
          walls: updateById(state.overlayData.walls, action.payload),
        },
      };
    }

    case 'REMOVE_WALL': {
      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        selections: state.selections.filter((s) => s.element_id !== action.payload),
        overlayData: {
          ...state.overlayData,
          walls: state.overlayData.walls.filter((w) => w.id !== action.payload),
        },
      };
    }

    case 'ADD_CABINET': {
      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: {
          ...state.overlayData,
          cabinets: [...state.overlayData.cabinets, action.payload],
        },
      };
    }

    case 'UPDATE_CABINET': {
      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: {
          ...state.overlayData,
          cabinets: updateById(state.overlayData.cabinets, action.payload),
        },
      };
    }

    case 'REMOVE_CABINET': {
      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        selections: state.selections.filter((s) => s.element_id !== action.payload),
        overlayData: {
          ...state.overlayData,
          cabinets: state.overlayData.cabinets.filter((c) => c.id !== action.payload),
        },
      };
    }

    case 'BATCH_MOVE_SELECTED': {
      const { draggedId, newX, newY } = action.payload;
      const selectedIdSet = new Set(state.selections.map((s) => s.element_id));

      const allElements = [...state.overlayData.cabinets];
      const draggedEl = allElements.find((el) => el.id === draggedId);
      const oldX = draggedEl?.x ?? 0;
      const oldY = draggedEl?.y ?? 0;
      const dx = newX - oldX;
      const dy = newY - oldY;

      const moveIfSelected = <T extends { id: string; x: number; y: number }>(items: T[]): T[] =>
        items.map((item) =>
          selectedIdSet.has(item.id) ? { ...item, x: item.x + dx, y: item.y + dy } : item
        );

      const { undoStack, redoStack } = pushUndo(state);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: {
          ...state.overlayData,
          cabinets: moveIfSelected(state.overlayData.cabinets),
        },
      };
    }

    case 'BRING_TO_FRONT': {
      const { undoStack, redoStack } = pushUndo(state);
      const order = ensureOrder(state.overlayData).filter((id) => id !== action.payload);
      order.push(action.payload);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: { ...state.overlayData, element_order: order },
      };
    }

    case 'SEND_TO_BACK': {
      const { undoStack, redoStack } = pushUndo(state);
      const order = ensureOrder(state.overlayData).filter((id) => id !== action.payload);
      order.unshift(action.payload);
      return {
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
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
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
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
        ...state,
        undoStack,
        redoStack,
        isDirty: true,
        overlayData: { ...state.overlayData, element_order: order },
      };
    }

    case 'LOAD_OVERLAY_DATA':
      return {
        ...state,
        overlayData: action.payload,
        isDirty: false,
        undoStack: [],
        redoStack: [],
        selections: [],
      };

    case 'MARK_SAVED':
      return { ...state, isDirty: false };

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
      };
    }

    default:
      return state;
  }
}

function createInitialState(
  initialOverlay: CabinetSketchOverlayData = EMPTY_CABINET_OVERLAY_DATA
): CabinetSketchLocalState {
  return {
    overlayData: initialOverlay,
    activeTool: 'select',
    activePresetCode: null,
    selections: [],
    isDirty: false,
    undoStack: [],
    redoStack: [],
  };
}

export interface CabinetSketchStateReturn {
  state: CabinetSketchLocalState;
  setTool: (tool: CabinetSketchTool) => void;
  setActivePreset: (code: string | null) => void;
  selectElement: (selection: CabinetSketchSelection) => void;
  toggleSelectElement: (selection: CabinetSketchSelection) => void;
  deselect: () => void;
  selectedIds: Set<string>;
  batchMoveSelected: (draggedId: string, newX: number, newY: number) => void;

  addWall: (wall: CabinetSketchWall) => void;
  updateWall: (patch: Partial<CabinetSketchWall> & { id: string }) => void;
  removeWall: (id: string) => void;

  addCabinet: (cabinet: CabinetSketchCabinet) => void;
  updateCabinet: (patch: Partial<CabinetSketchCabinet> & { id: string }) => void;
  removeCabinet: (id: string) => void;

  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;
  bringForward: (id: string) => void;
  sendBackward: (id: string) => void;

  loadOverlayData: (data: CabinetSketchOverlayData) => void;
  markSaved: () => void;

  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useCabinetSketchState(
  initialOverlay: CabinetSketchOverlayData = EMPTY_CABINET_OVERLAY_DATA
): CabinetSketchStateReturn {
  const [state, dispatch] = useReducer(cabinetSketchReducer, initialOverlay, createInitialState);

  const setTool = useCallback((tool: CabinetSketchTool) => dispatch({ type: 'SET_TOOL', payload: tool }), []);
  const setActivePreset = useCallback(
    (code: string | null) => dispatch({ type: 'SET_ACTIVE_PRESET', payload: code }),
    []
  );
  const selectElement = useCallback(
    (selection: CabinetSketchSelection) => dispatch({ type: 'SELECT_ELEMENT', payload: selection }),
    []
  );
  const toggleSelectElement = useCallback(
    (selection: CabinetSketchSelection) => dispatch({ type: 'TOGGLE_SELECT_ELEMENT', payload: selection }),
    []
  );
  const deselect = useCallback(() => dispatch({ type: 'DESELECT' }), []);
  const batchMoveSelected = useCallback(
    (draggedId: string, newX: number, newY: number) =>
      dispatch({ type: 'BATCH_MOVE_SELECTED', payload: { draggedId, newX, newY } }),
    []
  );

  const addWall = useCallback((wall: CabinetSketchWall) => dispatch({ type: 'ADD_WALL', payload: wall }), []);
  const updateWall = useCallback(
    (patch: Partial<CabinetSketchWall> & { id: string }) => dispatch({ type: 'UPDATE_WALL', payload: patch }),
    []
  );
  const removeWall = useCallback((id: string) => dispatch({ type: 'REMOVE_WALL', payload: id }), []);

  const addCabinet = useCallback(
    (cabinet: CabinetSketchCabinet) => dispatch({ type: 'ADD_CABINET', payload: cabinet }),
    []
  );
  const updateCabinet = useCallback(
    (patch: Partial<CabinetSketchCabinet> & { id: string }) =>
      dispatch({ type: 'UPDATE_CABINET', payload: patch }),
    []
  );
  const removeCabinet = useCallback((id: string) => dispatch({ type: 'REMOVE_CABINET', payload: id }), []);

  const bringToFront = useCallback((id: string) => dispatch({ type: 'BRING_TO_FRONT', payload: id }), []);
  const sendToBack = useCallback((id: string) => dispatch({ type: 'SEND_TO_BACK', payload: id }), []);
  const bringForward = useCallback((id: string) => dispatch({ type: 'BRING_FORWARD', payload: id }), []);
  const sendBackward = useCallback((id: string) => dispatch({ type: 'SEND_BACKWARD', payload: id }), []);

  const loadOverlayData = useCallback(
    (data: CabinetSketchOverlayData) => dispatch({ type: 'LOAD_OVERLAY_DATA', payload: data }),
    []
  );
  const markSaved = useCallback(() => dispatch({ type: 'MARK_SAVED' }), []);

  const undo = useCallback(() => dispatch({ type: 'UNDO' }), []);
  const redo = useCallback(() => dispatch({ type: 'REDO' }), []);

  const selectedIds = useMemo(() => new Set(state.selections.map((s) => s.element_id)), [state.selections]);

  return {
    state,
    setTool,
    setActivePreset,
    selectElement,
    toggleSelectElement,
    deselect,
    selectedIds,
    batchMoveSelected,
    addWall,
    updateWall,
    removeWall,
    addCabinet,
    updateCabinet,
    removeCabinet,
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
