/**
 * LineItemManager 관련 타입 정의
 * 키보드 단축키, 다중 선택, 실행취소 등의 고급 기능을 위한 타입들
 */

import { EstimateLineItem } from '../services/EstimateService';
import { LineItem, LineItemCategory } from './lineItem';

// =====================================================
// 키보드 단축키 관련
// =====================================================
export enum KeyboardShortcut {
  SELECT_ALL = 'Ctrl+A',
  COPY = 'Ctrl+C', 
  PASTE = 'Ctrl+V',
  UNDO = 'Ctrl+Z',
  REDO = 'Ctrl+Y',
  DELETE = 'Delete',
  ESCAPE = 'Escape',
  ENTER = 'Enter',
  F2 = 'F2',
}

export interface KeyboardEvent {
  shortcut: KeyboardShortcut;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

// =====================================================
// 다중 선택 관련
// =====================================================
export interface SelectionState {
  selectedIds: Set<string>;
  lastSelectedId: string | null;
  selectionStart: number | null;
}

export interface SelectionAction {
  type: 'SELECT' | 'DESELECT' | 'SELECT_RANGE' | 'SELECT_ALL' | 'CLEAR_ALL' | 'TOGGLE';
  itemId?: string;
  itemIds?: string[];
  startIndex?: number;
  endIndex?: number;
}

export interface MultiSelectOptions {
  allowRangeSelection: boolean;
  maxSelections?: number;
  onSelectionChange?: (selectedIds: string[]) => void;
}

// =====================================================
// 실행취소 시스템 (Command Pattern)
// =====================================================
export interface Command {
  execute(): void;
  undo(): void;
  canUndo(): boolean;
  description: string;
  timestamp: Date;
}

export interface CommandHistory {
  undoStack: Command[];
  redoStack: Command[];
  maxHistorySize: number;
}

// 구체적인 Command 타입들
export interface AddItemCommand extends Command {
  type: 'ADD_ITEM';
  item: EstimateLineItem;
  index: number;
}

export interface DeleteItemCommand extends Command {
  type: 'DELETE_ITEM';
  items: EstimateLineItem[];
  indices: number[];
}

export interface EditItemCommand extends Command {
  type: 'EDIT_ITEM';
  itemId: string;
  oldValue: Partial<EstimateLineItem>;
  newValue: Partial<EstimateLineItem>;
  fieldName: keyof EstimateLineItem;
}

export interface MoveItemCommand extends Command {
  type: 'MOVE_ITEM';
  itemIds: string[];
  fromIndices: number[];
  toIndex: number;
}

export interface DuplicateItemCommand extends Command {
  type: 'DUPLICATE_ITEM';
  originalItems: EstimateLineItem[];
  newItems: EstimateLineItem[];
  insertIndex: number;
}

export type LineItemCommand = 
  | AddItemCommand 
  | DeleteItemCommand 
  | EditItemCommand 
  | MoveItemCommand
  | DuplicateItemCommand;

// =====================================================
// 컨텍스트 메뉴 관련
// =====================================================
export enum ContextMenuAction {
  EDIT = 'edit',
  DELETE = 'delete',
  COPY = 'copy',
  DUPLICATE = 'duplicate',
  MOVE_UP = 'moveUp',
  MOVE_DOWN = 'moveDown',
  UNDO = 'undo',
  REDO = 'redo',
}

export interface ContextMenuItem {
  action: ContextMenuAction;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  disabled?: boolean;
  dangerous?: boolean;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onAction: (action: ContextMenuAction) => void;
  onClose: () => void;
}

// =====================================================
// 인라인 편집 관련
// =====================================================
export interface EditingState {
  itemId: string | null;
  fieldName: keyof EstimateLineItem | null;
  originalValue: any;
  isEditing: boolean;
}

export interface EditingOptions {
  onStartEdit?: (itemId: string, fieldName: keyof EstimateLineItem) => void;
  onSaveEdit?: (itemId: string, fieldName: keyof EstimateLineItem, newValue: any) => void;
  onCancelEdit?: (itemId: string, fieldName: keyof EstimateLineItem) => void;
  validateValue?: (fieldName: keyof EstimateLineItem, value: any) => boolean;
}

// =====================================================
// 드래그 앤 드롭 관련
// =====================================================
export interface DragState {
  isDragging: boolean;
  draggedItems: EstimateLineItem[];
  draggedIndices: number[];
  dropTargetIndex: number | null;
}

export interface DragDropOptions {
  allowMultiDrag: boolean;
  onDragStart?: (items: EstimateLineItem[], indices: number[]) => void;
  onDragEnd?: (fromIndices: number[], toIndex: number) => void;
}

// =====================================================
// 모달 선택 관련
// =====================================================
export interface CategorySelectionModalProps {
  visible: boolean;
  categories: LineItemCategory[];
  loading?: boolean;
  onSelect: (category: LineItemCategory) => void;
  onCancel: () => void;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
}

export interface ItemSelectionModalProps {
  visible: boolean;
  items: LineItem[];
  loading?: boolean;
  multiSelect?: boolean;
  selectedItems?: LineItem[];
  onSelect: (items: LineItem[]) => void;
  onCancel: () => void;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
}

// =====================================================
// 자동 저장 관련
// =====================================================
export interface AutoSaveState {
  isDirty: boolean;
  isSaving: boolean;
  lastSaved: Date | null;
  saveError: string | null;
}

export interface AutoSaveOptions {
  delay: number; // milliseconds
  onSave: (items: EstimateLineItem[]) => Promise<void>;
  onError: (error: any) => void;
}

// =====================================================
// 메인 LineItemManager Props
// =====================================================
export interface LineItemManagerState {
  // 기본 데이터
  items: EstimateLineItem[];
  categories: LineItemCategory[];
  availableItems: LineItem[];
  
  // 선택 상태
  selection: SelectionState;
  
  // 편집 상태
  editing: EditingState;
  
  // 드래그 상태
  drag: DragState;
  
  // 명령 히스토리
  commandHistory: CommandHistory;
  
  // 자동 저장 상태
  autoSave: AutoSaveState;
  
  // UI 상태
  showCategoryModal: boolean;
  showItemModal: boolean;
  contextMenu: {
    visible: boolean;
    x: number;
    y: number;
    targetItemIds: string[];
  } | null;
}

export interface LineItemManagerProps {
  items: EstimateLineItem[];
  onItemsChange: (items: EstimateLineItem[]) => void;
  selectedGroup?: string;
  autoSave?: boolean;
  autoSaveDelay?: number;
  maxHistorySize?: number;
  enableKeyboardShortcuts?: boolean;
  enableDragDrop?: boolean;
  enableMultiSelect?: boolean;
}

// =====================================================
// 에러 처리 관련
// =====================================================
export interface NetworkError {
  type: 'NETWORK_ERROR';
  message: string;
  statusCode?: number;
}

export interface ValidationError {
  type: 'VALIDATION_ERROR';
  field: keyof EstimateLineItem;
  message: string;
}

export interface AutoSaveError {
  type: 'AUTO_SAVE_ERROR';
  message: string;
  originalError: any;
}

export type LineItemError = NetworkError | ValidationError | AutoSaveError;

// =====================================================
// 유틸리티 타입들
// =====================================================
export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;

// 부분 업데이트를 위한 타입
export type PartialEstimateLineItem = Partial<EstimateLineItem> & {
  id: string;
};

// 정렬 가능한 필드 타입
export type SortableField = 'description' | 'quantity' | 'unit_price' | 'total';
export type SortDirection = 'asc' | 'desc';

export interface SortConfig {
  field: SortableField;
  direction: SortDirection;
}