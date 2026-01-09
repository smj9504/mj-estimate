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
  InfoCircleOutlined,
  CheckCircleOutlined,
  WarningOutlined
} from '@ant-design/icons';
import waterMitigationService from '../../services/waterMitigationService';
import type {
  ScopeLocation,
  ScopeLocationCreate,
  ScopeLocationUpdate,
  ScopeItem,
  ScopeItemCreate,
  ScopeItemUpdate,
  DemolitionType,
  WMDebrisCalculation,
  CalculateDebrisResponse,
  ScopeItemType,
  MoistureLevel,
  UnitType
} from '../../types/waterMitigation';
import {
  STANDARD_SCOPE_ITEMS,
  MOISTURE_LEVEL_OPTIONS,
  SCOPE_ITEM_TYPE_OPTIONS,
  UNIT_TYPE_OPTIONS
} from '../../types/waterMitigation';

const { Text, Title } = Typography;
const { Panel } = Collapse;
const { TextArea } = Input;

interface WaterMitigationScopeTabProps {
  jobId: string;
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

const WaterMitigationScopeTab: React.FC<WaterMitigationScopeTabProps> = ({ jobId }) => {
  // State
  const [loading, setLoading] = useState(false);
  const [locations, setLocations] = useState<ScopeLocation[]>([]);
  const [demolitionTypes, setDemolitionTypes] = useState<DemolitionType[]>([]);
  const [debrisCalculation, setDebrisCalculation] = useState<WMDebrisCalculation | null>(null);
  const [calculatingDebris, setCalculatingDebris] = useState(false);

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

  const loadDemolitionTypes = useCallback(async () => {
    try {
      const response = await waterMitigationService.scope.demolitionTypes.list(true);
      setDemolitionTypes(response.items);
    } catch (error) {
      message.error('Failed to load demolition types');
      console.error('Load demolition types error:', error);
    }
  }, []);

  const loadDebrisCalculation = useCallback(async () => {
    try {
      const result = await waterMitigationService.scope.debris.get(jobId);
      setDebrisCalculation(result);
    } catch (error) {
      // No existing calculation is fine
      setDebrisCalculation(null);
    }
  }, [jobId]);

  useEffect(() => {
    loadLocations();
    loadDemolitionTypes();
    loadDebrisCalculation();
  }, [loadLocations, loadDemolitionTypes, loadDebrisCalculation]);

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
      message.error(error?.response?.data?.detail || 'Failed to save location');
      console.error('Save location error:', error);
    }
  };

  const handleDeleteLocation = async (locationId: string) => {
    try {
      await waterMitigationService.scope.locations.delete(locationId);
      message.success('Location deleted successfully');
      loadLocations();
    } catch (error: any) {
      message.error(error?.response?.data?.detail || 'Failed to delete location');
      console.error('Delete location error:', error);
    }
  };

  const handleAddStandardItems = async (locationId: string) => {
    try {
      await waterMitigationService.scope.locations.addStandardItems(locationId);
      message.success('Standard items added');
      loadLocations();
    } catch (error: any) {
      message.error(error?.response?.data?.detail || 'Failed to add standard items');
      console.error('Add standard items error:', error);
    }
  };

  // Item handlers
  const handleAddItem = (locationId: string, itemType: ScopeItemType = 'custom' as ScopeItemType) => {
    setSelectedLocationId(locationId);
    setEditingItem(null);
    itemForm.resetFields();
    itemForm.setFieldsValue({
      item_type: itemType,
      unit: 'SF',
      include_in_debris: itemType === 'demolition',
      moisture_level: 'dry'
    });
    setFormulaResult(null);
    setItemModalVisible(true);
  };

  const handleEditItem = (item: ScopeItem) => {
    setSelectedLocationId(item.location_id);
    setEditingItem(item);
    itemForm.setFieldsValue({
      item_type: item.item_type,
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      quantity_formula: item.quantity_formula,
      unit: item.unit,
      demolition_type_id: item.demolition_type_id,
      include_in_debris: item.include_in_debris,
      moisture_level: item.moisture_level
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
      message.error(error?.response?.data?.detail || 'Failed to save item');
      console.error('Save item error:', error);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    try {
      await waterMitigationService.scope.items.delete(itemId);
      message.success('Item deleted successfully');
      loadLocations();
    } catch (error: any) {
      message.error(error?.response?.data?.detail || 'Failed to delete item');
      console.error('Delete item error:', error);
    }
  };

  // Formula validation
  const validateFormula = async (formula: string) => {
    if (!formula || formula.trim() === '') {
      setFormulaResult(null);
      return;
    }
    try {
      const result = await waterMitigationService.scope.calculateFormula(formula);
      setFormulaResult({
        valid: result.success,
        result: result.result,
        error: result.error
      });
    } catch (error) {
      setFormulaResult({
        valid: false,
        error: 'Failed to validate formula'
      });
    }
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
      message.error(error?.response?.data?.detail || 'Failed to calculate debris');
      console.error('Calculate debris error:', error);
    } finally {
      setCalculatingDebris(false);
    }
  };

  // Seed default demolition types
  const handleSeedDemolitionTypes = async () => {
    try {
      await waterMitigationService.scope.demolitionTypes.seed();
      message.success('Default demolition types created');
      loadDemolitionTypes();
    } catch (error: any) {
      message.error(error?.response?.data?.detail || 'Failed to create demolition types');
      console.error('Seed demolition types error:', error);
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
          {record.demolition_type && (
            <Text type="secondary" style={{ fontSize: '12px' }}>
              {record.demolition_type.name}
            </Text>
          )}
        </Space>
      )
    },
    {
      title: 'Quantity',
      key: 'quantity',
      width: 150,
      render: (_: any, record: ScopeItem) => (
        <Space direction="vertical" size={0}>
          <Text>{record.quantity?.toLocaleString(undefined, { maximumFractionDigits: 2 })} {record.unit}</Text>
          {record.quantity_formula && (
            <Tooltip title={`Formula: ${record.quantity_formula}`}>
              <Text type="secondary" style={{ fontSize: '11px' }}>
                <CalculatorOutlined /> {record.quantity_formula}
              </Text>
            </Tooltip>
          )}
        </Space>
      )
    },
    {
      title: 'Moisture',
      dataIndex: 'moisture_level',
      key: 'moisture_level',
      width: 100,
      render: (level: string) => {
        const option = MOISTURE_LEVEL_OPTIONS.find(o => o.value === level);
        const color = level === 'dry' ? 'green' : level === 'damp' ? 'gold' : level === 'wet' ? 'orange' : 'red';
        return <Tag color={color}>{option?.label || level}</Tag>;
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
  const renderLocationHeader = (location: ScopeLocation) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
      <Space>
        <EnvironmentOutlined />
        <Text strong>{location.name}</Text>
        {location.floor && <Tag>{location.floor}</Tag>}
        {location.room_type && <Tag color="blue">{location.room_type}</Tag>}
        <Badge count={location.scope_items?.length || 0} style={{ backgroundColor: '#1890ff' }} />
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

  if (loading && locations.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '100px' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="wm-scope-tab">
      {/* Header */}
      <Card className="compact-card" style={{ marginBottom: 16 }}>
        <Row justify="space-between" align="middle">
          <Col>
            <Space>
              <Title level={5} style={{ margin: 0 }}>
                <ToolOutlined /> Scope of Work
              </Title>
              <Tag>{locations.length} Location(s)</Tag>
            </Space>
          </Col>
          <Col>
            <Space>
              {demolitionTypes.length === 0 && (
                <Button
                  onClick={handleSeedDemolitionTypes}
                  icon={<ReloadOutlined />}
                >
                  Initialize Demolition Types
                </Button>
              )}
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={handleAddLocation}
              >
                Add Location
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* Debris Calculation Summary */}
      {debrisCalculation && (
        <Card
          className="compact-card"
          style={{ marginBottom: 16 }}
          title={
            <Space>
              <CalculatorOutlined />
              <span>Debris Calculation Summary</span>
            </Space>
          }
          extra={
            <Button
              icon={<ReloadOutlined />}
              onClick={handleCalculateDebris}
              loading={calculatingDebris}
            >
              Recalculate
            </Button>
          }
        >
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
              {debrisCalculation.dumpster_recommendation && (
                <Statistic
                  title="Recommended Dumpster"
                  value={`${debrisCalculation.dumpster_recommendation.count}x ${debrisCalculation.dumpster_recommendation.size}`}
                />
              )}
            </Col>
            <Col span={6}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                Last calculated: {new Date(debrisCalculation.calculated_at).toLocaleString()}
              </Text>
            </Col>
          </Row>

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
        </Card>
      )}

      {/* Calculate Debris Button (if no calculation yet) */}
      {!debrisCalculation && locations.some(l => l.scope_items?.some(i => i.include_in_debris)) && (
        <Alert
          message="Debris calculation available"
          description="You have demolition items marked for debris calculation. Click the button to calculate total debris weight."
          type="info"
          showIcon
          action={
            <Button
              type="primary"
              icon={<CalculatorOutlined />}
              onClick={handleCalculateDebris}
              loading={calculatingDebris}
            >
              Calculate Debris
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      )}

      {/* Locations */}
      {locations.length === 0 ? (
        <Card className="compact-card">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No locations added yet"
          >
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAddLocation}>
              Add First Location
            </Button>
          </Empty>
        </Card>
      ) : (
        <Collapse
          accordion
          defaultActiveKey={locations[0]?.id}
          style={{ marginBottom: 16 }}
        >
          {locations.map((location) => (
            <Panel
              header={renderLocationHeader(location)}
              key={location.id}
            >
              {location.description && (
                <Alert
                  message={location.description}
                  type="info"
                  style={{ marginBottom: 16 }}
                />
              )}

              <Space style={{ marginBottom: 16 }}>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => handleAddItem(location.id, 'custom' as ScopeItemType)}
                >
                  Add Item
                </Button>
                <Button
                  icon={<AppstoreAddOutlined />}
                  onClick={() => handleAddStandardItems(location.id)}
                >
                  Add Standard Items
                </Button>
                <Button
                  icon={<ToolOutlined />}
                  onClick={() => handleAddItem(location.id, 'demolition' as ScopeItemType)}
                >
                  Add Demolition
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
            </Panel>
          ))}
        </Collapse>
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
        title={editingItem ? 'Edit Scope Item' : 'Add Scope Item'}
        open={itemModalVisible}
        onCancel={() => setItemModalVisible(false)}
        onOk={() => itemForm.submit()}
        width={600}
      >
        <Form
          form={itemForm}
          layout="vertical"
          onFinish={handleSaveItem}
          initialValues={{
            item_type: 'custom',
            unit: 'SF',
            include_in_debris: false,
            moisture_level: 'dry'
          }}
        >
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
            noStyle
            shouldUpdate={(prev, curr) => prev.item_type !== curr.item_type}
          >
            {({ getFieldValue }) => {
              const itemType = getFieldValue('item_type');

              if (itemType === 'standard') {
                return (
                  <Form.Item
                    name="name"
                    label="Standard Item"
                    rules={[{ required: true, message: 'Please select an item' }]}
                  >
                    <Select
                      placeholder="Select standard item"
                      options={STANDARD_SCOPE_ITEMS.map(item => ({
                        value: item.name,
                        label: `${item.name} (${item.unit})`
                      }))}
                      onChange={(value) => {
                        const item = STANDARD_SCOPE_ITEMS.find(i => i.name === value);
                        if (item) {
                          itemForm.setFieldValue('unit', item.unit);
                        }
                      }}
                    />
                  </Form.Item>
                );
              }

              if (itemType === 'demolition') {
                return (
                  <>
                    <Form.Item
                      name="demolition_type_id"
                      label="Demolition Type"
                      rules={[{ required: true, message: 'Please select demolition type' }]}
                    >
                      <Select
                        placeholder="Select demolition type"
                        showSearch
                        optionFilterProp="children"
                        options={demolitionTypes.map(dt => ({
                          value: dt.id,
                          label: `${dt.name}${dt.category ? ` (${dt.category})` : ''}`
                        }))}
                        onChange={(value) => {
                          const dt = demolitionTypes.find(d => d.id === value);
                          if (dt) {
                            itemForm.setFieldsValue({
                              name: dt.name,
                              unit: dt.default_unit,
                              include_in_debris: true
                            });
                          }
                        }}
                      />
                    </Form.Item>
                    <Form.Item
                      name="name"
                      label="Item Name"
                      rules={[{ required: true, message: 'Please enter item name' }]}
                    >
                      <Input placeholder="Auto-filled from demolition type or enter custom name" />
                    </Form.Item>
                  </>
                );
              }

              // Custom item type
              return (
                <Form.Item
                  name="name"
                  label="Item Name"
                  rules={[{ required: true, message: 'Please enter item name' }]}
                >
                  <Input placeholder="Enter custom item name" />
                </Form.Item>
              );
            }}
          </Form.Item>

          <Form.Item name="description" label="Description">
            <TextArea rows={2} placeholder="Additional notes" />
          </Form.Item>

          <Divider />

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="quantity"
                label={
                  <Space>
                    Quantity
                    <Tooltip title="Enter directly or use formula below">
                      <InfoCircleOutlined style={{ color: '#1890ff' }} />
                    </Tooltip>
                  </Space>
                }
              >
                <InputNumber
                  style={{ width: '100%' }}
                  placeholder="e.g., 120"
                  min={0}
                  precision={2}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="quantity_formula"
                label={
                  <Space>
                    Formula (optional)
                    <Tooltip title="Use formula like '10*12+5*8' to auto-calculate quantity">
                      <CalculatorOutlined style={{ color: '#1890ff' }} />
                    </Tooltip>
                  </Space>
                }
              >
                <Input
                  placeholder="e.g., 10*12+5*8"
                  onBlur={(e) => validateFormula(e.target.value)}
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
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="moisture_level"
                label="Moisture Level"
              >
                <Select
                  options={MOISTURE_LEVEL_OPTIONS.map(o => ({
                    value: o.value,
                    label: `${o.label} (×${o.multiplier})`
                  }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="include_in_debris"
                label="Include in Debris Calculation"
                valuePropName="checked"
              >
                <Select
                  options={[
                    { value: true, label: 'Yes - Include in debris weight' },
                    { value: false, label: 'No - Exclude from calculation' }
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
};

export default WaterMitigationScopeTab;
