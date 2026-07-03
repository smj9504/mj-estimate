import React, { useState } from 'react';
import {
  Button, Card, Divider, Grid, Select, Space, Spin, Tag, Typography,
} from 'antd';
import { CheckCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { repairSpecService } from '../../services/repairSpecService';
import {
  AppliedLineItem,
  RepairTemplateDetail,
  RepairTemplateListItem,
  TemplateCompareResponse,
} from '../../types/repairSpec';
import ConditionCheckList from './ConditionCheckList';
import TemplateCompareView from './TemplateCompareView';

const { Text, Title } = Typography;
const { useBreakpoint } = Grid;

export interface RoomEstimateItem {
  xactimate_item_code: string;
  description: string;
  unit?: string | null;
  unit_price?: number | null;
  quantity?: number | null;
  condition_name: string;
  condition_scope: string;
  room_name: string;
  source: 'extraction' | 'template' | 'manual';
}

interface RoomComparePanelProps {
  roomName: string;
  extractionId: string;
  onItemsConfirmed: (roomName: string, items: RoomEstimateItem[]) => void;
  confirmed?: boolean;
}

const RoomComparePanel: React.FC<RoomComparePanelProps> = ({
  roomName,
  extractionId,
  onItemsConfirmed,
  confirmed = false,
}) => {
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [compareResult, setCompareResult] = useState<TemplateCompareResponse | null>(null);
  const [roomItems, setRoomItems] = useState<RoomEstimateItem[]>([]);

  // Load template list
  const { data: templateList = [] } = useQuery<RepairTemplateListItem[]>({
    queryKey: ['repair-templates-all'],
    queryFn: () => repairSpecService.listTemplates(),
  });

  // Load selected template detail
  const { data: templateDetail } = useQuery<RepairTemplateDetail>({
    queryKey: ['repair-template', selectedTemplateId],
    queryFn: () => repairSpecService.getTemplate(selectedTemplateId!),
    enabled: !!selectedTemplateId,
  });

  // Compare mutation
  const compareMutation = useMutation({
    mutationFn: () =>
      repairSpecService.compareTemplate(
        selectedTemplateId!,
        Array.from(checkedIds),
        extractionId,
        roomName,
      ),
    onSuccess: (data) => {
      setCompareResult(data);
      // Build initial room items from matched + extraction extras
      const items: RoomEstimateItem[] = [];
      for (const m of data.matched) {
        items.push({
          xactimate_item_code: m.template_item.xactimate_item_code,
          description: (m.extraction_item.line_item as string) || m.template_item.description,
          unit: (m.extraction_item.unit as string) || m.template_item.unit,
          unit_price: (m.extraction_item.unit_price as number) ?? m.template_item.unit_price,
          quantity: (m.extraction_item.quantity as number) ?? null,
          condition_name: m.template_item.condition_name,
          condition_scope: m.template_item.condition_scope,
          room_name: roomName,
          source: 'extraction',
        });
      }
      for (const e of data.extra) {
        items.push({
          xactimate_item_code: '',
          description: (e.line_item as string) || '',
          unit: e.unit as string,
          unit_price: e.unit_price as number,
          quantity: e.quantity as number,
          condition_name: '',
          condition_scope: 'damaged',
          room_name: roomName,
          source: 'extraction',
        });
      }
      setRoomItems(items);
    },
  });

  const handleCompare = () => {
    if (selectedTemplateId && checkedIds.size > 0) {
      compareMutation.mutate();
    }
  };

  const handleAddMissing = (item: AppliedLineItem) => {
    setRoomItems((prev) => [
      ...prev,
      {
        xactimate_item_code: item.xactimate_item_code,
        description: item.description,
        unit: item.unit,
        unit_price: item.unit_price,
        quantity: null,
        condition_name: item.condition_name,
        condition_scope: item.condition_scope,
        room_name: roomName,
        source: 'template',
      },
    ]);
    // Update compare result to move from missing to matched
    if (compareResult) {
      setCompareResult({
        ...compareResult,
        missing: compareResult.missing.filter(
          (m) => m.xactimate_item_code !== item.xactimate_item_code
        ),
        matched: [
          ...compareResult.matched,
          {
            template_item: item,
            extraction_item: { line_item: item.description, unit: item.unit },
            status: 'ok',
          },
        ],
      });
    }
  };

  const handleAddAllMissing = (items: AppliedLineItem[]) => {
    items.forEach(handleAddMissing);
  };

  const handleConfirm = () => {
    onItemsConfirmed(roomName, roomItems);
  };

  if (confirmed) {
    return (
      <Card size="small" style={{ borderColor: '#52c41a' }}>
        <Space>
          <CheckCircleOutlined style={{ color: '#52c41a' }} />
          <Text strong>{roomName}</Text>
          <Tag color="success">{roomItems.length} items confirmed</Tag>
        </Space>
      </Card>
    );
  }

  return (
    <Card
      size={isMobile ? 'small' : 'default'}
      title={
        <Space>
          <Text strong>{roomName}</Text>
          {roomItems.length > 0 && <Tag>{roomItems.length} items</Tag>}
        </Space>
      }
    >
      {/* Step A: Select Template */}
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <div>
          <Text strong style={{ display: 'block', marginBottom: 4 }}>Template:</Text>
          <Select
            placeholder="Select a repair template"
            value={selectedTemplateId}
            onChange={(v) => {
              setSelectedTemplateId(v);
              setCheckedIds(new Set());
              setCompareResult(null);
            }}
            style={{ width: isMobile ? '100%' : 300 }}
            size={isMobile ? 'small' : 'middle'}
            showSearch
            optionFilterProp="label"
            options={templateList.map((t) => ({
              value: t.id,
              label: `${t.name}${t.surface ? ` (${t.surface})` : ''}`,
            }))}
          />
        </div>

        {/* Step B: Check Conditions */}
        {templateDetail && (
          <div>
            <Text strong style={{ display: 'block', marginBottom: 4 }}>Conditions:</Text>
            <ConditionCheckList
              conditions={templateDetail.conditions}
              suggestions={templateDetail.suggestions}
              checkedIds={checkedIds}
              onChange={setCheckedIds}
            />
            <Button
              type="primary"
              size="small"
              style={{ marginTop: 8 }}
              disabled={checkedIds.size === 0}
              loading={compareMutation.isPending}
              onClick={handleCompare}
            >
              Compare with Extraction
            </Button>
          </div>
        )}

        {/* Step C: Compare Results */}
        {compareResult && (
          <>
            <Divider style={{ margin: '8px 0' }} />
            <TemplateCompareView
              compareResult={compareResult}
              onAddMissing={handleAddMissing}
              onAddAllMissing={handleAddAllMissing}
            />
            <Divider style={{ margin: '8px 0' }} />
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              onClick={handleConfirm}
            >
              Confirm Room ({roomItems.length} items)
            </Button>
          </>
        )}
      </Space>
    </Card>
  );
};

export default RoomComparePanel;
