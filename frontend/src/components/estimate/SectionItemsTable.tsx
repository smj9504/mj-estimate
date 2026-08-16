import React, { memo, useMemo, useCallback } from 'react';
import { Button, Space, Switch, Tooltip, Popconfirm } from 'antd';
import { EditOutlined, DeleteOutlined, FileTextFilled } from '@ant-design/icons';
import DraggableTable from '../common/DraggableTable';
import { EstimateLineItem } from '../../services/estimateService';

interface SectionItemsTableProps {
  sectionIndex: number;
  items: EstimateLineItem[];
  activeId: string | null;
  taxMethod: 'percentage' | 'specific';
  selectedRowKeys: string[];
  onRowSelection: (keys: string[]) => void;
  onEditItem: (index: number) => void;
  onDeleteItem: (index: number) => void;
  onTaxableChange: (index: number, checked: boolean) => void;
  onToggleAllTaxable: (checked: boolean) => void;
  formatCurrency: (value: number) => string;
  // When true (document-level lump sum mode), qty/unit/rate/total/tax
  // columns are hidden - only the description remains visible.
  hidePricing?: boolean;
}

// Memoized table component to prevent re-renders during drag
const SectionItemsTable: React.FC<SectionItemsTableProps> = memo(({
  sectionIndex,
  items,
  activeId,
  taxMethod,
  selectedRowKeys,
  onRowSelection,
  onEditItem,
  onDeleteItem,
  onTaxableChange,
  onToggleAllTaxable,
  formatCurrency,
  hidePricing = false,
}) => {
  // Memoize dataSource to prevent new objects on every render
  const dataSource = useMemo(() =>
    items.map((item, index) => ({
      ...item,
      key: item.id || `${sectionIndex}-${index}-${item.name || 'unnamed'}-${item.unit_price || 0}`
    })),
    [items, sectionIndex]
  );

  // Stable row selection handler
  const handleRowSelection = useCallback((keys: React.Key[]) => {
    onRowSelection(keys as string[]);
  }, [onRowSelection]);

  // Stable edit handler
  const handleEdit = useCallback((index: number) => {
    onEditItem(index);
  }, [onEditItem]);

  // Stable delete handler
  const handleDelete = useCallback((index: number) => {
    onDeleteItem(index);
  }, [onDeleteItem]);

  // Memoize columns to prevent recreation on every render
  const columns = useMemo(() => {
    const baseColumns: any[] = [
      {
        title: 'Description',
        dataIndex: 'description',
        key: 'description',
        ellipsis: true,
        width: 200,
        minWidth: 100,
        maxWidth: 500,
        fixed: 'left' as const,
        render: (value: string, record: EstimateLineItem) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {value ? <div dangerouslySetInnerHTML={{ __html: value }} /> : null}
            {record.note && (
              <Tooltip title={<div dangerouslySetInnerHTML={{ __html: record.note }} />}>
                <FileTextFilled style={{ color: '#1890ff', cursor: 'help', flexShrink: 0 }} />
              </Tooltip>
            )}
          </div>
        ),
      },
    ];

    if (!hidePricing) {
      baseColumns.push(
        {
          title: 'Qty',
          dataIndex: 'quantity',
          key: 'quantity',
          width: 60,
          align: 'center' as const,
        },
        {
          title: 'Unit',
          dataIndex: 'unit',
          key: 'unit',
          width: 60,
          align: 'center' as const,
        },
        {
          title: 'Rate',
          dataIndex: 'unit_price',
          key: 'unit_price',
          width: 80,
          align: 'right' as const,
          render: (value: number) => formatCurrency(value || 0),
        } as any,
        {
          title: 'Total',
          dataIndex: 'total',
          key: 'total',
          width: 90,
          align: 'right' as const,
          render: (value: number) => formatCurrency(value || 0),
        } as any,
      );
    }

    // Add tax column if using percentage method
    if (!hidePricing && taxMethod === 'percentage') {
      const allTaxable = items.every(item => item.taxable !== false);
      baseColumns.push({
        title: (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span>Tax</span>
            <Tooltip title="Toggle all items in this section">
              <Switch
                size="small"
                checked={allTaxable}
                onChange={onToggleAllTaxable}
              />
            </Tooltip>
          </div>
        ) as any,
        dataIndex: 'taxable',
        key: 'taxable',
        width: 80,
        align: 'center' as const,
        render: (value: boolean | undefined, _record: EstimateLineItem, recordIndex: number) => (
          <Switch
            size="small"
            checked={value !== false}
            onChange={(checked) => onTaxableChange(recordIndex, checked)}
          />
        ),
      } as any);
    }

    // Add actions column
    baseColumns.push({
      title: '',
      key: 'actions',
      width: 70,
      align: 'center' as const,
      fixed: 'right' as const,
      render: (_: any, _record: EstimateLineItem, index: number) => (
        <Space size="small">
          <Tooltip title="Edit item">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                handleEdit(index);
              }}
            />
          </Tooltip>
          <Tooltip title="Delete item">
            <Popconfirm
              title="Are you sure you want to delete this item?"
              onConfirm={(e) => {
                e?.stopPropagation();
                handleDelete(index);
              }}
              okText="Yes"
              cancelText="No"
            >
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={(e) => e.stopPropagation()}
              />
            </Popconfirm>
          </Tooltip>
        </Space>
      ),
    } as any);

    return baseColumns;
  }, [taxMethod, items, formatCurrency, onToggleAllTaxable, onTaxableChange, handleEdit, handleDelete, hidePricing]);

  // Memoize getRowId function
  const getRowId = useCallback((record: EstimateLineItem, index: number) =>
    `item-${sectionIndex}-${record.id || `fallback-${index}`}`,
    [sectionIndex]
  );

  // Memoize onRow handler
  const onRowHandler = useCallback((_record: EstimateLineItem, index?: number) => ({
    onDoubleClick: () => handleEdit(index!),
    style: { cursor: 'pointer' },
  }), [handleEdit]);

  return (
    <DraggableTable
      className="draggable-table estimate-items-table"
      dataSource={dataSource}
      onReorder={() => {}}
      pagination={false}
      size="small"
      showDragHandle={true}
      dragHandlePosition="start"
      dragColumnWidth={30}
      getRowId={getRowId}
      disableDrag={false}
      sectionIndex={sectionIndex}
      dragType="item"
      activeId={activeId}
      scroll={{ x: 600 }}
      resizableColumns={true}
      rowSelection={{
        selectedRowKeys,
        onChange: handleRowSelection,
        type: 'checkbox',
      }}
      onRow={onRowHandler}
      columns={columns}
    />
  );
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render if these props changed
  // Skip re-render if only activeId changed (handled by dnd-kit internally)
  return (
    prevProps.sectionIndex === nextProps.sectionIndex &&
    prevProps.items === nextProps.items &&
    prevProps.taxMethod === nextProps.taxMethod &&
    prevProps.selectedRowKeys === nextProps.selectedRowKeys &&
    prevProps.hidePricing === nextProps.hidePricing &&
    // Don't compare activeId - let dnd-kit handle that internally
    prevProps.formatCurrency === nextProps.formatCurrency
  );
});

SectionItemsTable.displayName = 'SectionItemsTable';

export default SectionItemsTable;
