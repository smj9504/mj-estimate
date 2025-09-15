import React, { useState } from 'react';
import { Table, TableProps } from 'antd';
import { ColumnsType } from 'antd/es/table';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  UniqueIdentifier,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import SortableRow from './SortableRow';
import DragHandle from './DragHandle';

export interface DraggableTableProps<T = any> extends Omit<TableProps<T>, 'dataSource'> {
  dataSource: T[];
  onReorder: (newDataSource: T[]) => void;
  dragHandlePosition?: 'start' | 'end';
  showDragHandle?: boolean;
  disableDrag?: boolean;
  dragColumnTitle?: string;
  dragColumnWidth?: number;
  getRowId?: (record: T, index: number) => string;
}

function DraggableTable<T extends Record<string, any>>({
  dataSource = [],
  columns: originalColumns = [],
  onReorder,
  dragHandlePosition = 'start',
  showDragHandle = true,
  disableDrag = false,
  dragColumnTitle = '',
  dragColumnWidth = 40,
  getRowId,
  ...tableProps
}: DraggableTableProps<T>) {
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);

  // Setup sensors for drag interactions
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 5px movement required to start drag
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Generate unique IDs for rows
  const getItemId = (record: T, fallbackIndex?: number): string => {
    if (getRowId && fallbackIndex !== undefined) {
      return getRowId(record, fallbackIndex);
    }
    
    // Try common ID fields first (most reliable)
    if (record.id !== undefined) return String(record.id);
    if (record.key !== undefined) return String(record.key);
    if (record.uuid !== undefined) return String(record.uuid);
    
    // Use object hash or fallback to index if provided
    if (fallbackIndex !== undefined) {
      return `row-${fallbackIndex}`;
    }
    
    // Last resort: use stringified record (not recommended but safer than random)
    return `record-${JSON.stringify(record).slice(0, 50).replace(/[^a-zA-Z0-9]/g, '')}`;
  };

  // Create sortable items array
  const items = dataSource.map((record, index) => getItemId(record, index));

  // Filter out any undefined columns and ensure originalColumns is always an array
  const validColumns = (originalColumns || []).filter(col => col !== undefined && col !== null);

  // Add drag handle column if needed
  const columns: ColumnsType<T> = showDragHandle && !disableDrag
    ? [
        ...(dragHandlePosition === 'start'
          ? [
              {
                title: dragColumnTitle,
                key: 'drag-handle',
                width: dragColumnWidth,
                fixed: 'left' as const,
                render: (_: any, record: T, index: number) => {
                  const id = getItemId(record, index);
                  return (
                    <DragHandle
                      listeners={null} // Will be set by SortableRow
                      attributes={null} // Will be set by SortableRow
                      isDragging={activeId === id}
                    />
                  );
                },
              },
            ]
          : []),
        ...validColumns,
        ...(dragHandlePosition === 'end'
          ? [
              {
                title: dragColumnTitle,
                key: 'drag-handle',
                width: dragColumnWidth,
                fixed: 'right' as const,
                render: (_: any, record: T, index: number) => {
                  const id = getItemId(record, index);
                  return (
                    <DragHandle
                      listeners={null} // Will be set by SortableRow
                      attributes={null} // Will be set by SortableRow
                      isDragging={activeId === id}
                    />
                  );
                },
              },
            ]
          : []),
      ]
    : validColumns;

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    setActiveId(active.id);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    setActiveId(null);

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = items.indexOf(active.id as string);
    const newIndex = items.indexOf(over.id as string);

    if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
      const newDataSource = arrayMove(dataSource, oldIndex, newIndex);
      onReorder(newDataSource);
    }
  };

  // Custom row component that integrates with sortable
  const customRow = (record: T, index?: number) => {
    if (disableDrag) {
      return {};
    }

    const id = getItemId(record, index || 0);
    
    return {
      'data-row-key': id,
      'data-sortable-id': id, // Add this for SortableRow
      style: {
        cursor: 'default',
      },
    };
  };

  // Find the currently dragged item for overlay
  const activeItem = activeId ? dataSource.find((item, index) => getItemId(item, index) === activeId) : null;

  if (disableDrag) {
    return <Table {...tableProps} dataSource={dataSource} columns={columns} />;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      modifiers={[restrictToVerticalAxis]}
    >
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <Table
          {...tableProps}
          dataSource={dataSource}
          columns={columns}
          components={{
            body: {
              row: (props: any) => {
                // Get the ID from the row props
                const id = props['data-sortable-id'] || props['data-row-key'] || props.key || `row-${Math.random()}`;
                
                return (
                  <SortableRow
                    {...props}
                    id={id}
                    showDragHandle={showDragHandle && !disableDrag}
                    dragHandlePosition={dragHandlePosition}
                  />
                );
              },
            },
          }}
          onRow={customRow}
          rowKey={(record) => {
            // Find the index of the record in dataSource
            const index = dataSource.indexOf(record);
            return getItemId(record, index >= 0 ? index : 0);
          }}
        />
      </SortableContext>
      
      <DragOverlay>
        {activeId && activeItem ? (
          <div
            style={{
              backgroundColor: 'white',
              border: '1px solid #d9d9d9',
              borderRadius: '6px',
              padding: '8px 12px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              fontSize: '14px',
              minWidth: '200px',
              opacity: 0.9,
            }}
          >
            Dragging item...
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export default DraggableTable;