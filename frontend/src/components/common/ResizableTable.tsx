import React, { useState, useCallback } from 'react';
import { Table, TableProps } from 'antd';
import { ColumnsType, ColumnType } from 'antd/es/table';
import { ResizeCallbackData } from 'react-resizable';
import ResizableTitle from './ResizableTitle';
import 'react-resizable/css/styles.css';

// Extended column type with resizable properties
export interface ResizableColumnType<T> extends ColumnType<T> {
  resizable?: boolean;
  minWidth?: number;
  maxWidth?: number;
}

export interface ResizableTableProps<T = any> extends Omit<TableProps<T>, 'columns'> {
  columns: ResizableColumnType<T>[];
  onColumnWidthChange?: (columnKey: string, width: number) => void;
  defaultColumnWidths?: Record<string, number>;
}

function ResizableTable<T extends Record<string, any>>({
  columns: initialColumns,
  onColumnWidthChange,
  defaultColumnWidths = {},
  components: externalComponents,
  ...tableProps
}: ResizableTableProps<T>) {
  // Track column widths in state
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    const widths: Record<string, number> = { ...defaultColumnWidths };
    initialColumns.forEach((col, index) => {
      const key = String(col.key || col.dataIndex || index);
      if (widths[key] === undefined && col.width) {
        widths[key] = typeof col.width === 'number' ? col.width : parseInt(col.width as string, 10) || 100;
      }
    });
    return widths;
  });

  // Handle resize
  const handleResize = useCallback(
    (columnKey: string) =>
      (_: React.SyntheticEvent, { size }: ResizeCallbackData) => {
        setColumnWidths((prev) => {
          const newWidths = { ...prev, [columnKey]: size.width };
          onColumnWidthChange?.(columnKey, size.width);
          return newWidths;
        });
      },
    [onColumnWidthChange]
  );

  // Build columns with resize handlers
  const columns: ColumnsType<T> = initialColumns.map((col, index) => {
    const key = String(col.key || col.dataIndex || index);
    const width = columnWidths[key] || col.width;
    const resizable = col.resizable !== false && width !== undefined;

    return {
      ...col,
      width,
      onHeaderCell: resizable
        ? (column: any) => ({
            width: columnWidths[key] || column.width,
            onResize: handleResize(key),
            minWidth: col.minWidth,
            maxWidth: col.maxWidth,
          })
        : col.onHeaderCell,
    };
  });

  // Merge components with ResizableTitle
  const mergedComponents = {
    ...externalComponents,
    header: {
      ...externalComponents?.header,
      cell: ResizableTitle,
    },
  };

  return (
    <Table
      {...tableProps}
      columns={columns}
      components={mergedComponents}
    />
  );
}

export default ResizableTable;
