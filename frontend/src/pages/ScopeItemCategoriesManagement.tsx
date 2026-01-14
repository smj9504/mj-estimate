/**
 * Scope Item Categories Management Page
 * Manages categories for Standard Scope Items in Water Mitigation
 */

import React, { useState } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  message,
  Popconfirm,
  Tag,
  Input,
  Modal,
  Typography,
  Tooltip,
  Form,
  Switch,
  InputNumber,
  ColorPicker
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CopyOutlined,
  SearchOutlined,
  ReloadOutlined,
  UndoOutlined,
  DatabaseOutlined
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ColumnsType } from 'antd/es/table';
import type { Color } from 'antd/es/color-picker';
import waterMitigationService from '../services/waterMitigationService';
import type { ScopeItemCategory, ScopeItemCategoryCreate, ScopeItemCategoryUpdate } from '../types/waterMitigation';

const { Title, Text } = Typography;
const { Search } = Input;

const ScopeItemCategoriesManagement: React.FC = () => {
  const queryClient = useQueryClient();
  const [searchText, setSearchText] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<ScopeItemCategory | null>(null);
  const [form] = Form.useForm();

  // Fetch categories
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['wm-scope-item-categories', searchText, showInactive],
    queryFn: () => waterMitigationService.scopeItemCategories.list({
      search: searchText || undefined,
      is_active: showInactive ? undefined : true,
      page_size: 100
    })
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: waterMitigationService.scopeItemCategories.create,
    onSuccess: () => {
      message.success('Category created successfully');
      queryClient.invalidateQueries({ queryKey: ['wm-scope-item-categories'] });
      setModalVisible(false);
      form.resetFields();
    },
    onError: (error: any) => {
      message.error(error?.response?.data?.detail || 'Failed to create category');
    }
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: ScopeItemCategoryUpdate }) =>
      waterMitigationService.scopeItemCategories.update(id, data),
    onSuccess: () => {
      message.success('Category updated successfully');
      queryClient.invalidateQueries({ queryKey: ['wm-scope-item-categories'] });
      setModalVisible(false);
      form.resetFields();
    },
    onError: (error: any) => {
      message.error(error?.response?.data?.detail || 'Failed to update category');
    }
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => waterMitigationService.scopeItemCategories.delete(id, false),
    onSuccess: () => {
      message.success('Category deleted successfully');
      queryClient.invalidateQueries({ queryKey: ['wm-scope-item-categories'] });
    },
    onError: () => {
      message.error('Failed to delete category');
    }
  });

  // Restore mutation
  const restoreMutation = useMutation({
    mutationFn: waterMitigationService.scopeItemCategories.restore,
    onSuccess: () => {
      message.success('Category restored successfully');
      queryClient.invalidateQueries({ queryKey: ['wm-scope-item-categories'] });
    },
    onError: () => {
      message.error('Failed to restore category');
    }
  });

  // Duplicate mutation
  const duplicateMutation = useMutation({
    mutationFn: (id: string) => waterMitigationService.scopeItemCategories.duplicate(id),
    onSuccess: () => {
      message.success('Category duplicated successfully');
      queryClient.invalidateQueries({ queryKey: ['wm-scope-item-categories'] });
    },
    onError: () => {
      message.error('Failed to duplicate category');
    }
  });

  // Seed defaults mutation
  const seedDefaultsMutation = useMutation({
    mutationFn: () => waterMitigationService.scopeItemCategories.seedDefaults(),
    onSuccess: (categories) => {
      if (categories.length > 0) {
        message.success(`${categories.length} default categories created`);
      } else {
        message.info('All default categories already exist');
      }
      queryClient.invalidateQueries({ queryKey: ['wm-scope-item-categories'] });
    },
    onError: () => {
      message.error('Failed to seed default categories');
    }
  });

  const handleCreateItem = () => {
    setEditingItem(null);
    form.resetFields();
    form.setFieldsValue({
      color: '#1890ff',
      display_order: 0
    });
    setModalVisible(true);
  };

  const handleEditItem = (item: ScopeItemCategory) => {
    setEditingItem(item);
    form.setFieldsValue({
      name: item.name,
      description: item.description,
      color: item.color,
      icon: item.icon,
      display_order: item.display_order
    });
    setModalVisible(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();

      // Convert color picker value to hex string if needed
      let colorValue = values.color;
      if (typeof colorValue === 'object' && colorValue !== null) {
        // Handle Ant Design ColorPicker value
        colorValue = (colorValue as Color).toHexString();
      }

      const submitData = {
        ...values,
        color: colorValue
      };

      if (editingItem) {
        await updateMutation.mutateAsync({ id: editingItem.id, data: submitData });
      } else {
        await createMutation.mutateAsync(submitData);
      }
    } catch (error) {
      // Form validation error
    }
  };

  const columns: ColumnsType<ScopeItemCategory> = [
    {
      title: 'Order',
      dataIndex: 'display_order',
      key: 'display_order',
      width: 70,
      sorter: (a, b) => a.display_order - b.display_order
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (name: string, record: ScopeItemCategory) => (
        <Space>
          <Tag color={record.color}>{name}</Tag>
          {!record.is_active && <Tag color="red">Inactive</Tag>}
        </Space>
      )
    },
    {
      title: 'Color',
      dataIndex: 'color',
      key: 'color',
      width: 100,
      render: (color: string) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 20,
              height: 20,
              backgroundColor: color,
              borderRadius: 4,
              border: '1px solid #d9d9d9'
            }}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>{color}</Text>
        </div>
      )
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (desc: string | null) => desc || <Text type="secondary">-</Text>
    },
    {
      title: 'Icon',
      dataIndex: 'icon',
      key: 'icon',
      width: 80,
      render: (icon: string | null) => icon || <Text type="secondary">-</Text>
    },
    {
      title: 'Scope',
      key: 'scope',
      width: 100,
      render: (_, record) => (
        record.company_id ? <Tag color="blue">Company</Tag> : <Tag color="green">System</Tag>
      )
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 150,
      fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="Edit">
            <Button
              type="text"
              icon={<EditOutlined />}
              onClick={() => handleEditItem(record)}
            />
          </Tooltip>
          <Tooltip title="Duplicate">
            <Button
              type="text"
              icon={<CopyOutlined />}
              onClick={() => duplicateMutation.mutate(record.id)}
              loading={duplicateMutation.isPending}
            />
          </Tooltip>
          {record.is_active ? (
            <Popconfirm
              title="Delete this category?"
              description="The category will be soft-deleted and can be restored."
              onConfirm={() => deleteMutation.mutate(record.id)}
              okText="Delete"
              cancelText="Cancel"
            >
              <Tooltip title="Delete">
                <Button type="text" danger icon={<DeleteOutlined />} />
              </Tooltip>
            </Popconfirm>
          ) : (
            <Tooltip title="Restore">
              <Button
                type="text"
                icon={<UndoOutlined />}
                onClick={() => restoreMutation.mutate(record.id)}
                loading={restoreMutation.isPending}
              />
            </Tooltip>
          )}
        </Space>
      )
    }
  ];

  return (
    <div style={{ padding: 24 }}>
      <Card>
        <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Title level={3} style={{ margin: 0 }}>Scope Item Categories</Title>
          <Space>
            <Tooltip title="Seed default categories (Equipment, Protection, Demolition, etc.)">
              <Button
                icon={<DatabaseOutlined />}
                onClick={() => seedDefaultsMutation.mutate()}
                loading={seedDefaultsMutation.isPending}
              >
                Seed Defaults
              </Button>
            </Tooltip>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleCreateItem}
            >
              Add Category
            </Button>
          </Space>
        </div>

        {/* Filters */}
        <div style={{ marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <Search
            placeholder="Search by name..."
            allowClear
            style={{ width: 250 }}
            prefix={<SearchOutlined />}
            onSearch={setSearchText}
            onChange={e => !e.target.value && setSearchText('')}
          />
          <Space>
            <Text>Show inactive:</Text>
            <Switch checked={showInactive} onChange={setShowInactive} />
          </Space>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()}>
            Refresh
          </Button>
        </div>

        {/* Table */}
        <Table
          columns={columns}
          dataSource={data?.items || []}
          rowKey="id"
          loading={isLoading}
          pagination={{
            total: data?.total || 0,
            showSizeChanger: true,
            showTotal: (total) => `Total ${total} categories`
          }}
          scroll={{ x: 900 }}
          size="middle"
        />
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        title={editingItem ? 'Edit Category' : 'Create Category'}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          form.resetFields();
        }}
        onOk={handleSave}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        width={500}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            color: '#1890ff',
            display_order: 0
          }}
        >
          <Form.Item
            name="name"
            label="Name"
            rules={[{ required: true, message: 'Please enter category name' }]}
          >
            <Input placeholder="e.g., Equipment, Protection, Demolition" />
          </Form.Item>

          <Form.Item
            name="description"
            label="Description"
          >
            <Input.TextArea rows={2} placeholder="Optional description" />
          </Form.Item>

          <div style={{ display: 'flex', gap: 16 }}>
            <Form.Item
              name="color"
              label="Color"
              style={{ flex: 1 }}
            >
              <ColorPicker showText format="hex" />
            </Form.Item>

            <Form.Item
              name="display_order"
              label="Display Order"
              style={{ flex: 1 }}
            >
              <InputNumber
                style={{ width: '100%' }}
                min={0}
                placeholder="0"
              />
            </Form.Item>
          </div>

          <Form.Item
            name="icon"
            label="Icon (Ant Design icon name)"
          >
            <Input placeholder="e.g., tool, safety, delete" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ScopeItemCategoriesManagement;
