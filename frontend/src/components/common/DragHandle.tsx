import React from 'react';
import { HolderOutlined } from '@ant-design/icons';

interface DragHandleProps {
  listeners?: any;
  attributes?: any;
  isDragging?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

const DragHandle: React.FC<DragHandleProps> = ({
  listeners,
  attributes,
  isDragging = false,
  style,
  className,
}) => {
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