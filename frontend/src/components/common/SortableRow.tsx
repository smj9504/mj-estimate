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

  const transformStyle = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? 'none' : transition,
    opacity: isDragging ? 0 : 1,
    zIndex: isDragging ? 1000 : 'auto',
    position: isDragging ? 'relative' : 'static',
    visibility: isDragging ? 'hidden' : 'visible',
    ...style,
  } as React.CSSProperties;

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

  // Use DragProvider to pass drag context to DragHandle children
  // This eliminates the need for expensive recursive child traversal
  return (
    <tr
      ref={setNodeRef}
      style={transformStyle}
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