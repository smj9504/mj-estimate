import React from 'react';
import { HolderOutlined } from '@ant-design/icons';
import { useDragContext } from './DragContext';

interface DragHandleProps {
  listeners?: any;
  attributes?: any;
  isDragging?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

const DragHandle: React.FC<DragHandleProps> = ({
  listeners: propListeners,
  attributes: propAttributes,
  isDragging: propIsDragging,
  style,
  className,
}) => {
  // Use context if props are not provided (null or undefined)
  const dragContext = useDragContext();

  const listeners = propListeners ?? dragContext?.listeners;
  const attributes = propAttributes ?? dragContext?.attributes;
  const isDragging = propIsDragging ?? dragContext?.isDragging ?? false;

  return (
    <div
      {...attributes}
      {...listeners}
      className={className}
      style={{
        cursor: isDragging ? 'grabbing' : 'grab',
        padding: '4px 8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: isDragging ? '#1890ff' : '#999',
        transition: 'color 0.2s ease',
        userSelect: 'none',
        touchAction: 'none', // Important for touch devices
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!isDragging) {
          (e.currentTarget as HTMLElement).style.color = '#1890ff';
        }
      }}
      onMouseLeave={(e) => {
        if (!isDragging) {
          (e.currentTarget as HTMLElement).style.color = '#999';
        }
      }}
    >
      <HolderOutlined />
    </div>
  );
};

export default DragHandle;