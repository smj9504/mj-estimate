import React, { useState } from 'react';
import {
  Button, Grid, Radio, Space, Table, Tag, Typography,
} from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, WarningOutlined, PlusOutlined } from '@ant-design/icons';
import { AppliedLineItem, MatchedItem, TemplateCompareResponse } from '../../types/repairSpec';

const { Text } = Typography;
const { useBreakpoint } = Grid;

type ViewMode = 'side-by-side' | 'unified';

interface TemplateCompareViewProps {
  compareResult: TemplateCompareResponse;
  onAddMissing?: (item: AppliedLineItem) => void;
  onAddAllMissing?: (items: AppliedLineItem[]) => void;
  onKeepExtra?: (item: Record<string, unknown>) => void;
  onRemoveExtra?: (item: Record<string, unknown>) => void;
}

const fmt = (v?: number | null) =>
  v != null ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

const TemplateCompareView: React.FC<TemplateCompareViewProps> = ({
  compareResult,
  onAddMissing,
  onAddAllMissing,
  onKeepExtra,
  onRemoveExtra,
}) => {
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [viewMode, setViewMode] = useState<ViewMode>('unified');

  const { matched, missing, extra } = compareResult;

  // Build unified list
  type UnifiedRow = {
    key: string;
    status: 'ok' | 'missing' | 'extra';
    scope?: string;
    description: string;
    qty?: number | null;
    unit?: string | null;
    price?: number | null;
    templateItem?: AppliedLineItem;
    extractionItem?: Record<string, unknown>;
  };

  const unifiedRows: UnifiedRow[] = [];

  matched.forEach((m, i) => {
    unifiedRows.push({
      key: `m-${i}`,
      status: 'ok',
      scope: m.template_item.condition_scope,
      description: m.extraction_item.line_item as string,
      qty: m.extraction_item.quantity as number,
      unit: m.extraction_item.unit as string,
      price: m.extraction_item.unit_price as number,
      templateItem: m.template_item,
      extractionItem: m.extraction_item,
    });
  });

  missing.forEach((m, i) => {
    unifiedRows.push({
      key: `miss-${i}`,
      status: 'missing',
      scope: m.condition_scope,
      description: m.description,
      qty: null,
      unit: m.unit,
      price: m.unit_price,
      templateItem: m,
    });
  });

  extra.forEach((e, i) => {
    unifiedRows.push({
      key: `ext-${i}`,
      status: 'extra',
      description: (e.line_item as string) || '',
      qty: e.quantity as number,
      unit: e.unit as string,
      price: e.unit_price as number,
      extractionItem: e,
    });
  });

  const statusIcon = (status: string) => {
    switch (status) {
      case 'ok': return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
      case 'missing': return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
      case 'extra': return <WarningOutlined style={{ color: '#faad14' }} />;
      default: return null;
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case 'ok': return <Tag color="success">OK</Tag>;
      case 'missing': return <Tag color="error">MISSING</Tag>;
      case 'extra': return <Tag color="warning">EXTRA</Tag>;
      default: return null;
    }
  };

  const columns = [
    {
      title: 'Status',
      key: 'status',
      width: 90,
      render: (_: unknown, row: UnifiedRow) => statusLabel(row.status),
    },
    {
      title: 'Scope',
      key: 'scope',
      width: 90,
      render: (_: unknown, row: UnifiedRow) =>
        row.scope ? (
          <Tag color={row.scope === 'affected' ? 'blue' : 'red'} style={{ fontSize: 11 }}>
            {row.scope.toUpperCase()}
          </Tag>
        ) : '—',
    },
    {
      title: 'Line Item',
      key: 'description',
      render: (_: unknown, row: UnifiedRow) => row.description,
      ellipsis: true,
    },
    {
      title: 'Qty',
      key: 'qty',
      width: 70,
      render: (_: unknown, row: UnifiedRow) =>
        row.qty != null ? Number(row.qty).toFixed(2) : '—',
    },
    {
      title: 'Unit',
      key: 'unit',
      width: 60,
      render: (_: unknown, row: UnifiedRow) => row.unit || '—',
    },
    {
      title: 'Price',
      key: 'price',
      width: 90,
      render: (_: unknown, row: UnifiedRow) => fmt(row.price),
    },
    {
      title: '',
      key: 'actions',
      width: 80,
      render: (_: unknown, row: UnifiedRow) => {
        if (row.status === 'missing' && onAddMissing && row.templateItem) {
          return (
            <Button
              type="link"
              size="small"
              icon={<PlusOutlined />}
              onClick={() => onAddMissing(row.templateItem!)}
            >
              Add
            </Button>
          );
        }
        if (row.status === 'extra' && row.extractionItem) {
          return (
            <Space size={4}>
              {onKeepExtra && (
                <Button type="link" size="small" onClick={() => onKeepExtra(row.extractionItem!)}>
                  Keep
                </Button>
              )}
              {onRemoveExtra && (
                <Button type="link" size="small" danger onClick={() => onRemoveExtra(row.extractionItem!)}>
                  Remove
                </Button>
              )}
            </Space>
          );
        }
        return null;
      },
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 12, justifyContent: 'space-between', width: '100%', flexWrap: 'wrap' }}>
        <Space>
          <Tag color="success">{matched.length} matched</Tag>
          <Tag color="error">{missing.length} missing</Tag>
          <Tag color="warning">{extra.length} extra</Tag>
        </Space>
        <Space>
          {missing.length > 0 && onAddAllMissing && (
            <Button
              size="small"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => onAddAllMissing(missing)}
            >
              Add All Missing
            </Button>
          )}
        </Space>
      </Space>

      <Table
        size="small"
        rowKey="key"
        dataSource={unifiedRows}
        columns={columns}
        pagination={false}
        scroll={{ x: 600 }}
        rowClassName={(row) => {
          if (row.status === 'missing') return 'ant-table-row-missing';
          if (row.status === 'extra') return 'ant-table-row-extra';
          return '';
        }}
      />
    </div>
  );
};

export default TemplateCompareView;
