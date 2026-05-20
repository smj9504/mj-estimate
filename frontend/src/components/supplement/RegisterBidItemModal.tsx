/**
 * RegisterBidItemModal
 * Used from estimate detail pages to register an estimate as a bid item on a supplement request.
 */

import React from 'react';
import { Modal, Form, Select, Input, InputNumber, message, Typography } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supplementService } from '../../services/supplementService';
import type { BidItemType } from '../../types/supplement';

const { Text } = Typography;

const ESTIMATE_ID_FIELD: Partial<Record<BidItemType, string>> = {
  bathroom: 'bathroom_estimate_id',
  cabinet: 'cabinet_estimate_id',
  packing: 'pack_calculation_id',
  roofing: 'roofing_estimate_id',
};

const TYPE_LABELS: Record<BidItemType, string> = {
  xactimate: 'Xactimate',
  bathroom: 'Bathroom Estimate',
  cabinet: 'Cabinet Estimate',
  packing: 'Packing Estimate',
  roofing: 'Roofing Estimate',
  kitchen: 'Kitchen Estimate',
  flooring: 'Flooring Estimate',
  other: 'Other',
};

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  estimateType: BidItemType;
  estimateId: string;
  claimId?: string | null;
  defaultTitle?: string;
  defaultAmount?: number;
}

const RegisterBidItemModal: React.FC<Props> = ({
  open, onClose, onSuccess, estimateType, estimateId, claimId, defaultTitle, defaultAmount,
}) => {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const { data: supplements = [], isLoading } = useQuery({
    queryKey: ['supplements-for-bid-picker', claimId],
    queryFn: () => claimId
      ? supplementService.list({ claim_id: claimId, page_size: 100 })
      : supplementService.list({ page_size: 100 }),
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: ({ supplementId, data }: { supplementId: string; data: any }) =>
      supplementService.createBidItem(supplementId, data),
    onSuccess: () => {
      message.success('Registered as bid item');
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['supplements'] });
      queryClient.invalidateQueries({ queryKey: ['supplement-stats'] });
      onSuccess?.();
      onClose();
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Failed to register'),
  });

  const handleOk = async () => {
    const values = await form.validateFields();
    const idField = ESTIMATE_ID_FIELD[estimateType];
    createMutation.mutate({
      supplementId: values.supplement_id,
      data: {
        supplement_id: values.supplement_id,
        estimate_type: estimateType,
        title: values.title,
        custom_amount: values.custom_amount,
        description: values.description,
        ...(idField ? { [idField]: estimateId } : {}),
      },
    });
  };

  const handleCancel = () => {
    form.resetFields();
    onClose();
  };

  return (
    <Modal
      title={`Register as Bid Item — ${TYPE_LABELS[estimateType]}`}
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      confirmLoading={createMutation.isPending}
      okText="Register"
      width={460}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        size="small"
        initialValues={{ title: defaultTitle, custom_amount: defaultAmount }}
      >
        {supplements.length === 0 && !isLoading && (
          <Text type="warning" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
            No supplement requests found{claimId ? ' for this claim' : ''}. Create one first in Supplement Management.
          </Text>
        )}
        <Form.Item
          name="supplement_id"
          label="Supplement Request"
          rules={[{ required: true, message: 'Select a supplement request' }]}
        >
          <Select
            loading={isLoading}
            placeholder="Select supplement request..."
            showSearch
            optionFilterProp="label"
            options={supplements.map(s => ({
              value: s.id,
              label: `${s.claim_number ? `[${s.claim_number}] ` : ''}${s.title}`,
            }))}
            notFoundContent={isLoading ? 'Loading...' : 'No supplements found'}
          />
        </Form.Item>
        <Form.Item name="title" label="Title" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="custom_amount" label="Amount (Total)">
          <InputNumber
            min={0}
            step={0.01}
            prefix="$"
            style={{ width: '100%' }}
            formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            parser={v => v?.replace(/[,$]/g, '') as any}
          />
        </Form.Item>
        <Form.Item name="description" label="Notes">
          <Input.TextArea rows={2} placeholder="Optional notes..." />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default RegisterBidItemModal;
