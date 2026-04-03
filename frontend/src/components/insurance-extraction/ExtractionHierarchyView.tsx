import React from 'react';
import { Card, Space, Table, Tabs, Tag, Typography } from 'antd';
import { ExtractionHierarchy, ExtractionTotals, InsuranceExtractionItem } from '../../types/insuranceExtraction';

const { Text } = Typography;

interface ExtractionHierarchyViewProps {
  items: InsuranceExtractionItem[];
  hierarchy?: ExtractionHierarchy;
}

const fmt = (v?: number | null) =>
  v != null
    ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : null;

const columns = [
  { title: 'Line Item', dataIndex: 'line_item', key: 'line_item' },
  {
    title: 'Notes',
    dataIndex: 'notes',
    key: 'notes',
    width: 220,
    ellipsis: true,
    render: (v: string | null | undefined) => v || '—',
  },
  {
    title: 'Qty',
    dataIndex: 'quantity',
    key: 'quantity',
    width: 90,
    render: (v: number | null | undefined) => v != null ? Number(v).toFixed(2) : '—',
  },
  { title: 'Unit', dataIndex: 'unit', key: 'unit', width: 80 },
  { title: 'Unit Price', dataIndex: 'unit_price', key: 'unit_price', width: 120 },
  { title: 'Conf.', dataIndex: 'confidence', key: 'confidence', width: 90 },
];

const pickItemsByIndices = (items: InsuranceExtractionItem[], indices: number[]) => {
  const wanted = new Set(indices || []);
  return items.filter((_it, idx) => wanted.has(idx));
};

const renderDimensionTags = (dimensions?: Record<string, number>, heightFt?: number | null) => {
  const entries = Object.entries(dimensions || {});
  if (!entries.length && !heightFt) return null;
  return (
    <Space size={[6, 6]} wrap>
      {heightFt ? <Tag color="blue">Height: {heightFt} ft</Tag> : null}
      {entries.map(([k, v]) => (
        <Tag key={k}>{`${k}: ${v}`}</Tag>
      ))}
    </Space>
  );
};

const renderTotals = (totals?: ExtractionTotals) => {
  if (!totals || (!totals.rcv && !totals.acv)) return null;
  return (
    <Space size={[8, 4]} wrap style={{ marginTop: 4 }}>
      {fmt(totals.rcv) && <Tag color="green">RCV: {fmt(totals.rcv)}</Tag>}
      {fmt(totals.depreciation) && <Tag color="orange">Deprec: {fmt(totals.depreciation)}</Tag>}
      {fmt(totals.acv) && <Tag color="blue">ACV: {fmt(totals.acv)}</Tag>}
    </Space>
  );
};

const countLevelItems = (level: ExtractionHierarchy['levels'][number]) =>
  level.rooms.reduce((sum, rm) => sum + (rm.item_indices?.length || 0), 0);

const ExtractionHierarchyView: React.FC<ExtractionHierarchyViewProps> = ({ items, hierarchy }) => {
  if (!hierarchy) {
    return (
      <Table
        size="small"
        rowKey={(row) => row.id}
        pagination={{ pageSize: 6 }}
        dataSource={items}
        columns={[
          { title: 'Room', dataIndex: 'room', key: 'room', width: 180 },
          ...columns,
        ]}
      />
    );
  }

  const levelTabs = (hierarchy.levels || []).map((level, li) => ({
    key: `lv-${li}-${level.name}`,
    label: `${level.name} (${countLevelItems(level)})`,
    children: (
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        {level.rooms.map((room, ri) => (
          <Card
            key={`room-${li}-${ri}-${room.name}`}
            size="small"
            title={
              <Space>
                <Text strong>{room.name}</Text>
                {room.height_ft && <Tag color="blue">{room.height_ft} ft</Tag>}
                {room.totals?.rcv != null && <Tag color="green">RCV: {fmt(room.totals.rcv)}</Tag>}
                {room.totals?.acv != null && <Tag color="cyan">ACV: {fmt(room.totals.acv)}</Tag>}
              </Space>
            }
          >
            {renderDimensionTags(room.dimensions)}
            <Table
              style={{ marginTop: 8 }}
              size="small"
              rowKey={(row) => row.id}
              pagination={false}
              dataSource={pickItemsByIndices(items, room.item_indices)}
              columns={columns}
            />
          </Card>
        ))}
        {renderTotals(level.level_totals)}
      </Space>
    ),
  }));

  const sectionTabs = (hierarchy.sections || []).map((sec, si) => ({
    key: `sec-${si}-${sec.name}`,
    label: `${sec.name} (${sec.item_indices?.length || 0})`,
    children: (
      <Card size="small">
        <Table
          size="small"
          rowKey={(row) => row.id}
          pagination={false}
          dataSource={pickItemsByIndices(items, sec.item_indices)}
          columns={columns}
        />
        {renderTotals(sec.totals)}
      </Card>
    ),
  }));

  const unassignedCount = hierarchy.unassigned_item_indices?.length || 0;
  const unassignedTab = unassignedCount > 0
    ? [{
        key: 'unassigned',
        label: `Unassigned (${unassignedCount})`,
        children: (
          <Card size="small">
            <Table
              size="small"
              rowKey={(row) => row.id}
              pagination={{ pageSize: 8 }}
              dataSource={pickItemsByIndices(items, hierarchy.unassigned_item_indices || [])}
              columns={[
                { title: 'Room', dataIndex: 'room', key: 'room', width: 180 },
                ...columns,
              ]}
            />
          </Card>
        ),
      }]
    : [];

  return <Tabs items={[...levelTabs, ...sectionTabs, ...unassignedTab]} />;
};

export default ExtractionHierarchyView;
