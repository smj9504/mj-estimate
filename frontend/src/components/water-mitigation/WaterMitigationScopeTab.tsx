/**
 * Water Mitigation Scope of Work Tab
 * Manages locations, scope items (standard, demolition, custom), and debris calculation
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Button,
  Space,
  Table,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  message,
  Collapse,
  Tag,
  Tooltip,
  Typography,
  Popconfirm,
  Divider,
  Statistic,
  Row,
  Col,
  Empty,
  Spin,
  Badge,
  Alert
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  CalculatorOutlined,
  EnvironmentOutlined,
  ToolOutlined,
  AppstoreAddOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  QuestionCircleOutlined,
  DollarOutlined
} from '@ant-design/icons';
import waterMitigationService from '../../services/waterMitigationService';
import type {
  ScopeLocation,
  ScopeLocationCreate,
  ScopeLocationUpdate,
  ScopeItem,
  ScopeItemCreate,
  ScopeItemUpdate,
  WMDebrisCalculation,
  CalculateDebrisResponse,
  StandardScopeItem,
  MaterialWeight
} from '../../types/waterMitigation';
import {
  SCOPE_ITEM_TYPE_OPTIONS,
  UNIT_TYPE_OPTIONS,
  ScopeItemType,
  UnitType
} from '../../types/waterMitigation';
import InvoiceConfigurationPanel from './InvoiceConfigurationPanel';

const { Text, Title } = Typography;
const { TextArea } = Input;

interface WaterMitigationScopeTabProps {
  jobId: string;
  jobCompanyId?: string | null;
}

// Floor options for location
const FLOOR_OPTIONS = [
  { value: '1st Floor', label: '1st Floor' },
  { value: '2nd Floor', label: '2nd Floor' },
  { value: '3rd Floor', label: '3rd Floor' },
  { value: 'Basement', label: 'Basement' },
  { value: 'Attic', label: 'Attic' },
  { value: 'Garage', label: 'Garage' },
  { value: 'Exterior', label: 'Exterior' }
];

// Room type options
const ROOM_TYPE_OPTIONS = [
  { value: 'Bathroom', label: 'Bathroom' },
  { value: 'Bedroom', label: 'Bedroom' },
  { value: 'Kitchen', label: 'Kitchen' },
  { value: 'Living Room', label: 'Living Room' },
  { value: 'Dining Room', label: 'Dining Room' },
  { value: 'Office', label: 'Office' },
  { value: 'Laundry Room', label: 'Laundry Room' },
  { value: 'Hallway', label: 'Hallway' },
  { value: 'Closet', label: 'Closet' },
  { value: 'Utility Room', label: 'Utility Room' },
  { value: 'Other', label: 'Other' }
];

const WaterMitigationScopeTab: React.FC<WaterMitigationScopeTabProps> = ({ jobId, jobCompanyId }) => {
  // State
  const [loading, setLoading] = useState(false);
  const [locations, setLocations] = useState<ScopeLocation[]>([]);
  const [debrisCalculation, setDebrisCalculation] = useState<WMDebrisCalculation | null>(null);
  const [calculatingDebris, setCalculatingDebris] = useState(false);
  const [standardScopeItems, setStandardScopeItems] = useState<StandardScopeItem[]>([]);

  // Modal states
  const [locationModalVisible, setLocationModalVisible] = useState(false);
  const [itemModalVisible, setItemModalVisible] = useState(false);
  const [editingLocation, setEditingLocation] = useState<ScopeLocation | null>(null);
  const [editingItem, setEditingItem] = useState<ScopeItem | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);

  // Forms
  const [locationForm] = Form.useForm();
  const [itemForm] = Form.useForm();

  // Formula validation state
  const [formulaResult, setFormulaResult] = useState<{ valid: boolean; result?: number; error?: string } | null>(null);

  // Standard item selection mode
  const [showStandardItemSelector, setShowStandardItemSelector] = useState(false);
  const [selectedStandardItem, setSelectedStandardItem] = useState<StandardScopeItem | null>(null);

  // Multi-select mode for template items
  const [multiSelectMode, setMultiSelectMode] = useState(true);  // Default to multi-select
  const [selectedTemplateItems, setSelectedTemplateItems] = useState<Map<string, { item: StandardScopeItem; quantity: number | null }>>(new Map());
  const [savingMultipleItems, setSavingMultipleItems] = useState(false);

  // Material weights for debris calculation
  const [materialWeights, setMaterialWeights] = useState<MaterialWeight[]>([]);
  const [loadingMaterials, setLoadingMaterials] = useState(false);


  // Inline editing state
  const [editingQuantity, setEditingQuantity] = useState<{ itemId: string; value: number | null } | null>(null);
  const [savingQuantity, setSavingQuantity] = useState(false);

  // Load data
  const loadLocations = useCallback(async () => {
    try {
      setLoading(true);
      const response = await waterMitigationService.scope.locations.listByJob(jobId, true);
      setLocations(response.items);
    } catch (error) {
      message.error('Failed to load locations');
      console.error('Load locations error:', error);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  const loadDebrisCalculation = useCallback(async () => {
    try {
      const result = await waterMitigationService.scope.debris.get(jobId);
      setDebrisCalculation(result);
    } catch (error) {
      // No existing calculation is fine
      setDebrisCalculation(null);
    }
  }, [jobId]);

  const loadStandardScopeItems = useCallback(async () => {
    try {
      const response = await waterMitigationService.standardScopeItems.list({
        is_active: true,
        page_size: 100
      });
      setStandardScopeItems(response.items);
    } catch (error) {
      console.error('Failed to load standard scope items:', error);
      // Fallback to empty array if API not available
      setStandardScopeItems([]);
    }
  }, []);

  // Load material weights for debris calculation
  const loadMaterialWeights = useCallback(async () => {
    try {
      setLoadingMaterials(true);
      const response = await waterMitigationService.materialWeights.list({ active_only: true });
      setMaterialWeights(response.materials);
    } catch (error) {
      console.error('Failed to load material weights:', error);
      setMaterialWeights([]);
    } finally {
      setLoadingMaterials(false);
    }
  }, []);

  useEffect(() => {
    loadLocations();
    loadDebrisCalculation();
    loadStandardScopeItems();
    loadMaterialWeights();
  }, [loadLocations, loadDebrisCalculation, loadStandardScopeItems, loadMaterialWeights]);

  // Location handlers
  const handleAddLocation = () => {
    setEditingLocation(null);
    locationForm.resetFields();
    setLocationModalVisible(true);
  };

  const handleEditLocation = (location: ScopeLocation) => {
    setEditingLocation(location);
    locationForm.setFieldsValue({
      name: location.name,
      floor: location.floor,
      room_type: location.room_type,
      description: location.description
    });
    setLocationModalVisible(true);
  };

  // Helper function to extract error message from API error
  const getErrorMessage = (error: any, defaultMsg: string): string => {
    const detail = error?.response?.data?.detail;
    if (!detail) return defaultMsg;

    // Handle array of validation errors from FastAPI/Pydantic
    if (Array.isArray(detail)) {
      return detail.map((err: any) => {
        if (typeof err === 'string') return err;
        if (err.msg) return err.msg;
        return JSON.stringify(err);
      }).join(', ');
    }

    // Handle string error
    if (typeof detail === 'string') return detail;

    // Handle object with msg property
    if (detail.msg) return detail.msg;

    return defaultMsg;
  };

  const handleSaveLocation = async (values: any) => {
    try {
      if (editingLocation) {
        await waterMitigationService.scope.locations.update(editingLocation.id, values as ScopeLocationUpdate);
        message.success('Location updated successfully');
      } else {
        const createData: ScopeLocationCreate = {
          job_id: jobId,
          ...values
        };
        await waterMitigationService.scope.locations.create(createData);
        message.success('Location created successfully');
      }
      setLocationModalVisible(false);
      loadLocations();
    } catch (error: any) {
      message.error(getErrorMessage(error, 'Failed to save location'));
      console.error('Save location error:', error);
    }
  };

  const handleDeleteLocation = async (locationId: string) => {
    try {
      await waterMitigationService.scope.locations.delete(locationId);
      message.success('Location deleted successfully');
      loadLocations();
    } catch (error: any) {
      message.error(getErrorMessage(error, 'Failed to delete location'));
      console.error('Delete location error:', error);
    }
  };

  const handleAddStandardItems = async (locationId: string) => {
    try {
      await waterMitigationService.scope.locations.addStandardItems(locationId);
      message.success('Standard items added');
      loadLocations();
    } catch (error: any) {
      message.error(getErrorMessage(error, 'Failed to add standard items'));
      console.error('Add standard items error:', error);
    }
  };

  // Item handlers
  const handleAddItem = (locationId: string, itemType: ScopeItemType = 'custom' as ScopeItemType) => {
    setSelectedLocationId(locationId);
    setEditingItem(null);
    setSelectedStandardItem(null);
    setShowStandardItemSelector(false);
    itemForm.resetFields();
    itemForm.setFieldsValue({
      item_type: itemType,
      unit: 'SF',
      include_in_debris: itemType === 'demolition'
    });
    setFormulaResult(null);
    setItemModalVisible(true);
  };

  // Add item from Standard Scope Items
  const handleAddFromStandard = (locationId: string) => {
    setSelectedLocationId(locationId);
    setEditingItem(null);
    setSelectedStandardItem(null);
    setShowStandardItemSelector(true);
    setMultiSelectMode(true);  // Default to multi-select
    setSelectedTemplateItems(new Map());  // Clear previous selections
    itemForm.resetFields();
    setFormulaResult(null);
    setItemModalVisible(true);
  };

  // When a standard item is selected, pre-fill the form (single select mode)
  const handleStandardItemSelect = (itemId: string) => {
    const item = standardScopeItems.find(i => i.id === itemId);
    if (item) {
      setSelectedStandardItem(item);
      setShowStandardItemSelector(false);
      itemForm.setFieldsValue({
        item_type: item.item_type,
        name: item.name,
        description: item.description || '',
        unit: item.unit,
        quantity: item.default_quantity || undefined,
        include_in_debris: item.default_include_in_debris || false,
        material_weight_id: item.material_weight_id || undefined
      });
    }
  };

  // Toggle item selection in multi-select mode
  const handleToggleTemplateItem = (item: StandardScopeItem) => {
    const newMap = new Map(selectedTemplateItems);
    if (newMap.has(item.id)) {
      newMap.delete(item.id);
    } else {
      newMap.set(item.id, { item, quantity: item.default_quantity || null });
    }
    setSelectedTemplateItems(newMap);
  };

  // Update quantity for selected item
  const handleSelectedItemQuantityChange = (itemId: string, quantity: number | null) => {
    const newMap = new Map(selectedTemplateItems);
    const existing = newMap.get(itemId);
    if (existing) {
      newMap.set(itemId, { ...existing, quantity });
      setSelectedTemplateItems(newMap);
    }
  };

  // Save all selected items at once
  const handleSaveMultipleItems = async () => {
    if (!selectedLocationId || selectedTemplateItems.size === 0) return;

    try {
      setSavingMultipleItems(true);
      const itemsToSave = Array.from(selectedTemplateItems.values());
      let successCount = 0;
      let errorCount = 0;

      for (const { item, quantity } of itemsToSave) {
        try {
          const createData: ScopeItemCreate = {
            location_id: selectedLocationId,
            item_type: item.item_type as ScopeItemType,
            name: item.name,
            description: item.description || '',
            unit: item.unit as UnitType,
            quantity: quantity || undefined,
            include_in_debris: item.default_include_in_debris || false,
            material_weight_id: item.material_weight_id || undefined
          };
          await waterMitigationService.scope.items.create(createData);
          successCount++;
        } catch (error) {
          console.error(`Failed to create item ${item.name}:`, error);
          errorCount++;
        }
      }

      if (successCount > 0) {
        message.success(`${successCount} item(s) added successfully`);
      }
      if (errorCount > 0) {
        message.warning(`${errorCount} item(s) failed to add`);
      }

      setItemModalVisible(false);
      setSelectedTemplateItems(new Map());
      loadLocations();
    } catch (error: any) {
      message.error(getErrorMessage(error, 'Failed to save items'));
    } finally {
      setSavingMultipleItems(false);
    }
  };

  const handleEditItem = (item: ScopeItem) => {
    setSelectedLocationId(item.location_id);
    setEditingItem(item);
    setShowStandardItemSelector(false);
    setSelectedStandardItem(null);
    itemForm.setFieldsValue({
      item_type: item.item_type,
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      quantity_formula: item.quantity_formula,
      unit: item.unit,
      material_weight_id: item.material_weight_id,
      line_item_id: item.line_item_id,
      include_in_debris: item.include_in_debris
    });
    setFormulaResult(null);
    setItemModalVisible(true);
  };

  const handleSaveItem = async (values: any) => {
    try {
      // If using formula, calculate and set quantity
      if (values.quantity_formula) {
        const result = await waterMitigationService.scope.calculateFormula(values.quantity_formula);
        if (!result.success) {
          message.error(`Invalid formula: ${result.error}`);
          return;
        }
        values.quantity = result.result;
      }

      if (editingItem) {
        await waterMitigationService.scope.items.update(editingItem.id, values as ScopeItemUpdate);
        message.success('Item updated successfully');
      } else {
        const createData: ScopeItemCreate = {
          location_id: selectedLocationId!,
          ...values
        };
        await waterMitigationService.scope.items.create(createData);
        message.success('Item created successfully');
      }
      setItemModalVisible(false);
      loadLocations();
    } catch (error: any) {
      message.error(getErrorMessage(error, 'Failed to save item'));
      console.error('Save item error:', error);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    try {
      await waterMitigationService.scope.items.delete(itemId);
      message.success('Item deleted successfully');
      loadLocations();
    } catch (error: any) {
      message.error(getErrorMessage(error, 'Failed to delete item'));
      console.error('Delete item error:', error);
    }
  };

  // Inline quantity editing handlers
  const handleQuantityClick = (item: ScopeItem) => {
    setEditingQuantity({ itemId: item.id, value: item.quantity ?? null });
  };

  const handleQuantityChange = (value: number | null) => {
    if (editingQuantity) {
      setEditingQuantity({ ...editingQuantity, value });
    }
  };

  const handleQuantitySave = async (itemId: string) => {
    if (!editingQuantity || editingQuantity.value === null) {
      setEditingQuantity(null);
      return;
    }

    try {
      setSavingQuantity(true);
      await waterMitigationService.scope.items.update(itemId, {
        quantity: editingQuantity.value,
        quantity_formula: undefined  // Clear formula when directly setting quantity
      } as ScopeItemUpdate);
      message.success('Quantity updated');
      loadLocations();
    } catch (error: any) {
      message.error(getErrorMessage(error, 'Failed to update quantity'));
    } finally {
      setSavingQuantity(false);
      setEditingQuantity(null);
    }
  };

  const handleQuantityCancel = () => {
    setEditingQuantity(null);
  };

  // Debris calculation
  const handleCalculateDebris = async () => {
    try {
      setCalculatingDebris(true);
      const response: CalculateDebrisResponse = await waterMitigationService.scope.debris.calculate(jobId, true);
      if (response.success && response.calculation) {
        setDebrisCalculation(response.calculation);
        message.success(response.message);
      } else {
        message.warning(response.message);
        if (response.warnings?.length) {
          response.warnings.forEach(w => message.warning(w));
        }
      }
    } catch (error: any) {
      message.error(getErrorMessage(error, 'Failed to calculate debris'));
      console.error('Calculate debris error:', error);
    } finally {
      setCalculatingDebris(false);
    }
  };

  // Item type color
  const getItemTypeColor = (type: string) => {
    switch (type) {
      case 'standard': return 'blue';
      case 'demolition': return 'orange';
      case 'custom': return 'green';
      default: return 'default';
    }
  };

  // Item columns for table
  const itemColumns = [
    {
      title: 'Type',
      dataIndex: 'item_type',
      key: 'item_type',
      width: 100,
      render: (type: string) => (
        <Tag color={getItemTypeColor(type)}>{type.toUpperCase()}</Tag>
      )
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: ScopeItem) => (
        <Space direction="vertical" size={0}>
          <Text strong>{name}</Text>
          {record.material_weight && (
            <Text type="secondary" style={{ fontSize: '12px' }}>
              {record.material_weight.material_type} ({record.material_weight.dry_weight_per_unit} lb/{record.material_weight.unit})
            </Text>
          )}
          {record.line_item && (
            <Tooltip title={`Rate: $${record.line_item.untaxed_unit_price?.toFixed(2) || '0.00'}/${record.line_item.unit || 'EA'}`}>
              <Tag color="green" style={{ fontSize: '11px', marginTop: 2 }}>
                <DollarOutlined /> {record.line_item.description.substring(0, 30)}{record.line_item.description.length > 30 ? '...' : ''}
              </Tag>
            </Tooltip>
          )}
        </Space>
      )
    },
    {
      title: 'Quantity',
      key: 'quantity',
      width: 180,
      render: (_: any, record: ScopeItem) => {
        const isEditing = editingQuantity?.itemId === record.id;

        if (isEditing) {
          return (
            <Space size={4}>
              <InputNumber
                size="small"
                value={editingQuantity.value}
                onChange={handleQuantityChange}
                onPressEnter={() => handleQuantitySave(record.id)}
                onBlur={() => handleQuantitySave(record.id)}
                autoFocus
                min={0}
                step={0.01}
                style={{ width: 80 }}
                disabled={savingQuantity}
              />
              <Text type="secondary">{record.unit}</Text>
            </Space>
          );
        }

        return (
          <Space direction="vertical" size={0}>
            <Tooltip title="Click to edit">
              <Text
                onClick={() => handleQuantityClick(record)}
                style={{
                  cursor: 'pointer',
                  padding: '2px 6px',
                  borderRadius: 4,
                  transition: 'background 0.2s'
                }}
                className="editable-quantity"
              >
                {record.quantity?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? '-'} {record.unit}
              </Text>
            </Tooltip>
            {record.quantity_formula && (
              <Tooltip title={`Formula: ${record.quantity_formula}`}>
                <Text type="secondary" style={{ fontSize: '11px' }}>
                  <CalculatorOutlined /> {record.quantity_formula}
                </Text>
              </Tooltip>
            )}
          </Space>
        );
      }
    },
    {
      title: 'Debris',
      dataIndex: 'include_in_debris',
      key: 'include_in_debris',
      width: 80,
      render: (include: boolean) => include ? (
        <CheckCircleOutlined style={{ color: '#52c41a' }} />
      ) : (
        <span style={{ color: '#bfbfbf' }}>—</span>
      )
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      render: (_: any, record: ScopeItem) => (
        <Space>
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => handleEditItem(record)}
          />
          <Popconfirm
            title="Delete this item?"
            onConfirm={() => handleDeleteItem(record.id)}
            okText="Yes"
            cancelText="No"
          >
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )
    }
  ];

  // Render location panel header
  const renderLocationHeader = (location: ScopeLocation) => {
    // Check if any items in this location are invoiced
    const invoicedCount = location.scope_items?.filter(item => item.invoiced)?.length || 0;
    const totalItems = location.scope_items?.length || 0;
    const allInvoiced = totalItems > 0 && invoicedCount === totalItems;
    const partiallyInvoiced = invoicedCount > 0 && invoicedCount < totalItems;

    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <Space>
          <EnvironmentOutlined />
          <Text strong>{location.name}</Text>
          {location.floor && <Tag>{location.floor}</Tag>}
          {location.room_type && <Tag color="blue">{location.room_type}</Tag>}
          <Badge count={totalItems} style={{ backgroundColor: '#1890ff' }} />
          {allInvoiced && (
            <Tag color="purple" style={{ marginLeft: 4 }}>
              <CheckCircleOutlined /> Invoiced
            </Tag>
          )}
          {partiallyInvoiced && (
            <Tag color="orange" style={{ marginLeft: 4 }}>
              <CheckCircleOutlined /> {invoicedCount}/{totalItems} Invoiced
            </Tag>
          )}
        </Space>
      <Space onClick={(e) => e.stopPropagation()}>
        <Button
          size="small"
          icon={<EditOutlined />}
          onClick={() => handleEditLocation(location)}
        >
          Edit
        </Button>
        <Popconfirm
          title="Delete this location and all items?"
          onConfirm={() => handleDeleteLocation(location.id)}
          okText="Yes"
          cancelText="No"
        >
          <Button size="small" danger icon={<DeleteOutlined />}>
            Delete
          </Button>
        </Popconfirm>
      </Space>
    </div>
    );
  };

  if (loading && locations.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '100px' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="wm-scope-tab">
      {/* Scope of Work Section */}
      <Card
        className="compact-card"
        style={{ marginBottom: 16 }}
        title={
          <Space>
            <ToolOutlined />
            <span>Scope of Work</span>
            <Tag>{locations.length} Location(s)</Tag>
          </Space>
        }
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleAddLocation}
          >
            Add Location
          </Button>
        }
      >
        {/* Locations */}
        {locations.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No locations added yet"
          >
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAddLocation}>
              Add First Location
            </Button>
          </Empty>
        ) : (
          <Collapse
            accordion
            defaultActiveKey={locations[0]?.id}
            items={locations.map((location) => ({
              key: location.id,
              label: renderLocationHeader(location),
              children: (
                <>
                  {location.description && (
                    <Alert
                      message={location.description}
                      type="info"
                      style={{ marginBottom: 16 }}
                    />
                  )}

                  <Space style={{ marginBottom: 16 }} wrap>
                    <Button
                      type="primary"
                      icon={<AppstoreAddOutlined />}
                      onClick={() => handleAddFromStandard(location.id)}
                    >
                      From Templates
                    </Button>
                    <Button
                      icon={<PlusOutlined />}
                      onClick={() => handleAddItem(location.id, 'custom' as ScopeItemType)}
                    >
                      Custom Item
                    </Button>
                    <Button
                      icon={<ToolOutlined />}
                      onClick={() => handleAddItem(location.id, 'demolition' as ScopeItemType)}
                    >
                      Demolition
                    </Button>
                  </Space>

                  {location.scope_items && location.scope_items.length > 0 ? (
                    <Table
                      dataSource={location.scope_items}
                      columns={itemColumns}
                      rowKey="id"
                      pagination={false}
                      size="small"
                    />
                  ) : (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="No items in this location"
                    />
                  )}
                </>
              )
            }))}
          />
        )}
      </Card>

      {/* Debris Calculation Summary */}
      {debrisCalculation && (
        <Collapse
          defaultActiveKey={['debris-calc']}
          style={{ marginBottom: 16 }}
          items={[
            {
              key: 'debris-calc',
              label: (
                <Space>
                  <CalculatorOutlined />
                  <Text strong>Debris Calculation Summary</Text>
                  <Tag color="blue">{debrisCalculation.total_weight_ton.toFixed(2)} tons</Tag>
                  {debrisCalculation.bag_count && (
                    <Tag color="green">
                      ~{debrisCalculation.bag_count} bags (42-gal)
                    </Tag>
                  )}
                  {debrisCalculation.dumpster_recommendation && (
                    <Tag color="orange">
                      {debrisCalculation.dumpster_recommendation.count}x {debrisCalculation.dumpster_recommendation.size}
                    </Tag>
                  )}
                </Space>
              ),
              extra: (
                <Button
                  icon={<ReloadOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCalculateDebris();
                  }}
                  loading={calculatingDebris}
                  size="small"
                >
                  Recalculate
                </Button>
              ),
              children: (
                <>
                  <Row gutter={24}>
                    <Col span={6}>
                      <Statistic
                        title="Total Weight"
                        value={debrisCalculation.total_weight_lb}
                        suffix="lb"
                        precision={0}
                      />
                    </Col>
                    <Col span={6}>
                      <Statistic
                        title="Total Weight"
                        value={debrisCalculation.total_weight_ton}
                        suffix="tons"
                        precision={2}
                      />
                    </Col>
                    <Col span={6}>
                      {debrisCalculation.bag_count ? (
                        <Statistic
                          title="42-Gal Contractor Bags"
                          value={debrisCalculation.bag_count}
                          suffix="bags"
                          prefix="~"
                        />
                      ) : (
                        debrisCalculation.dumpster_recommendation && (
                          <Statistic
                            title="Recommended Dumpster"
                            value={`${debrisCalculation.dumpster_recommendation.count}x ${debrisCalculation.dumpster_recommendation.size}`}
                          />
                        )
                      )}
                    </Col>
                    <Col span={6}>
                      {debrisCalculation.dumpster_recommendation && debrisCalculation.bag_count && (
                        <Statistic
                          title="Recommended Dumpster"
                          value={`${debrisCalculation.dumpster_recommendation.count}x ${debrisCalculation.dumpster_recommendation.size}`}
                        />
                      )}
                      {!debrisCalculation.bag_count && (
                        <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                          Last calculated: {new Date(debrisCalculation.calculated_at).toLocaleString()}
                        </Text>
                      )}
                    </Col>
                  </Row>
                  {debrisCalculation.bag_count && (
                    <Row gutter={24} style={{ marginTop: 16 }}>
                      <Col span={24}>
                        <Text type="secondary" style={{ display: 'block' }}>
                          Last calculated: {new Date(debrisCalculation.calculated_at).toLocaleString()}
                        </Text>
                      </Col>
                    </Row>
                  )}

                  {debrisCalculation.category_breakdown && debrisCalculation.category_breakdown.length > 0 && (
                    <>
                      <Divider />
                      <Title level={5}>Weight by Category</Title>
                      <Row gutter={16}>
                        {debrisCalculation.category_breakdown.map((cat, idx) => (
                          <Col span={6} key={idx}>
                            <Card size="small" className="compact-card-sm">
                              <Statistic
                                title={cat.category_name || 'Uncategorized'}
                                value={cat.weight_lb}
                                suffix="lb"
                                precision={0}
                              />
                              <Text type="secondary">{cat.item_count} item(s)</Text>
                            </Card>
                          </Col>
                        ))}
                      </Row>
                    </>
                  )}
                </>
              )
            }
          ]}
        />
      )}

      {/* Calculate Debris Button (if no calculation yet) */}
      {!debrisCalculation && locations.some(l => l.scope_items?.some(i => i.include_in_debris)) && (
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button
            type="primary"
            icon={<CalculatorOutlined />}
            onClick={handleCalculateDebris}
            loading={calculatingDebris}
          >
            Calculate Debris
          </Button>
          <Tooltip title="You have demolition items marked for debris calculation. Click to calculate total debris weight.">
            <QuestionCircleOutlined style={{ color: '#1890ff', cursor: 'help' }} />
          </Tooltip>
        </div>
      )}

      {/* Invoice Configuration Panel */}
      {locations.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <InvoiceConfigurationPanel
            jobId={jobId}
            jobCompanyId={jobCompanyId}
            scopeItemCount={locations.reduce(
              (total, loc) => total + (loc.scope_items?.length || 0),
              0
            )}
            onConfigChange={loadLocations}
            onInvoiceGenerated={() => loadLocations()}
          />
        </div>
      )}

      {/* Location Modal */}
      <Modal
        title={editingLocation ? 'Edit Location' : 'Add Location'}
        open={locationModalVisible}
        onCancel={() => setLocationModalVisible(false)}
        onOk={() => locationForm.submit()}
        width={500}
      >
        <Form
          form={locationForm}
          layout="vertical"
          onFinish={handleSaveLocation}
        >
          <Form.Item
            name="name"
            label="Location Name"
            rules={[{ required: true, message: 'Please enter location name' }]}
          >
            <Input placeholder="e.g., Master Bedroom, Kitchen, Basement" />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="floor" label="Floor">
                <Select
                  placeholder="Select floor"
                  allowClear
                  options={FLOOR_OPTIONS}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="room_type" label="Room Type">
                <Select
                  placeholder="Select room type"
                  allowClear
                  options={ROOM_TYPE_OPTIONS}
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="description" label="Description">
            <TextArea rows={3} placeholder="Additional notes about this location" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Item Modal */}
      <Modal
        title={
          showStandardItemSelector
            ? `Select from Templates${selectedTemplateItems.size > 0 ? ` (${selectedTemplateItems.size} selected)` : ''}`
            : editingItem
              ? 'Edit Scope Item'
              : selectedStandardItem
                ? `Add: ${selectedStandardItem.name}`
                : 'Add Scope Item'
        }
        open={itemModalVisible}
        onCancel={() => {
          setItemModalVisible(false);
          setShowStandardItemSelector(false);
          setSelectedStandardItem(null);
          setSelectedTemplateItems(new Map());
        }}
        onOk={() => {
          if (showStandardItemSelector) {
            if (selectedTemplateItems.size > 0) {
              handleSaveMultipleItems();
            } else {
              message.warning('Please select at least one item');
            }
          } else {
            itemForm.submit();
          }
        }}
        okText={showStandardItemSelector ? (selectedTemplateItems.size > 0 ? `Add ${selectedTemplateItems.size} Item(s)` : 'Close') : 'Save'}
        okButtonProps={{
          type: showStandardItemSelector && selectedTemplateItems.size > 0 ? 'primary' : 'default',
          loading: savingMultipleItems
        }}
        width={800}
      >
        {/* Standard Item Selector - Multi-Select Mode */}
        {showStandardItemSelector ? (
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
              Click items to select. You can select multiple items and set quantities before adding.
            </Text>

            {standardScopeItems.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <span>
                    No template items available.<br />
                    <Text type="secondary">Add items in Standard Scope Items management page.</Text>
                  </span>
                }
              />
            ) : (
              <Row gutter={16}>
                {/* Left: Item Selection */}
                <Col span={selectedTemplateItems.size > 0 ? 14 : 24}>
                  <div style={{ maxHeight: 450, overflowY: 'auto', paddingRight: 8 }}>
                    {(() => {
                      const grouped = standardScopeItems.reduce((acc, item) => {
                        const categoryName = item.category?.name || 'Uncategorized';
                        if (!acc[categoryName]) {
                          acc[categoryName] = [];
                        }
                        acc[categoryName].push(item);
                        return acc;
                      }, {} as Record<string, StandardScopeItem[]>);

                      return Object.entries(grouped).map(([categoryName, items]) => (
                        <div key={categoryName} style={{ marginBottom: 16 }}>
                          <Text strong style={{ display: 'block', marginBottom: 8, color: '#1890ff' }}>
                            {categoryName}
                          </Text>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {items.map(item => {
                              const isSelected = selectedTemplateItems.has(item.id);
                              return (
                                <Button
                                  key={item.id}
                                  type={isSelected ? 'primary' : 'default'}
                                  onClick={() => handleToggleTemplateItem(item)}
                                  style={{
                                    height: 'auto',
                                    padding: '8px 12px',
                                    textAlign: 'left',
                                    whiteSpace: 'normal',
                                    borderColor: isSelected ? '#1890ff' : undefined
                                  }}
                                >
                                  <div>
                                    <div style={{ fontWeight: 500 }}>
                                      {isSelected && <CheckCircleOutlined style={{ marginRight: 4 }} />}
                                      {item.name}
                                    </div>
                                    <div style={{ fontSize: 11, color: isSelected ? 'rgba(255,255,255,0.85)' : '#888' }}>
                                      <Tag
                                        color={getItemTypeColor(item.item_type)}
                                        style={{ marginRight: 4, fontSize: 10 }}
                                      >
                                        {item.item_type}
                                      </Tag>
                                      {item.unit}
                                    </div>
                                  </div>
                                </Button>
                              );
                            })}
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                </Col>

                {/* Right: Selected Items with Quantity Input */}
                {selectedTemplateItems.size > 0 && (
                  <Col span={10}>
                    <Card
                      size="small"
                      title={
                        <Space>
                          <CheckCircleOutlined style={{ color: '#52c41a' }} />
                          <span>Selected Items ({selectedTemplateItems.size})</span>
                        </Space>
                      }
                      style={{ height: '100%', maxHeight: 450, overflow: 'auto' }}
                      extra={
                        <Button
                          type="link"
                          size="small"
                          danger
                          onClick={() => setSelectedTemplateItems(new Map())}
                        >
                          Clear All
                        </Button>
                      }
                    >
                      <Space direction="vertical" style={{ width: '100%' }} size="small">
                        {Array.from(selectedTemplateItems.entries()).map(([itemId, { item, quantity }]) => (
                          <div
                            key={itemId}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '8px',
                              background: '#fafafa',
                              borderRadius: 4
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <Text
                                strong
                                style={{ display: 'block', fontSize: 12 }}
                                ellipsis
                              >
                                {item.name}
                              </Text>
                              <Text type="secondary" style={{ fontSize: 11 }}>
                                {item.unit}
                              </Text>
                            </div>
                            <Space size={4}>
                              <InputNumber
                                size="small"
                                placeholder="Qty"
                                value={quantity}
                                onChange={(val) => handleSelectedItemQuantityChange(itemId, val)}
                                min={0}
                                step={0.01}
                                style={{ width: 70 }}
                              />
                              <Button
                                type="text"
                                size="small"
                                danger
                                icon={<DeleteOutlined />}
                                onClick={() => handleToggleTemplateItem(item)}
                              />
                            </Space>
                          </div>
                        ))}
                      </Space>
                    </Card>
                  </Col>
                )}
              </Row>
            )}

            <Divider />
            <div style={{ textAlign: 'center' }}>
              <Button onClick={() => {
                setShowStandardItemSelector(false);
                setSelectedTemplateItems(new Map());
              }}>
                Or enter custom item manually
              </Button>
            </div>
          </div>
        ) : (
          /* Regular Item Form */
          <Form
            form={itemForm}
            layout="vertical"
            onFinish={handleSaveItem}
            initialValues={{
              item_type: 'custom',
              unit: 'SF',
              include_in_debris: false
            }}
          >
            {selectedStandardItem && (
              <Alert
                message={`Based on template: ${selectedStandardItem.name}`}
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                action={
                  <Button size="small" onClick={() => setShowStandardItemSelector(true)}>
                    Change
                  </Button>
                }
              />
            )}

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="item_type"
                  label="Item Type"
                  rules={[{ required: true }]}
                >
                  <Select options={SCOPE_ITEM_TYPE_OPTIONS.map(o => ({ value: o.value, label: o.label }))} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="unit"
                  label="Unit"
                  rules={[{ required: true }]}
                >
                  <Select options={UNIT_TYPE_OPTIONS.map(o => ({ value: o.value, label: o.label }))} />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item
              name="name"
              label="Item Name"
              rules={[{ required: true, message: 'Please enter item name' }]}
            >
              <Input placeholder="e.g., Floor Protection, Carpet Removal" />
            </Form.Item>

          <Form.Item name="description" label="Description">
            <TextArea rows={2} placeholder="Additional notes" />
          </Form.Item>

          <Divider />

          <Form.Item
            name="quantity"
            label={
              <Space>
                Quantity
                <Tooltip title="Enter a number or formula (e.g., 10*12+5*8)">
                  <CalculatorOutlined style={{ color: '#1890ff' }} />
                </Tooltip>
              </Space>
            }
          >
            <Input
              style={{ width: '100%' }}
              placeholder="e.g., 120 or 10*12+5*8"
              onBlur={async (e) => {
                const value = e.target.value?.trim();
                if (!value) {
                  setFormulaResult(null);
                  return;
                }
                // Check if it contains operators (is a formula)
                if (/[\+\-\*\/]/.test(value)) {
                  try {
                    const result = await waterMitigationService.scope.calculateFormula(value);
                    if (result.success && result.result !== undefined) {
                      setFormulaResult({ valid: true, result: result.result });
                      itemForm.setFieldsValue({
                        quantity: result.result,
                        quantity_formula: value
                      });
                    } else {
                      setFormulaResult({ valid: false, error: result.error || 'Invalid formula' });
                    }
                  } catch (error) {
                    setFormulaResult({ valid: false, error: 'Failed to calculate' });
                  }
                } else {
                  // Plain number
                  const num = parseFloat(value);
                  if (!isNaN(num)) {
                    itemForm.setFieldsValue({ quantity: num, quantity_formula: undefined });
                    setFormulaResult(null);
                  }
                }
              }}
            />
          </Form.Item>
          {formulaResult && (
            <div style={{ marginTop: -16, marginBottom: 8 }}>
              {formulaResult.valid ? (
                <Text type="success">
                  <CheckCircleOutlined /> = {formulaResult.result?.toLocaleString()}
                </Text>
              ) : (
                <Text type="danger">
                  <WarningOutlined /> {formulaResult.error}
                </Text>
              )}
            </div>
          )}

          <Form.Item
            name="include_in_debris"
            label="Include in Debris Calculation"
          >
            <Select
              options={[
                { value: true, label: 'Yes - Include in debris weight' },
                { value: false, label: 'No - Exclude from calculation' }
              ]}
            />
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prevValues, currentValues) =>
              prevValues.include_in_debris !== currentValues.include_in_debris
            }
          >
            {({ getFieldValue }) => {
              const includeInDebris = getFieldValue('include_in_debris');

              if (!includeInDebris) return null;

              // Group all materials by category (no unit filtering - user may have items like "drywall- up to 2 ft" with LF unit)
              const groupedMaterials = materialWeights.reduce((acc, material) => {
                const categoryName = material.category_name || 'Other';
                if (!acc[categoryName]) {
                  acc[categoryName] = [];
                }
                acc[categoryName].push(material);
                return acc;
              }, {} as Record<string, MaterialWeight[]>);

              return (
                <Form.Item
                  name="material_weight_id"
                  label={
                    <Space>
                      Material Type
                      <Tooltip title="Select the material type for accurate debris weight calculation. All material types are shown regardless of unit.">
                        <QuestionCircleOutlined style={{ color: '#1890ff' }} />
                      </Tooltip>
                    </Space>
                  }
                  rules={[
                    {
                      required: includeInDebris,
                      message: 'Please select material type for debris calculation'
                    }
                  ]}
                >
                  <Select
                    placeholder="Select material type..."
                    allowClear
                    showSearch
                    optionFilterProp="children"
                    loading={loadingMaterials}
                    notFoundContent={
                      loadingMaterials ? (
                        <Spin size="small" />
                      ) : materialWeights.length === 0 ? (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description="No materials available"
                        />
                      ) : null
                    }
                  >
                    {Object.entries(groupedMaterials).map(([categoryName, materials]) => (
                      <Select.OptGroup label={categoryName} key={categoryName}>
                        {materials.map(material => (
                          <Select.Option
                            key={material.id}
                            value={material.id}
                          >
                            <Space>
                              <span>{material.material_type}</span>
                              <Text type="secondary" style={{ fontSize: 11 }}>
                                ({material.dry_weight_per_unit} lb/{material.unit})
                              </Text>
                            </Space>
                          </Select.Option>
                        ))}
                      </Select.OptGroup>
                    ))}
                  </Select>
                </Form.Item>
              );
            }}
          </Form.Item>

        </Form>
        )}
      </Modal>

      {/* Inline styles for editable quantity hover effect */}
      <style>{`
        .editable-quantity:hover {
          background-color: #f0f5ff;
        }
      `}</style>
    </div>
  );
};

export default WaterMitigationScopeTab;
