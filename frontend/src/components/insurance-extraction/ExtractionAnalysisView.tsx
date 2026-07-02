import React from 'react';
import { Alert, Badge, Card, Collapse, Grid, List, Space, Spin, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { insuranceExtractionService } from '../../services/insuranceExtractionService';
import {
  CategorizedItem,
  ExtractionAnalysisResponse,
  RoomAnalysis,
  SectionAnalysis,
  SurfaceCategoryType,
} from '../../types/insuranceExtraction';

const { Text } = Typography;
const { useBreakpoint } = Grid;

// ── Constants ──

const SURFACE_ORDER: SurfaceCategoryType[] = ['wall', 'floor', 'ceiling', 'general'];

const SURFACE_CONFIG: Record<SurfaceCategoryType, { label: string; color: string }> = {
  wall: { label: 'Wall', color: 'blue' },
  floor: { label: 'Floor', color: 'green' },
  ceiling: { label: 'Ceiling', color: 'orange' },
  general: { label: 'General', color: 'default' },
};

const fmt = (v?: number | null) =>
  v != null
    ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : null;

// ── Sub-components ──

const MobileItem: React.FC<{ item: CategorizedItem }> = ({ item }) => (
  <div style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
    <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>
      {item.line_item}
    </Text>
    <Space size={[8, 4]} wrap>
      {item.quantity != null && (
        <Tag>{Number(item.quantity).toFixed(2)} {item.unit || ''}</Tag>
      )}
      {item.unit_price != null && <Tag color="blue">{fmt(item.unit_price)}</Tag>}
    </Space>
  </div>
);

const ItemTable: React.FC<{ items: CategorizedItem[]; isMobile: boolean }> = ({ items, isMobile }) => {
  if (!items.length) return null;

  if (isMobile) {
    return (
      <List
        size="small"
        dataSource={items}
        renderItem={(item) => <MobileItem item={item} />}
      />
    );
  }

  return (
    <Table
      size="small"
      rowKey="item_id"
      pagination={false}
      scroll={{ x: 500 }}
      dataSource={items}
      columns={[
        { title: 'Line Item', dataIndex: 'line_item', key: 'line_item', ellipsis: true },
        {
          title: 'Qty',
          dataIndex: 'quantity',
          key: 'quantity',
          width: 90,
          render: (v: number | null) => v != null ? Number(v).toFixed(2) : '—',
        },
        { title: 'Unit', dataIndex: 'unit', key: 'unit', width: 70 },
        {
          title: 'Unit Price',
          dataIndex: 'unit_price',
          key: 'unit_price',
          width: 110,
          render: (v: number | null) => fmt(v) || '—',
        },
      ]}
    />
  );
};

const SurfaceSection: React.FC<{
  category: SurfaceCategoryType;
  items: CategorizedItem[];
  isMobile: boolean;
}> = ({ category, items, isMobile }) => {
  const cfg = SURFACE_CONFIG[category];
  return (
    <div style={{ marginBottom: 12 }}>
      <Space style={{ marginBottom: 4 }}>
        <Tag color={cfg.color}>{cfg.label}</Tag>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {items.length} item{items.length !== 1 ? 's' : ''}
        </Text>
      </Space>
      {items.length > 0 ? (
        <ItemTable items={items} isMobile={isMobile} />
      ) : (
        <Text type="secondary" italic style={{ display: 'block', fontSize: 12, marginLeft: 8 }}>
          No {cfg.label.toLowerCase()} items
        </Text>
      )}
    </div>
  );
};

const DimensionTags: React.FC<{ dimensions?: Record<string, number>; heightFt?: number | null }> = ({
  dimensions,
  heightFt,
}) => {
  const entries = Object.entries(dimensions || {});
  if (!entries.length && !heightFt) return null;
  return (
    <div style={{ overflowX: 'auto', paddingBottom: 4, marginBottom: 8 }}>
      <Space size={[6, 6]} wrap>
        {heightFt ? <Tag color="blue">Height: {heightFt} ft</Tag> : null}
        {entries.map(([k, v]) => (
          <Tag key={k} style={{ fontSize: 12 }}>{`${k}: ${v}`}</Tag>
        ))}
      </Space>
    </div>
  );
};

const RoomCard: React.FC<{ room: RoomAnalysis; isMobile: boolean }> = ({ room, isMobile }) => {
  const surfaceCounts = SURFACE_ORDER
    .map((cat) => {
      const count = (room.items_by_surface[cat] || []).length;
      return count > 0 ? `${SURFACE_CONFIG[cat].label}: ${count}` : null;
    })
    .filter(Boolean);

  return (
    <div>
      <DimensionTags dimensions={room.dimensions} heightFt={room.height_ft} />
      {SURFACE_ORDER.map((cat) => {
        const items = room.items_by_surface[cat] || [];
        // Skip empty general if other categories have items
        if (cat === 'general' && items.length === 0 && room.item_count > 0) return null;
        return (
          <SurfaceSection
            key={cat}
            category={cat}
            items={items}
            isMobile={isMobile}
          />
        );
      })}
    </div>
  );
};

const SummaryBar: React.FC<{ summary: ExtractionAnalysisResponse['summary']; roomCount: number }> = ({
  summary,
  roomCount,
}) => (
  <Space size={[12, 8]} wrap style={{ marginBottom: 16 }}>
    <Tag>{roomCount} Room{roomCount !== 1 ? 's' : ''}</Tag>
    <Tag>{summary.total_items} Total Items</Tag>
    {SURFACE_ORDER.map((cat) => {
      const count = summary.by_category[cat] || 0;
      if (!count) return null;
      return (
        <Tag key={cat} color={SURFACE_CONFIG[cat].color}>
          {SURFACE_CONFIG[cat].label}: {count}
        </Tag>
      );
    })}
  </Space>
);

// ── Main component ──

interface ExtractionAnalysisViewProps {
  extractionId: string;
}

const ExtractionAnalysisView: React.FC<ExtractionAnalysisViewProps> = ({ extractionId }) => {
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const { data, isLoading, error } = useQuery<ExtractionAnalysisResponse>({
    queryKey: ['insurance-extraction-analysis', extractionId],
    queryFn: () => insuranceExtractionService.getAnalysis(extractionId),
    enabled: !!extractionId,
  });

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 32 }}>
        <Spin />
      </div>
    );
  }

  if (error || !data) {
    return <Alert type="error" message="Failed to load analysis" />;
  }

  const { rooms, sections, unassigned_items, summary } = data;

  // Build collapse items for rooms
  const roomItems = rooms.map((room, idx) => ({
    key: `room-${idx}`,
    label: (
      <Space size={[8, 4]} wrap>
        <Text strong>{room.room_name}</Text>
        {room.level_name && <Text type="secondary" style={{ fontSize: 12 }}>({room.level_name})</Text>}
        <Badge count={room.item_count} style={{ backgroundColor: '#1890ff' }} />
      </Space>
    ),
    children: <RoomCard room={room} isMobile={isMobile} />,
  }));

  // Section collapse items
  const sectionItems = sections.map((sec, idx) => ({
    key: `sec-${idx}`,
    label: (
      <Space size={[8, 4]} wrap>
        <Text strong>{sec.section_name}</Text>
        <Badge count={sec.item_count} style={{ backgroundColor: '#52c41a' }} />
      </Space>
    ),
    children: (
      <div>
        {SURFACE_ORDER.map((cat) => {
          const items = sec.items_by_surface[cat] || [];
          if (!items.length) return null;
          return <SurfaceSection key={cat} category={cat} items={items} isMobile={isMobile} />;
        })}
      </div>
    ),
  }));

  // Unassigned items
  const unassignedCount = Object.values(unassigned_items).reduce(
    (sum, arr) => sum + (arr?.length || 0),
    0,
  );
  const unassignedItem = unassignedCount > 0
    ? [{
        key: 'unassigned',
        label: (
          <Space>
            <Text strong>Unassigned</Text>
            <Badge count={unassignedCount} style={{ backgroundColor: '#faad14' }} />
          </Space>
        ),
        children: (
          <div>
            {SURFACE_ORDER.map((cat) => {
              const items = unassigned_items[cat] || [];
              if (!items.length) return null;
              return <SurfaceSection key={cat} category={cat} items={items} isMobile={isMobile} />;
            })}
          </div>
        ),
      }]
    : [];

  const allCollapseItems = [...roomItems, ...sectionItems, ...unassignedItem];

  // Default open first room
  const defaultActive = roomItems.length > 0 ? [roomItems[0].key] : [];

  return (
    <div>
      <SummaryBar summary={summary} roomCount={rooms.length} />
      {allCollapseItems.length > 0 ? (
        <Collapse
          defaultActiveKey={defaultActive}
          items={allCollapseItems}
          size={isMobile ? 'small' : 'middle'}
        />
      ) : (
        <Alert type="info" message="No items to analyze" />
      )}
    </div>
  );
};

export default ExtractionAnalysisView;
