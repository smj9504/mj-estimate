import React, { useState } from 'react';
import { Button, Divider, Grid, List, Modal, Space, Spin, Tag, Typography } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { repairSpecService } from '../../services/repairSpecService';
import { AppliedLineItem, RepairTemplateDetail } from '../../types/repairSpec';
import ConditionCheckList from './ConditionCheckList';

const { Text } = Typography;
const { useBreakpoint } = Grid;

interface TemplateApplyModalProps {
  template: RepairTemplateDetail;
  open: boolean;
  onClose: () => void;
  onApply: (items: AppliedLineItem[]) => void;
}

const TemplateApplyModal: React.FC<TemplateApplyModalProps> = ({
  template,
  open,
  onClose,
  onApply,
}) => {
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [appliedItems, setAppliedItems] = useState<AppliedLineItem[]>([]);

  const applyMutation = useMutation({
    mutationFn: () =>
      repairSpecService.applyTemplate(template.id, Array.from(checkedIds)),
    onSuccess: (data) => {
      setAppliedItems(data.items);
    },
  });

  const handleCheckedChange = (ids: Set<string>) => {
    setCheckedIds(ids);
    setAppliedItems([]);
  };

  const handlePreview = () => {
    if (checkedIds.size > 0) {
      applyMutation.mutate();
    }
  };

  const handleApply = () => {
    onApply(appliedItems);
    onClose();
    setCheckedIds(new Set());
    setAppliedItems([]);
  };

  return (
    <Modal
      title={`Apply "${template.name}"`}
      open={open}
      onCancel={onClose}
      width={isMobile ? '95%' : 640}
      footer={
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button onClick={handlePreview} disabled={checkedIds.size === 0}>
            Preview Items
          </Button>
          <Button
            type="primary"
            onClick={handleApply}
            disabled={appliedItems.length === 0}
          >
            Add to Estimate ({appliedItems.length})
          </Button>
        </Space>
      }
    >
      <Text strong>Check conditions that apply:</Text>
      <div style={{ margin: '12px 0' }}>
        <ConditionCheckList
          conditions={template.conditions}
          suggestions={template.suggestions}
          checkedIds={checkedIds}
          onChange={handleCheckedChange}
        />
      </div>

      {applyMutation.isPending && (
        <div style={{ textAlign: 'center', padding: 16 }}>
          <Spin />
        </div>
      )}

      {appliedItems.length > 0 && (
        <>
          <Divider style={{ margin: '12px 0' }} />
          <Text strong>Selected Items ({appliedItems.length}):</Text>
          <List
            size="small"
            style={{ marginTop: 8 }}
            dataSource={appliedItems}
            renderItem={(item) => (
              <List.Item>
                <Space direction="vertical" size={0} style={{ width: '100%' }}>
                  <Space>
                    <Text>{item.description}</Text>
                    <Tag color={item.condition_scope === 'affected' ? 'blue' : 'red'}>
                      {item.condition_scope}
                    </Tag>
                  </Space>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {item.xactimate_item_code}
                    {item.unit ? ` · ${item.unit}` : ''}
                    {item.unit_price != null ? ` · $${item.unit_price.toFixed(2)}` : ''}
                    {' · '}{item.condition_name}
                  </Text>
                </Space>
              </List.Item>
            )}
          />
        </>
      )}
    </Modal>
  );
};

export default TemplateApplyModal;
