import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import DragHandle from './DragHandle';

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
    opacity: isDragging ? 0 : 1, // Completely hide the original when dragging
    zIndex: isDragging ? 1000 : 'auto',
    position: isDragging ? 'relative' : 'static',
    visibility: isDragging ? 'hidden' : 'visible', // Add visibility control
    ...style,
  } as React.CSSProperties;

  // Convert children to array for manipulation
  const childrenArray = React.Children.toArray(children);

  // Function to recursively search for DragHandle and enhance it
  const enhanceDragHandle = (element: any): any => {
    if (!React.isValidElement(element)) {
      return element;
    }

    // Check if this is a DragHandle component
    if (element.type === DragHandle) {
      return React.cloneElement(element as React.ReactElement<any>, {
        ...(element.props || {}),
        listeners,
        attributes,
        isDragging,
      });
    }

    // If it has children, recursively check them
    const elementProps = element.props as any;
    if (elementProps && elementProps.children) {
      const enhancedChildren = React.Children.map(elementProps.children, enhanceDragHandle);
      return React.cloneElement(element as React.ReactElement<any>, {
        ...elementProps,
        children: enhancedChildren,
      });
    }

    return element;
  };

  // Enhance all children to find and enhance DragHandle components
  const enhancedChildren = childrenArray.map((child) => enhanceDragHandle(child));

  // Filter out any remaining drag-related props that shouldn't be passed to DOM
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

  return (
    <tr
      ref={setNodeRef}
      style={transformStyle}
      className={className}
      {...attributes}
      {...listeners}
      {...domProps}
    >
      {enhancedChildren}
    </tr>
  );
};

export default SortableRow;