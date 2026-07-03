import React, { useState } from 'react';
import {
  Button, Form, Input, Modal, Select, Space, Table, Tag, message, Popconfirm, Grid,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repairSpecService } from '../../services/repairSpecService';
import { RepairCondition, RepairConditionCreate } from '../../types/repairSpec';

const { useBreakpoint } = Grid;

const SCOPE_OPTIONS = [
  { value: 'damaged', label: 'Damaged', color: 'red' },
  { value: 'affected', label: 'Affected', color: 'blue' },
];

const CATEGORY_OPTIONS = [
  'damage', 'work_type', 'material', 'surface_type',
];

interface ConditionManagerProps {
  companyId?: string;
  onSelect?: (condition: RepairCondition) => void;
  selectable?: boolean;
}

const ConditionManager: React.FC<ConditionManagerProps> = ({
  companyId,
  onSelect,
  selectable = false,
}) => {
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>();

  const { data: conditions = [], isLoading } = useQuery({
    queryKey: ['repair-conditions', companyId, categoryFilter],
    queryFn: () => repairSpecService.listConditions({
      company_id: companyId,
      category: categoryFilter,
    }),
  });

  const createMutation = useMutation({
    mutationFn: (data: RepairConditionCreate) => repairSpecService.createCondition(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repair-conditions'] });
      message.success('Condition created');
      closeModal();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<RepairConditionCreate> }) =>
      repairSpecService.updateCondition(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repair-conditions'] });
      message.success('Condition updated');
      closeModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => repairSpecService.deleteCondition(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repair-conditions'] });
      message.success('Condition deleted');
    },
  });

  const openCreate = () => {
    form.resetFields();
    form.setFieldsValue({ scope: 'damaged', company_id: companyId });
    setEditingId(null);
    setModalOpen(true);
  };

  const openEdit = (record: RepairCondition) => {
    form.setFieldsValue(record);
    setEditingId(record.id);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    form.resetFields();
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: values });
    } else {
      createMutation.mutate({ ...values, company_id: companyId });
    }
  };

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: RepairCondition) => (
        <Space>
          {selectable ? (
            <Button type="link" size="small" onClick={() => onSelect?.(record)}>
              {name}
            </Button>
          ) : (
            name
          )}
          {!record.company_id && <Tag color="default">System</Tag>}
        </Space>
      ),
    },
    {
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
      width: 120,
      render: (v: string) => v || '—',
    },
    {
      title: 'Scope',
      dataIndex: 'scope',
      key: 'scope',
      width: 100,
      render: (scope: string) => {
        const opt = SCOPE_OPTIONS.find((o) => o.value === scope);
        return <Tag color={opt?.color || 'default'}>{opt?.label || scope}</Tag>;
      },
    },
    {
      title: '',
      key: 'actions',
      width: 80,
      render: (_: unknown, record: RepairCondition) =>
        record.company_id ? (
          <Space size={4}>
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEdit(record)}
            />
            <Popconfirm
              title="Delete this condition?"
              onConfirm={() => deleteMutation.mutate(record.id)}
            >
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        ) : null,
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <Button type="primary" icon={<PlusOutlined />} size={isMobile ? 'small' : 'middle'} onClick={openCreate}>
          Add Condition
        </Button>
        <Select
          placeholder="Filter by category"
          allowClear
          value={categoryFilter}
          onChange={setCategoryFilter}
          style={{ width: 160 }}
          size={isMobile ? 'small' : 'middle'}
          options={CATEGORY_OPTIONS.map((c) => ({ value: c, label: c }))}
        />
      </Space>

      <Table
        size="small"
        rowKey="id"
        loading={isLoading}
        dataSource={conditions}
        columns={columns}
        pagination={{ pageSize: 15 }}
        scroll={{ x: 400 }}
      />

      <Modal
        title={editingId ? 'Edit Condition' : 'New Condition'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={closeModal}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        width={isMobile ? '95%' : 480}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input placeholder="e.g., Drywall cut" />
          </Form.Item>
          <Form.Item name="category" label="Category">
            <Select
              placeholder="Select or type"
              allowClear
              options={CATEGORY_OPTIONS.map((c) => ({ value: c, label: c }))}
            />
          </Form.Item>
          <Form.Item name="scope" label="Scope" rules={[{ required: true }]}>
            <Select options={SCOPE_OPTIONS} />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ConditionManager;
