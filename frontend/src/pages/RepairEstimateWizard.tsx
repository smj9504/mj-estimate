import React, { useMemo, useState } from 'react';
import {
  Alert, Button, Card, Collapse, Divider, Form, Grid, Input, List, Result,
  Select, Space, Spin, Steps, Table, Tag, Typography, message,
} from 'antd';
import {
  ArrowLeftOutlined, ArrowRightOutlined, CheckCircleOutlined,
  FileTextOutlined, SearchOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { insuranceExtractionService } from '../services/insuranceExtractionService';
import { estimateService } from '../services/estimateService';
import {
  ExtractionHierarchy,
  InsuranceExtraction,
  InsuranceExtractionSummary,
} from '../types/insuranceExtraction';
import RoomComparePanel, {
  RoomEstimateItem,
} from '../components/repair-spec/RoomComparePanel';

const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

const RepairEstimateWizard: React.FC = () => {
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const navigate = useNavigate();

  const [currentStep, setCurrentStep] = useState(0);
  const [selectedExtractionId, setSelectedExtractionId] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [confirmedRooms, setConfirmedRooms] = useState<Map<string, RoomEstimateItem[]>>(new Map());
  const [isCreating, setIsCreating] = useState(false);

  // ── Step 1: Load extraction list ──
  const { data: extractions = [], isLoading: loadingList } = useQuery<InsuranceExtractionSummary[]>({
    queryKey: ['insurance-extractions-list'],
    queryFn: () => insuranceExtractionService.listExtractions(),
  });

  // ── Step 1 → 2: Load selected extraction detail ──
  const { data: extraction, isLoading: loadingDetail } = useQuery<InsuranceExtraction>({
    queryKey: ['insurance-extraction', selectedExtractionId],
    queryFn: () => insuranceExtractionService.getExtraction(selectedExtractionId!),
    enabled: !!selectedExtractionId,
  });

  // Extract rooms from hierarchy
  const rooms = useMemo(() => {
    if (!extraction?.parser_metadata?.hierarchy) return [];
    const hierarchy = extraction.parser_metadata.hierarchy as ExtractionHierarchy;
    const result: Array<{ name: string; level: string; itemCount: number }> = [];
    for (const level of hierarchy.levels || []) {
      for (const room of level.rooms || []) {
        result.push({
          name: room.name,
          level: level.name,
          itemCount: room.item_indices?.length || 0,
        });
      }
    }
    return result;
  }, [extraction]);

  // ── Step 1 handlers ──
  const handleSelectExtraction = (id: string) => {
    setSelectedExtractionId(id);
    // Try to get address from extraction metadata
    const ext = extractions.find((e) => e.id === id);
    const header = ext?.parser_metadata?.header as Record<string, unknown> | undefined;
    if (header?.address) setAddress(String(header.address));
  };

  const canGoToStep2 = !!selectedExtractionId && !!extraction;

  // ── Step 2 handlers ──
  const handleRoomConfirmed = (roomName: string, items: RoomEstimateItem[]) => {
    setConfirmedRooms((prev) => {
      const next = new Map(prev);
      next.set(roomName, items);
      return next;
    });
  };

  const allRoomsConfirmed = rooms.length > 0 && rooms.every((r) => confirmedRooms.has(r.name));

  // ── Step 3: Create estimate ──
  const allItems = useMemo(() => {
    const items: RoomEstimateItem[] = [];
    confirmedRooms.forEach((roomItems) => items.push(...roomItems));
    return items;
  }, [confirmedRooms]);

  const handleCreateEstimate = async () => {
    if (allItems.length === 0) {
      message.warning('No items to create estimate');
      return;
    }

    setIsCreating(true);
    try {
      const estimateItems = allItems.map((item, idx) => ({
        name: item.description,
        description: item.xactimate_item_code ? `Xactimate: ${item.xactimate_item_code}` : '',
        quantity: item.quantity || 1,
        unit: item.unit || 'EA',
        unit_price: item.unit_price || 0,
        total: (item.quantity || 1) * (item.unit_price || 0),
        primary_group: item.room_name,
        sort_order: idx,
      }));

      const payload = {
        estimate_number: '',
        estimate_type: 'insurance' as const,
        client_name: '',
        client_address: address,
        items: estimateItems,
      };

      const result = await estimateService.createEstimate(payload);
      message.success('Estimate created');
      navigate(`/estimates/${result.id}/edit`);
    } catch (err) {
      message.error('Failed to create estimate');
    } finally {
      setIsCreating(false);
    }
  };

  // ── Render steps ──

  const renderStep1 = () => (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <div>
        <Text strong style={{ display: 'block', marginBottom: 8 }}>
          Select an insurance extraction:
        </Text>
        {loadingList ? (
          <Spin />
        ) : (
          <List
            size="small"
            bordered
            dataSource={extractions}
            renderItem={(ext) => {
              const header = ext.parser_metadata?.header as Record<string, unknown> | undefined;
              const label = header?.estimate_id
                ? String(header.estimate_id)
                : header?.insured
                  ? String(header.insured)
                  : ext.id.slice(0, 8);
              const isSelected = selectedExtractionId === ext.id;

              return (
                <List.Item
                  style={{
                    cursor: 'pointer',
                    backgroundColor: isSelected ? '#e6f7ff' : undefined,
                  }}
                  onClick={() => handleSelectExtraction(ext.id)}
                >
                  <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                    <Space>
                      {isSelected && <CheckCircleOutlined style={{ color: '#1890ff' }} />}
                      <Text strong={isSelected}>{label}</Text>
                      {ext.carrier && <Tag>{ext.carrier}</Tag>}
                    </Space>
                    <Text type="secondary">{ext.item_count} items</Text>
                  </Space>
                </List.Item>
              );
            }}
          />
        )}
      </div>

      {selectedExtractionId && (
        <div>
          <Text strong style={{ display: 'block', marginBottom: 4 }}>Address:</Text>
          <Input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Job address"
            style={{ maxWidth: 400 }}
          />
        </div>
      )}
    </Space>
  );

  const renderStep2 = () => {
    if (loadingDetail) {
      return <div style={{ textAlign: 'center', padding: 32 }}><Spin size="large" /></div>;
    }
    if (!extraction) {
      return <Alert type="warning" message="No extraction selected" />;
    }

    return (
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Text type="secondary">
          Select a template and check conditions for each room. Confirm when done.
        </Text>

        {rooms.map((room) => (
          <RoomComparePanel
            key={room.name}
            roomName={room.name}
            extractionId={extraction.id}
            onItemsConfirmed={handleRoomConfirmed}
            confirmed={confirmedRooms.has(room.name)}
          />
        ))}

        {rooms.length === 0 && (
          <Alert type="info" message="No rooms found in extraction hierarchy" />
        )}
      </Space>
    );
  };

  const renderStep3 = () => {
    // Group items by room
    const byRoom = new Map<string, RoomEstimateItem[]>();
    allItems.forEach((item) => {
      if (!byRoom.has(item.room_name)) byRoom.set(item.room_name, []);
      byRoom.get(item.room_name)!.push(item);
    });

    return (
      <Space direction="vertical" style={{ width: '100%' }} size={16}>
        {address && (
          <Card size="small">
            <Text strong>Address: </Text>
            <Text>{address}</Text>
          </Card>
        )}

        <Text strong>Total: {allItems.length} items across {byRoom.size} rooms</Text>

        <Collapse
          defaultActiveKey={Array.from(byRoom.keys())}
          items={Array.from(byRoom.entries()).map(([roomName, items]) => ({
            key: roomName,
            label: (
              <Space>
                <Text strong>{roomName}</Text>
                <Tag>{items.length} items</Tag>
              </Space>
            ),
            children: (
              <Table
                size="small"
                rowKey={(_, i) => `${roomName}-${i}`}
                pagination={false}
                scroll={{ x: 500 }}
                dataSource={items}
                columns={[
                  {
                    title: 'Scope',
                    key: 'scope',
                    width: 80,
                    render: (_, row: RoomEstimateItem) => (
                      <Tag
                        color={row.condition_scope === 'affected' ? 'blue' : 'red'}
                        style={{ fontSize: 11 }}
                      >
                        {row.condition_scope.toUpperCase()}
                      </Tag>
                    ),
                  },
                  {
                    title: 'Line Item',
                    dataIndex: 'description',
                    key: 'description',
                    ellipsis: true,
                  },
                  {
                    title: 'Code',
                    dataIndex: 'xactimate_item_code',
                    key: 'code',
                    width: 70,
                    render: (v: string) => v || '—',
                  },
                  {
                    title: 'Qty',
                    dataIndex: 'quantity',
                    key: 'qty',
                    width: 70,
                    render: (v: number | null) => v != null ? Number(v).toFixed(2) : '—',
                  },
                  {
                    title: 'Unit',
                    dataIndex: 'unit',
                    key: 'unit',
                    width: 60,
                  },
                  {
                    title: 'Source',
                    dataIndex: 'source',
                    key: 'source',
                    width: 80,
                    render: (v: string) => (
                      <Tag color={v === 'template' ? 'green' : 'default'} style={{ fontSize: 11 }}>
                        {v}
                      </Tag>
                    ),
                  },
                ]}
              />
            ),
          }))}
        />

        <Button
          type="primary"
          size="large"
          icon={<FileTextOutlined />}
          loading={isCreating}
          onClick={handleCreateEstimate}
          disabled={allItems.length === 0}
        >
          Create Estimate ({allItems.length} items)
        </Button>
      </Space>
    );
  };

  const steps = [
    { title: 'Extraction', description: isMobile ? '' : 'Select source' },
    { title: 'Compare', description: isMobile ? '' : 'Room by room' },
    { title: 'Review', description: isMobile ? '' : 'Create estimate' },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/repair-templates')}
          size={isMobile ? 'small' : 'middle'}
        >
          {isMobile ? '' : 'Back'}
        </Button>
        <Title level={isMobile ? 4 : 3} style={{ margin: 0 }}>
          Repair Estimate Wizard
        </Title>
      </Space>

      <Card size={isMobile ? 'small' : 'default'}>
        <Steps
          current={currentStep}
          items={steps}
          size={isMobile ? 'small' : 'default'}
          style={{ marginBottom: 24 }}
        />

        {currentStep === 0 && renderStep1()}
        {currentStep === 1 && renderStep2()}
        {currentStep === 2 && renderStep3()}

        <Divider />

        <Space style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Button
            disabled={currentStep === 0}
            onClick={() => setCurrentStep((s) => s - 1)}
            icon={<ArrowLeftOutlined />}
          >
            Previous
          </Button>
          {currentStep < 2 && (
            <Button
              type="primary"
              disabled={
                (currentStep === 0 && !canGoToStep2) ||
                (currentStep === 1 && confirmedRooms.size === 0)
              }
              onClick={() => setCurrentStep((s) => s + 1)}
            >
              Next <ArrowRightOutlined />
            </Button>
          )}
        </Space>
      </Card>
    </div>
  );
};

export default RepairEstimateWizard;
