import React from 'react';
import { Table, TableProps } from 'antd';
import { ColumnsType } from 'antd/es/table';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
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
  sectionIndex?: number; // Added to identify which section this table belongs to
  dragType?: string; // Added to identify the type of drag operation
  activeId?: string | null; // Active drag ID from parent context
  onDragStart?: (id: string) => void; // Callback for drag start
  onDragEnd?: (oldIndex: number, newIndex: number) => void; // Callback for drag end
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
  sectionIndex,
  dragType = 'item',
  activeId = null,
  onDragStart,
  onDragEnd,
  ...tableProps
}: DraggableTableProps<T>) {

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
      return `${dragType}-${sectionIndex}-${fallbackIndex}`;
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

  if (disableDrag) {
    return <Table {...tableProps} dataSource={dataSource} columns={columns} />;
  }

  return (
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


              // Filter out our custom props that shouldn't reach the DOM
              const {
                sectionIndex: _sectionIndex,
                dragType: _dragType,
                onDragStart: _onDragStart,
                onDragEnd: _onDragEnd,
                items: _items,
                onReorder: _onReorder,
                activeId: _activeId,
                ...rowProps
              } = props;

              return (
                <SortableRow
                  {...rowProps}
                  id={id}
                  showDragHandle={showDragHandle && !disableDrag}
                  dragHandlePosition={dragHandlePosition}
                  sectionIndex={sectionIndex}
                  dragType={dragType}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  items={items}
                  onReorder={onReorder}
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
  );
}

export default DraggableTable;