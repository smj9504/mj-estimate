import React from 'react';
import { Card, Grid, List, Space, Table, Tabs, Tag, Typography } from 'antd';
import { ExtractionHierarchy, ExtractionTotals, InsuranceExtractionItem } from '../../types/insuranceExtraction';

const { Text } = Typography;
const { useBreakpoint } = Grid;

interface ExtractionHierarchyViewProps {
  items: InsuranceExtractionItem[];
  hierarchy?: ExtractionHierarchy;
}

const fmt = (v?: number | null) =>
  v != null
    ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : null;

const columns = [
  { title: 'Line Item', dataIndex: 'line_item', key: 'line_item', ellipsis: true },
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
    <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
      <Space size={[6, 6]} wrap>
        {heightFt ? <Tag color="blue">Height: {heightFt} ft</Tag> : null}
        {entries.map(([k, v]) => (
          <Tag key={k} style={{ fontSize: 12 }}>{`${k}: ${v}`}</Tag>
        ))}
      </Space>
    </div>
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

/** Mobile card for a single line item */
const MobileItemCard: React.FC<{ item: InsuranceExtractionItem }> = ({ item }) => (
  <div style={{
    padding: '10px 0',
    borderBottom: '1px solid #f0f0f0',
  }}>
    <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>
      {item.line_item}
    </Text>
    {item.notes && (
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
        {item.notes}
      </Text>
    )}
    <Space size={[8, 4]} wrap>
      {item.quantity != null && (
        <Tag>{Number(item.quantity).toFixed(2)} {item.unit || ''}</Tag>
      )}
      {item.unit_price != null && (
        <Tag color="blue">{fmt(item.unit_price)}</Tag>
      )}
      {item.confidence != null && (
        <Tag color={Number(item.confidence) >= 0.9 ? 'green' : 'orange'}>
          {Number(item.confidence).toFixed(2)}
        </Tag>
      )}
    </Space>
  </div>
);

/** Responsive item list — List on mobile, Table on desktop */
const ItemDisplay: React.FC<{
  items: InsuranceExtractionItem[];
  isMobile: boolean;
  extraColumns?: typeof columns;
  paginate?: boolean;
}> = ({ items, isMobile, extraColumns, paginate }) => {
  if (isMobile) {
    return (
      <List
        size="small"
        dataSource={items}
        renderItem={(item) => <MobileItemCard item={item} />}
        locale={{ emptyText: 'No data' }}
      />
    );
  }
  return (
    <Table
      style={{ marginTop: 8 }}
      size="small"
      rowKey={(row) => row.id}
      pagination={paginate ? { pageSize: 8 } : false}
      scroll={{ x: 700 }}
      dataSource={items}
      columns={extraColumns ? [...extraColumns, ...columns] : columns}
    />
  );
};

const RoomTitle: React.FC<{
  name: string;
  heightFt?: number | null;
  totals?: ExtractionTotals;
}> = ({ name, heightFt, totals }) => (
  <Space size={[6, 4]} wrap style={{ lineHeight: 1.6 }}>
    <Text strong>{name}</Text>
    {heightFt && <Tag color="blue">{heightFt} ft</Tag>}
    {totals?.rcv != null && <Tag color="green">RCV: {fmt(totals.rcv)}</Tag>}
    {totals?.acv != null && <Tag color="cyan">ACV: {fmt(totals.acv)}</Tag>}
  </Space>
);

const ExtractionHierarchyView: React.FC<ExtractionHierarchyViewProps> = ({ items, hierarchy }) => {
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  if (!hierarchy) {
    return (
      <ItemDisplay
        items={items}
        isMobile={isMobile}
        extraColumns={[{ title: 'Room', dataIndex: 'room', key: 'room', width: 180 }]}
        paginate
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
            title={<RoomTitle name={room.name} heightFt={room.height_ft} totals={room.totals} />}
            styles={{ header: { padding: isMobile ? '8px 12px' : undefined } }}
          >
            {renderDimensionTags(room.dimensions)}
            <ItemDisplay
              items={pickItemsByIndices(items, room.item_indices)}
              isMobile={isMobile}
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
        <ItemDisplay
          items={pickItemsByIndices(items, sec.item_indices)}
          isMobile={isMobile}
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
            <ItemDisplay
              items={pickItemsByIndices(items, hierarchy.unassigned_item_indices || [])}
              isMobile={isMobile}
              extraColumns={[{ title: 'Room', dataIndex: 'room', key: 'room', width: 180 }]}
              paginate
            />
          </Card>
        ),
      }]
    : [];

  return (
    <Tabs
      items={[...levelTabs, ...sectionTabs, ...unassignedTab]}
      tabPosition={isMobile ? 'top' : 'top'}
      size={isMobile ? 'small' : 'middle'}
    />
  );
};

export default ExtractionHierarchyView;
