/**
 * Standard Scope Items Management Page
 * Manages template scope items for Water Mitigation Scope of Work
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
  Select,
  InputNumber,
  Checkbox,
  Switch,
  Tabs
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
import waterMitigationService from '../services/waterMitigationService';
import type { StandardScopeItem, StandardScopeItemCreate, StandardScopeItemUpdate, ScopeItemCategory, MaterialWeight } from '../types/waterMitigation';

const { Title, Text } = Typography;
const { Search } = Input;
const { Option } = Select;
const { TabPane } = Tabs;

// Item type options
const ITEM_TYPE_OPTIONS = [
  { value: 'standard', label: 'Standard', color: 'blue' },
  { value: 'demolition', label: 'Demolition', color: 'orange' },
  { value: 'custom', label: 'Custom', color: 'green' }
];

// Unit options
const UNIT_OPTIONS = [
  { value: 'SF', label: 'SF (Square Feet)' },
  { value: 'LF', label: 'LF (Linear Feet)' },
  { value: 'EA', label: 'EA (Each)' },
  { value: 'HR', label: 'HR (Hour)' },
  { value: 'DAY', label: 'DAY' }
];

const StandardScopeItemsManagement: React.FC = () => {
  const queryClient = useQueryClient();
  const [searchText, setSearchText] = useState('');
  const [filterType, setFilterType] = useState<string | undefined>(undefined);
  const [filterCategoryId, setFilterCategoryId] = useState<string | undefined>(undefined);
  const [showInactive, setShowInactive] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<StandardScopeItem | null>(null);
  const [form] = Form.useForm();

  // Fetch items
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['wm-standard-scope-items', searchText, filterType, filterCategoryId, showInactive],
    queryFn: () => waterMitigationService.standardScopeItems.list({
      search: searchText || undefined,
      item_type: filterType,
      category_id: filterCategoryId,
      is_active: showInactive ? undefined : true,
      page_size: 100
    })
  });

  // Fetch categories (now from separate API)
  const { data: categoriesData } = useQuery({
    queryKey: ['wm-scope-item-categories'],
    queryFn: () => waterMitigationService.scopeItemCategories.list({ is_active: true, page_size: 100 })
  });
  const categories = categoriesData?.items || [];

  // Fetch material weights for debris calculation
  const { data: materialWeightsData } = useQuery({
    queryKey: ['material-weights'],
    queryFn: () => waterMitigationService.materialWeights.list({ active_only: true })
  });
  const materialWeights = materialWeightsData?.materials || [];

  // Create mutation
  const createMutation = useMutation({
    mutationFn: waterMitigationService.standardScopeItems.create,
    onSuccess: () => {
      message.success('Item created successfully');
      queryClient.invalidateQueries({ queryKey: ['wm-standard-scope-items'] });
      queryClient.invalidateQueries({ queryKey: ['wm-scope-item-categories'] });
      setModalVisible(false);
      form.resetFields();
    },
    onError: (error: any) => {
      message.error(error?.response?.data?.detail || 'Failed to create item');
    }
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: StandardScopeItemUpdate }) =>
      waterMitigationService.standardScopeItems.update(id, data),
    onSuccess: () => {
      message.success('Item updated successfully');
      queryClient.invalidateQueries({ queryKey: ['wm-standard-scope-items'] });
      queryClient.invalidateQueries({ queryKey: ['wm-scope-item-categories'] });
      setModalVisible(false);
      form.resetFields();
    },
    onError: (error: any) => {
      message.error(error?.response?.data?.detail || 'Failed to update item');
    }
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => waterMitigationService.standardScopeItems.delete(id, false),
    onSuccess: () => {
      message.success('Item deleted successfully');
      queryClient.invalidateQueries({ queryKey: ['wm-standard-scope-items'] });
    },
    onError: () => {
      message.error('Failed to delete item');
    }
  });

  // Restore mutation
  const restoreMutation = useMutation({
    mutationFn: waterMitigationService.standardScopeItems.restore,
    onSuccess: () => {
      message.success('Item restored successfully');
      queryClient.invalidateQueries({ queryKey: ['wm-standard-scope-items'] });
    },
    onError: () => {
      message.error('Failed to restore item');
    }
  });

  // Duplicate mutation
  const duplicateMutation = useMutation({
    mutationFn: (id: string) => waterMitigationService.standardScopeItems.duplicate(id),
    onSuccess: () => {
      message.success('Item duplicated successfully');
      queryClient.invalidateQueries({ queryKey: ['wm-standard-scope-items'] });
    },
    onError: () => {
      message.error('Failed to duplicate item');
    }
  });

  // Seed defaults mutation
  const seedDefaultsMutation = useMutation({
    mutationFn: () => waterMitigationService.standardScopeItems.seedDefaults(),
    onSuccess: (items) => {
      if (items.length > 0) {
        message.success(`${items.length} default items created`);
      } else {
        message.info('All default items already exist');
      }
      queryClient.invalidateQueries({ queryKey: ['wm-standard-scope-items'] });
      queryClient.invalidateQueries({ queryKey: ['wm-scope-item-categories'] });
    },
    onError: () => {
      message.error('Failed to seed default items');
    }
  });

  const handleCreateItem = () => {
    setEditingItem(null);
    form.resetFields();
    form.setFieldsValue({
      item_type: 'standard',
      unit: 'SF',
      default_include_in_debris: false
    });
    setModalVisible(true);
  };

  const handleEditItem = (item: StandardScopeItem) => {
    setEditingItem(item);
    form.setFieldsValue({
      name: item.name,
      description: item.description,
      item_type: item.item_type,
      category_id: item.category_id,
      unit: item.unit,
      default_quantity: item.default_quantity,
      default_include_in_debris: item.default_include_in_debris,
      material_weight_id: item.material_weight_id
    });
    setModalVisible(true);
  };

  // Helper to group material weights by category (show all materials regardless of unit)
  const getGroupedMaterialWeights = () => {
    return materialWeights.reduce((acc: Record<string, MaterialWeight[]>, material: MaterialWeight) => {
      const categoryName = material.category_name || 'Other';
      if (!acc[categoryName]) {
        acc[categoryName] = [];
      }
      acc[categoryName].push(material);
      return acc;
    }, {});
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();

      if (editingItem) {
        await updateMutation.mutateAsync({ id: editingItem.id, data: values });
      } else {
        await createMutation.mutateAsync(values);
      }
    } catch (error) {
      // Form validation error
    }
  };

  const columns: ColumnsType<StandardScopeItem> = [
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
      render: (name: string, record: StandardScopeItem) => (
        <Space>
          <Text strong={record.is_active} delete={!record.is_active}>{name}</Text>
          {!record.is_active && <Tag color="red">Inactive</Tag>}
        </Space>
      )
    },
    {
      title: 'Type',
      dataIndex: 'item_type',
      key: 'item_type',
      width: 100,
      render: (type: string) => {
        const typeOption = ITEM_TYPE_OPTIONS.find(t => t.value === type);
        return <Tag color={typeOption?.color || 'default'}>{typeOption?.label || type}</Tag>;
      },
      filters: ITEM_TYPE_OPTIONS.map(t => ({ text: t.label, value: t.value })),
      onFilter: (value, record) => record.item_type === value
    },
    {
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
      width: 140,
      render: (category: StandardScopeItem['category']) =>
        category ? (
          <Tag color={category.color}>{category.name}</Tag>
        ) : (
          <Text type="secondary">-</Text>
        )
    },
    {
      title: 'Unit',
      dataIndex: 'unit',
      key: 'unit',
      width: 80,
      render: (unit: string) => <Tag>{unit}</Tag>
    },
    {
      title: 'Default Qty',
      dataIndex: 'default_quantity',
      key: 'default_quantity',
      width: 100,
      render: (qty: number | null) => qty != null ? qty : <Text type="secondary">-</Text>
    },
    {
      title: 'Debris',
      dataIndex: 'default_include_in_debris',
      key: 'default_include_in_debris',
      width: 80,
      render: (value: boolean) => value ? <Tag color="orange">Yes</Tag> : <Text type="secondary">No</Text>
    },
    {
      title: 'Material Weight',
      dataIndex: 'material_weight',
      key: 'material_weight',
      width: 160,
      render: (mw: StandardScopeItem['material_weight']) =>
        mw ? (
          <Tooltip title={`${mw.dry_weight_per_unit} lb/${mw.unit}`}>
            <Text style={{ fontSize: 12 }}>{mw.material_type}</Text>
          </Tooltip>
        ) : (
          <Text type="secondary">-</Text>
        )
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
              title="Delete this item?"
              description="The item will be soft-deleted and can be restored."
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
          <Title level={3} style={{ margin: 0 }}>Standard Scope Items</Title>
          <Space>
            <Tooltip title="Seed default items from hardcoded list">
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
              Add Item
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
          <Select
            placeholder="Filter by type"
            allowClear
            style={{ width: 150 }}
            value={filterType}
            onChange={setFilterType}
          >
            {ITEM_TYPE_OPTIONS.map(t => (
              <Option key={t.value} value={t.value}>{t.label}</Option>
            ))}
          </Select>
          <Select
            placeholder="Filter by category"
            allowClear
            style={{ width: 180 }}
            value={filterCategoryId}
            onChange={setFilterCategoryId}
          >
            {categories.map((cat: ScopeItemCategory) => (
              <Option key={cat.id} value={cat.id}>
                <Tag color={cat.color} style={{ marginRight: 4 }}>{cat.name}</Tag>
              </Option>
            ))}
          </Select>
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
            showTotal: (total) => `Total ${total} items`
          }}
          scroll={{ x: 1200 }}
          size="middle"
        />
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        title={editingItem ? 'Edit Scope Item' : 'Create Scope Item'}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          form.resetFields();
        }}
        onOk={handleSave}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            item_type: 'standard',
            unit: 'SF',
            default_include_in_debris: false
          }}
        >
          <Form.Item
            name="name"
            label="Name"
            rules={[{ required: true, message: 'Please enter item name' }]}
          >
            <Input placeholder="e.g., Floor Protection" />
          </Form.Item>

          <Form.Item
            name="description"
            label="Description"
          >
            <Input.TextArea rows={2} placeholder="Optional description" />
          </Form.Item>

          <div style={{ display: 'flex', gap: 16 }}>
            <Form.Item
              name="item_type"
              label="Item Type"
              style={{ flex: 1 }}
              rules={[{ required: true }]}
            >
              <Select>
                {ITEM_TYPE_OPTIONS.map(t => (
                  <Option key={t.value} value={t.value}>{t.label}</Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item
              name="category_id"
              label="Category"
              style={{ flex: 1 }}
            >
              <Select allowClear placeholder="Select category">
                {categories.map((cat: ScopeItemCategory) => (
                  <Option key={cat.id} value={cat.id}>
                    <Tag color={cat.color} style={{ marginRight: 4 }}>{cat.name}</Tag>
                  </Option>
                ))}
              </Select>
            </Form.Item>
          </div>

          <div style={{ display: 'flex', gap: 16 }}>
            <Form.Item
              name="unit"
              label="Unit"
              style={{ flex: 1 }}
              rules={[{ required: true }]}
            >
              <Select>
                {UNIT_OPTIONS.map(u => (
                  <Option key={u.value} value={u.value}>{u.label}</Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item
              name="default_quantity"
              label="Default Quantity"
              style={{ flex: 1 }}
            >
              <InputNumber
                placeholder="Optional"
                style={{ width: '100%' }}
                min={0}
                step={0.01}
              />
            </Form.Item>
          </div>

          <Form.Item
            name="default_include_in_debris"
            valuePropName="checked"
          >
            <Checkbox>Include in debris calculation by default</Checkbox>
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prevValues, currentValues) =>
              prevValues.default_include_in_debris !== currentValues.default_include_in_debris
            }
          >
            {({ getFieldValue }) => {
              const includeInDebris = getFieldValue('default_include_in_debris');

              if (!includeInDebris) return null;

              const groupedMaterials = getGroupedMaterialWeights();

              return (
                <Form.Item
                  name="material_weight_id"
                  label="Default Material Type"
                  tooltip="Select the material type for automatic debris weight calculation. All material types are shown regardless of unit."
                >
                  <Select
                    placeholder="Select material type..."
                    allowClear
                    showSearch
                    optionFilterProp="children"
                    notFoundContent={
                      materialWeights.length === 0 ? (
                        <Text type="secondary">No materials available</Text>
                      ) : null
                    }
                  >
                    {Object.entries(groupedMaterials).map(([categoryName, materials]) => (
                      <Select.OptGroup label={categoryName} key={categoryName}>
                        {(materials as MaterialWeight[]).map((material: MaterialWeight) => (
                          <Option key={material.id} value={material.id}>
                            <Space>
                              <span>{material.material_type}</span>
                              <Text type="secondary" style={{ fontSize: 11 }}>
                                ({material.dry_weight_per_unit} lb/{material.unit})
                              </Text>
                            </Space>
                          </Option>
                        ))}
                      </Select.OptGroup>
                    ))}
                  </Select>
                </Form.Item>
              );
            }}
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default StandardScopeItemsManagement;
