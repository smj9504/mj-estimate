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
  DatabaseOutlined,
  LinkOutlined,
  DisconnectOutlined,
  DollarOutlined,
  CheckCircleOutlined,
  WarningOutlined
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ColumnsType } from 'antd/es/table';
import waterMitigationService from '../services/waterMitigationService';
import type { StandardScopeItem, StandardScopeItemCreate, StandardScopeItemUpdate, ScopeItemCategory, MaterialWeight, StandardItemMapping, StandardItemMappingUpdate } from '../types/waterMitigation';
import lineItemService from '../services/lineItemService';
import type { LineItemModalItem } from '../types/lineItem';

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

// Quantity calculation type options
const QUANTITY_CALC_TYPE_OPTIONS = [
  { value: 'fixed', label: 'Fixed', description: 'Use quantity as-is' },
  { value: 'per_day', label: 'Per Day', description: 'Multiply by mitigation days' },
  { value: 'per_day_capped', label: 'Per Day (Capped)', description: 'Multiply by days, with max limit' }
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

  // Invoice Mapping Tab State
  const [activeTab, setActiveTab] = useState<string>('items');
  const [mappingModalVisible, setMappingModalVisible] = useState(false);
  const [editingMapping, setEditingMapping] = useState<StandardItemMapping | null>(null);
  const [mappingForm] = Form.useForm();
  const [lineItemSearchTerm, setLineItemSearchTerm] = useState('');
  const [showMappedOnly, setShowMappedOnly] = useState<boolean | undefined>(undefined);
  const [mappingSearchText, setMappingSearchText] = useState('');

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

  // =====================================================
  // Invoice Line Item Mapping
  // =====================================================

  // Fetch standard item mappings
  const { data: mappingsData, isLoading: mappingsLoading, refetch: refetchMappings } = useQuery({
    queryKey: ['wm-standard-item-mappings'],
    queryFn: () => waterMitigationService.standardItemMappings.list(),
    enabled: activeTab === 'mapping'
  });

  // Search line items for mapping
  const { data: lineItemsForMapping, isLoading: lineItemsLoading } = useQuery({
    queryKey: ['line-items-for-mapping', lineItemSearchTerm],
    queryFn: () => lineItemService.searchLineItemsForModal(lineItemSearchTerm, undefined, 50),
    enabled: mappingModalVisible && lineItemSearchTerm.length >= 2
  });

  // Update mapping mutation
  const updateMappingMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: StandardItemMappingUpdate }) =>
      waterMitigationService.standardItemMappings.update(id, data),
    onSuccess: () => {
      message.success('Invoice mapping updated successfully');
      queryClient.invalidateQueries({ queryKey: ['wm-standard-item-mappings'] });
      setMappingModalVisible(false);
      mappingForm.resetFields();
      setEditingMapping(null);
      setLineItemSearchTerm('');
    },
    onError: (error: any) => {
      message.error(error?.response?.data?.detail || 'Failed to update mapping');
    }
  });

  // Handle edit mapping
  const handleEditMapping = (mapping: StandardItemMapping) => {
    setEditingMapping(mapping);
    mappingForm.setFieldsValue({
      mapping_type: mapping.line_item_id ? 'line_item' : (mapping.custom_line_item_name ? 'custom' : 'none'),
      line_item_id: mapping.line_item_id,
      custom_line_item_name: mapping.custom_line_item_name,
      custom_line_item_rate: mapping.custom_line_item_rate,
      quantity_calc_type: mapping.quantity_calc_type || 'fixed',
      max_days: mapping.max_days,
      default_invoice_note: mapping.default_invoice_note
    });
    setMappingModalVisible(true);
  };

  // Handle save mapping
  const handleSaveMapping = async () => {
    try {
      const values = await mappingForm.validateFields();

      if (!editingMapping) return;

      const updateData: StandardItemMappingUpdate = {
        quantity_calc_type: values.quantity_calc_type,
        max_days: values.quantity_calc_type === 'per_day_capped' ? values.max_days : null,
        default_invoice_note: values.default_invoice_note || null
      };

      // Set mapping based on type
      if (values.mapping_type === 'line_item' && values.line_item_id) {
        updateData.line_item_id = values.line_item_id;
        updateData.custom_line_item_name = null;
        updateData.custom_line_item_rate = null;
      } else if (values.mapping_type === 'custom') {
        updateData.line_item_id = null;
        updateData.custom_line_item_name = values.custom_line_item_name;
        updateData.custom_line_item_rate = values.custom_line_item_rate;
      } else {
        // No mapping
        updateData.line_item_id = null;
        updateData.custom_line_item_name = null;
        updateData.custom_line_item_rate = null;
      }

      await updateMappingMutation.mutateAsync({ id: editingMapping.id, data: updateData });
    } catch (error) {
      // Form validation error
    }
  };

  // Clear mapping (disconnect)
  const handleClearMapping = async (mapping: StandardItemMapping) => {
    try {
      await updateMappingMutation.mutateAsync({
        id: mapping.id,
        data: {
          line_item_id: null,
          custom_line_item_name: null,
          custom_line_item_rate: null
        }
      });
    } catch (error) {
      // Error handled in mutation
    }
  };

  // Filter mappings
  const filteredMappings = React.useMemo(() => {
    if (!mappingsData?.items) return [];

    let filtered = mappingsData.items;

    // Filter by search text
    if (mappingSearchText) {
      const search = mappingSearchText.toLowerCase();
      filtered = filtered.filter(m =>
        m.name.toLowerCase().includes(search) ||
        m.line_item_description?.toLowerCase().includes(search) ||
        m.custom_line_item_name?.toLowerCase().includes(search)
      );
    }

    // Filter by mapped status
    if (showMappedOnly === true) {
      filtered = filtered.filter(m => m.has_mapping);
    } else if (showMappedOnly === false) {
      filtered = filtered.filter(m => !m.has_mapping);
    }

    return filtered;
  }, [mappingsData?.items, mappingSearchText, showMappedOnly]);

  // Mapping table columns
  const mappingColumns: ColumnsType<StandardItemMapping> = [
    {
      title: 'Scope Item',
      dataIndex: 'name',
      key: 'name',
      width: 200,
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (name: string, record: StandardItemMapping) => (
        <Space direction="vertical" size={0}>
          <Text strong>{name}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.unit} • {record.item_type}
          </Text>
        </Space>
      )
    },
    {
      title: 'Category',
      dataIndex: 'category_name',
      key: 'category_name',
      width: 120,
      render: (categoryName: string | null) => categoryName ? (
        <Tag>{categoryName}</Tag>
      ) : (
        <Text type="secondary">-</Text>
      )
    },
    {
      title: 'Mapping Status',
      key: 'mapping_status',
      width: 100,
      align: 'center',
      render: (_, record: StandardItemMapping) => record.has_mapping ? (
        <Tag icon={<CheckCircleOutlined />} color="success">Mapped</Tag>
      ) : (
        <Tag icon={<WarningOutlined />} color="warning">Unmapped</Tag>
      )
    },
    {
      title: 'Invoice Line Item',
      key: 'line_item_info',
      width: 280,
      render: (_, record: StandardItemMapping) => {
        if (record.line_item_id && record.line_item_description) {
          return (
            <Space direction="vertical" size={0}>
              <Text>{record.line_item_description}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                <DollarOutlined /> ${record.line_item_rate?.toFixed(2) || '0.00'} / {record.unit}
              </Text>
            </Space>
          );
        }
        if (record.custom_line_item_name) {
          return (
            <Space direction="vertical" size={0}>
              <Text>
                <Tag color="blue" style={{ marginRight: 4 }}>Custom</Tag>
                {record.custom_line_item_name}
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                <DollarOutlined /> ${record.custom_line_item_rate?.toFixed(2) || '0.00'} / {record.unit}
              </Text>
            </Space>
          );
        }
        return <Text type="secondary">Not configured</Text>;
      }
    },
    {
      title: 'Quantity Calc',
      dataIndex: 'quantity_calc_type',
      key: 'quantity_calc_type',
      width: 130,
      render: (calcType: string, record: StandardItemMapping) => {
        const option = QUANTITY_CALC_TYPE_OPTIONS.find(o => o.value === calcType);
        let label = option?.label || calcType;
        if (calcType === 'per_day_capped' && record.max_days) {
          label += ` (max ${record.max_days})`;
        }
        return <Tag color={calcType === 'fixed' ? 'default' : 'blue'}>{label}</Tag>;
      }
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 120,
      fixed: 'right',
      render: (_, record: StandardItemMapping) => (
        <Space size="small">
          <Tooltip title="Edit Mapping">
            <Button
              type="text"
              icon={<LinkOutlined />}
              onClick={() => handleEditMapping(record)}
            />
          </Tooltip>
          {record.has_mapping && (
            <Popconfirm
              title="Clear this mapping?"
              description="The scope item will no longer have a line item association."
              onConfirm={() => handleClearMapping(record)}
              okText="Clear"
              cancelText="Cancel"
            >
              <Tooltip title="Clear Mapping">
                <Button type="text" danger icon={<DisconnectOutlined />} />
              </Tooltip>
            </Popconfirm>
          )}
        </Space>
      )
    }
  ];

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
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Title level={3} style={{ margin: 0 }}>Standard Scope Items</Title>
        </div>

        <Tabs activeKey={activeTab} onChange={setActiveTab}>
          {/* Items Tab */}
          <Tabs.TabPane tab="Scope Items" key="items">
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
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
          </Tabs.TabPane>

          {/* Invoice Mapping Tab */}
          <Tabs.TabPane
            tab={
              <Space>
                <LinkOutlined />
                Invoice Mapping
                {mappingsData && (
                  <Tag color={mappingsData.unmapped_count > 0 ? 'warning' : 'success'}>
                    {mappingsData.mapped_count}/{mappingsData.total}
                  </Tag>
                )}
              </Space>
            }
            key="mapping"
          >
            {/* Mapping Stats */}
            {mappingsData && (
              <div style={{ marginBottom: 16, padding: 16, background: '#fafafa', borderRadius: 8 }}>
                <Space size="large">
                  <div>
                    <Text type="secondary">Total Items</Text>
                    <div style={{ fontSize: 24, fontWeight: 600 }}>{mappingsData.total}</div>
                  </div>
                  <div>
                    <Text type="secondary">Mapped</Text>
                    <div style={{ fontSize: 24, fontWeight: 600, color: '#52c41a' }}>
                      {mappingsData.mapped_count}
                    </div>
                  </div>
                  <div>
                    <Text type="secondary">Unmapped</Text>
                    <div style={{ fontSize: 24, fontWeight: 600, color: mappingsData.unmapped_count > 0 ? '#faad14' : '#52c41a' }}>
                      {mappingsData.unmapped_count}
                    </div>
                  </div>
                </Space>
              </div>
            )}

            {/* Mapping Filters */}
            <div style={{ marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <Search
                placeholder="Search scope items or line items..."
                allowClear
                style={{ width: 300 }}
                prefix={<SearchOutlined />}
                onSearch={setMappingSearchText}
                onChange={e => !e.target.value && setMappingSearchText('')}
              />
              <Select
                placeholder="Filter by status"
                allowClear
                style={{ width: 150 }}
                value={showMappedOnly}
                onChange={setShowMappedOnly}
              >
                <Option value={true}>Mapped Only</Option>
                <Option value={false}>Unmapped Only</Option>
              </Select>
              <Button icon={<ReloadOutlined />} onClick={() => refetchMappings()}>
                Refresh
              </Button>
            </div>

            {/* Mapping Table */}
            <Table
              columns={mappingColumns}
              dataSource={filteredMappings}
              rowKey="id"
              loading={mappingsLoading}
              pagination={{
                showSizeChanger: true,
                showTotal: (total) => `Total ${total} items`
              }}
              scroll={{ x: 1000 }}
              size="middle"
            />
          </Tabs.TabPane>
        </Tabs>
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

      {/* Invoice Mapping Modal */}
      <Modal
        title={
          <Space>
            <LinkOutlined />
            <span>Configure Invoice Mapping</span>
            {editingMapping && <Tag>{editingMapping.name}</Tag>}
          </Space>
        }
        open={mappingModalVisible}
        onCancel={() => {
          setMappingModalVisible(false);
          mappingForm.resetFields();
          setEditingMapping(null);
          setLineItemSearchTerm('');
        }}
        onOk={handleSaveMapping}
        confirmLoading={updateMappingMutation.isPending}
        width={700}
      >
        {editingMapping && (
          <div style={{ marginBottom: 16, padding: 12, background: '#f5f5f5', borderRadius: 8 }}>
            <Space direction="vertical" size={4}>
              <Text strong>{editingMapping.name}</Text>
              <Text type="secondary">
                Unit: {editingMapping.unit} | Type: {editingMapping.item_type}
                {editingMapping.category_name && ` | Category: ${editingMapping.category_name}`}
              </Text>
            </Space>
          </div>
        )}

        <Form
          form={mappingForm}
          layout="vertical"
          initialValues={{
            mapping_type: 'none',
            quantity_calc_type: 'fixed'
          }}
        >
          <Form.Item
            name="mapping_type"
            label="Mapping Type"
            rules={[{ required: true }]}
          >
            <Select>
              <Option value="none">No Mapping</Option>
              <Option value="line_item">Link to Line Item Library</Option>
              <Option value="custom">Custom Line Item</Option>
            </Select>
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prevValues, currentValues) =>
              prevValues.mapping_type !== currentValues.mapping_type
            }
          >
            {({ getFieldValue }) => {
              const mappingType = getFieldValue('mapping_type');

              if (mappingType === 'line_item') {
                return (
                  <Form.Item
                    name="line_item_id"
                    label="Select Line Item"
                    rules={[{ required: true, message: 'Please select a line item' }]}
                  >
                    <Select
                      showSearch
                      placeholder="Search line items..."
                      filterOption={false}
                      onSearch={setLineItemSearchTerm}
                      loading={lineItemsLoading}
                      optionLabelProp="label"
                      notFoundContent={
                        lineItemsLoading ? (
                          <Text type="secondary">Searching...</Text>
                        ) : lineItemSearchTerm.length < 2 ? (
                          <Text type="secondary">Type at least 2 characters to search</Text>
                        ) : (
                          <Text type="secondary">No line items found</Text>
                        )
                      }
                    >
                      {(lineItemsForMapping || []).map((item: LineItemModalItem) => (
                        <Option key={item.id} value={item.id} label={item.description}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <Text
                              style={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                maxWidth: '100%'
                              }}
                              title={item.description}
                            >
                              {item.description}
                            </Text>
                            <Text
                              type="secondary"
                              style={{
                                fontSize: 11,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {item.component_code} | ${item.unit_price?.toFixed(2) || '0.00'} / {item.unit}
                              {item.type === 'XACTIMATE' && ' | Xactimate'}
                            </Text>
                          </div>
                        </Option>
                      ))}
                    </Select>
                  </Form.Item>
                );
              }

              if (mappingType === 'custom') {
                return (
                  <>
                    <Form.Item
                      name="custom_line_item_name"
                      label="Custom Line Item Name"
                      rules={[{ required: true, message: 'Please enter a custom line item name' }]}
                    >
                      <Input placeholder="e.g., Equipment Monitoring - Daily Rate" />
                    </Form.Item>
                    <Form.Item
                      name="custom_line_item_rate"
                      label="Rate per Unit"
                      rules={[{ required: true, message: 'Please enter a rate' }]}
                    >
                      <InputNumber
                        style={{ width: '100%' }}
                        min={0}
                        step={0.01}
                        precision={2}
                        prefix="$"
                        placeholder="0.00"
                      />
                    </Form.Item>
                  </>
                );
              }

              return null;
            }}
          </Form.Item>

          <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 16, marginTop: 16 }}>
            <Title level={5}>Quantity Calculation Settings</Title>

            <Form.Item
              name="quantity_calc_type"
              label="Calculation Method"
              tooltip="How quantity should be calculated when generating invoice"
            >
              <Select>
                {QUANTITY_CALC_TYPE_OPTIONS.map(opt => (
                  <Option key={opt.value} value={opt.value}>
                    <Space>
                      <span>{opt.label}</span>
                      <Text type="secondary" style={{ fontSize: 12 }}>- {opt.description}</Text>
                    </Space>
                  </Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item
              noStyle
              shouldUpdate={(prevValues, currentValues) =>
                prevValues.quantity_calc_type !== currentValues.quantity_calc_type
              }
            >
              {({ getFieldValue }) => {
                const calcType = getFieldValue('quantity_calc_type');

                if (calcType === 'per_day_capped') {
                  return (
                    <Form.Item
                      name="max_days"
                      label="Maximum Days"
                      rules={[{ required: true, message: 'Please enter max days' }]}
                      tooltip="Quantity will be capped at this number of days"
                    >
                      <InputNumber
                        style={{ width: '100%' }}
                        min={1}
                        max={365}
                        placeholder="e.g., 5"
                      />
                    </Form.Item>
                  );
                }

                return null;
              }}
            </Form.Item>

            <Form.Item
              name="default_invoice_note"
              label="Default Invoice Note"
              tooltip="Optional note to include with this line item in invoices"
            >
              <Input.TextArea
                rows={2}
                placeholder="e.g., Per IICRC S500 standards"
              />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  );
};

export default StandardScopeItemsManagement;
