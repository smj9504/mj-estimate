import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DragProvider } from './DragContext';

interface SortableRowProps {
  id: string;
  children: React.ReactNode;
  showDragHandle?: boolean;
  dragHandlePosition?: 'start' | 'end';
  style?: React.CSSProperties;
  className?: string;
  sectionIndex?: number;
  dragType?: string;
  onDragStart?: (id: string) => void;
  onDragEnd?: (oldIndex: number, newIndex: number) => void;
  items?: string[];
  onReorder?: (newDataSource: any[]) => void;
  [key: string]: any;
}

const SortableRow: React.FC<SortableRowProps> = ({
  id,
  children,
  showDragHandle = true,
  dragHandlePosition = 'start',
  style,
  className,
  onDragStart,
  onDragEnd,
  items = [],
  onReorder,
  sectionIndex,
  dragType,
  ...props
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: id,
  });

  // Filter out any drag-related props that shouldn't be passed to DOM
  const {
    onDragStart: _onDragStart,
    onDragEnd: _onDragEnd,
    items: _items,
    onReorder: _onReorder,
    sectionIndex: _sectionIndex,
    dragType: _dragType,
    activeId: _activeId,
    showDragHandle: _showDragHandle,
    dragHandlePosition: _dragHandlePosition,
    ...domProps
  } = props;

  // When THIS row is dragged: render an EMPTY <tr> placeholder.
  // DragOverlay handles the visual. Empty <tr> prevents Tooltip children from
  // re-rendering on every pointermove (which causes ResizeObserver → setState loop).
  if (isDragging) {
    return (
      <tr
        ref={setNodeRef}
        style={{ opacity: 0, visibility: 'hidden', pointerEvents: 'none', ...style }}
        className={className}
        {...attributes}
        {...listeners}
        {...domProps}
      />
    );
  }

  // When any drag is active (transform is non-null on displaced rows): skip CSS transforms.
  // dnd-kit sets transform on non-dragged rows to slide them up/down showing the drop gap.
  // Applying these per-frame transform changes triggers Ant Design's Tooltip ResizeObserver
  // → setState loop ("Maximum update depth exceeded"). Skip transforms during active drag;
  // the DragOverlay already provides visual feedback — items reorder on drop anyway.
  if (transform !== null) {
    return (
      <tr
        ref={setNodeRef}
        style={style}
        className={className}
        {...attributes}
        {...listeners}
        {...domProps}
      >
        <DragProvider listeners={listeners} attributes={attributes} isDragging={false}>
          {children}
        </DragProvider>
      </tr>
    );
  }

  // Normal (no drag active): full row with transforms and drag context
  return (
    <tr
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        ...style,
      }}
      className={className}
      {...attributes}
      {...listeners}
      {...domProps}
    >
      <DragProvider listeners={listeners} attributes={attributes} isDragging={isDragging}>
        {children}
      </DragProvider>
    </tr>
  );
};

export default SortableRow;
