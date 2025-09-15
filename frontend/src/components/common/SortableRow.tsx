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
  [key: string]: any;
}

const SortableRow: React.FC<SortableRowProps> = ({
  id,
  children,
  showDragHandle = true,
  dragHandlePosition = 'start',
  style,
  className,
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
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1000 : 'auto',
    position: isDragging ? 'relative' : 'static',
    ...style,
  } as React.CSSProperties;

  // Convert children to array for manipulation
  const childrenArray = React.Children.toArray(children);

  // Enhance drag handle column with listeners if it exists
  const enhancedChildren = childrenArray.map((child, index) => {
    if (React.isValidElement(child)) {
      // Check if this is a drag handle cell
      const cellProps = child.props || {};
      const isDragHandleCell = cellProps.children && 
        React.isValidElement(cellProps.children) &&
        cellProps.children.type === DragHandle;

      if (isDragHandleCell) {
        // Clone the cell with enhanced DragHandle
        return React.cloneElement(child, {
          ...cellProps,
          children: React.cloneElement(cellProps.children, {
            listeners,
            attributes,
            isDragging,
          }),
        });
      }
    }
    return child;
  });

  return (
    <tr
      ref={setNodeRef}
      style={transformStyle}
      className={className}
      {...props}
    >
      {enhancedChildren}
    </tr>
  );
};

export default SortableRow;