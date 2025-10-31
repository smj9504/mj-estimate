/**
 * Pack-In/Out Calculator Page
 * Calculate materials and labor for packing/unpacking operations
 */

import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Card,
  Row,
  Col,
  Form,
  Input,
  Select,
  InputNumber,
  Button,
  Space,
  Switch,
  Radio,
  Divider,
  Typography,
  message,
  Table,
  Tag,
  Alert,
  Collapse,
  Tabs,
  Spin,
  Empty,
  Modal,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  CalculatorOutlined,
  SaveOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import {
  packCalculationAPI,
  itemMappingAPI,
  PackCalculationRequest,
  PackCalculationResult,
  PackCalculationDetail,
  FuzzyMatch,
} from '../services/packCalculationService';

const { Title, Text } = Typography;
const { Option } = Select;
const { TextArea } = Input;
const { Panel } = Collapse;
const { TabPane } = Tabs;

// Types
interface PackItem {
  key: string;
  item_name: string;
  item_category?: string;
  quantity: number;
  size_category?: string;
  floor_level: string;
  fragile: boolean;
  requires_disassembly: boolean;
  special_notes?: string;
}

interface PackRoom {
  key: string;
  room_name: string;
  floor_level: string;
  input_method: string;
  raw_input?: string;
  image_url?: string;
  items: PackItem[];
}

interface BuildingInfo {
  building_type: string;
  total_floors: number;
  has_elevator: boolean;
  access_type?: string;
}

const PackCalculator: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [rooms, setRooms] = useState<PackRoom[]>([]);
  const [buildingInfo, setBuildingInfo] = useState<BuildingInfo>({
    building_type: 'HOUSE',
    total_floors: 1,
    has_elevator: false,
  });
  const [calculationResult, setCalculationResult] = useState<PackCalculationResult | PackCalculationDetail | null>(null);

  // Correction modal state
  const [correctionModalVisible, setCorrectionModalVisible] = useState(false);
  const [correctionItem, setCorrectionItem] = useState<{
    original_name: string;
    matched_key: string;
    matched_materials: Record<string, number>;
  } | null>(null);
  const [correctionForm] = Form.useForm();
  const [seedCategories, setSeedCategories] = useState<Array<{
    value: string;
    label: string;
    category: string;
    size: string;
  }>>([]);

  // Load seed categories on mount
  useEffect(() => {
    const loadSeedCategories = async () => {
      try {
        const data = await itemMappingAPI.getSeedCategories();
        setSeedCategories(data.categories);
      } catch (error) {
        console.error('Failed to load seed categories:', error);
      }
    };
    loadSeedCategories();
  }, []);

  // Load existing calculation if ID is provided
  useEffect(() => {
    if (id) {
      loadCalculation(id);
    }
  }, [id]);

  const loadCalculation = async (calculationId: string) => {
    setLoadingData(true);
    try {
      const data = await packCalculationAPI.getById(calculationId);
      console.log('📝 Loaded calculation data:', data);
      console.log('📝 Loaded rooms (breakdown):', data.rooms);
      console.log('📝 Loaded detail_rooms:', (data as any).detail_rooms || (data as any).detailRooms);

      // Set form values
      form.setFieldsValue({
        calculation_name: data.calculation_name,
        project_address: data.project_address || '',
        notes: data.notes || '',
      });

      // Set building info from loaded data
      if (data.building_info) {
        setBuildingInfo({
          building_type: data.building_info.building_type,
          total_floors: data.building_info.total_floors,
          has_elevator: data.building_info.has_elevator,
        });
      }

      // Convert detail rooms (with items) to form state
      const detailRooms = (data as any).detail_rooms || (data as any).detailRooms;
      if (detailRooms && Array.isArray(detailRooms)) {
        const loadedRooms: PackRoom[] = detailRooms.map((room: any) => ({
          key: room.id,
          room_name: room.room_name,
          floor_level: room.floor_level,
          input_method: room.input_method,
          items: (room.items || []).map((item: any) => ({
            key: item.id,
            item_name: item.item_name,
            item_category: item.item_category,
            quantity: item.quantity,
            size_category: '',
            floor_level: item.floor_level,
            fragile: !!item.fragile,
            requires_disassembly: !!item.requires_disassembly,
            special_notes: item.special_notes || '',
          })),
        }));
        setRooms(loadedRooms);
      }
      setCalculationResult(data);
      message.success('Calculation loaded successfully!');
    } catch (error) {
      message.error('Failed to load calculation');
      console.error('Error loading calculation:', error);
    } finally {
      setLoadingData(false);
    }
  };

  // Add new room
  const handleAddRoom = () => {
    const newRoom: PackRoom = {
      key: Date.now().toString(),
      room_name: '',
      floor_level: 'MAIN_LEVEL',
      input_method: 'STRUCTURED',
      items: [],
    };
    setRooms([...rooms, newRoom]);
  };

  // Remove room
  const handleRemoveRoom = (roomKey: string) => {
    setRooms(rooms.filter(room => room.key !== roomKey));
  };

  // Update room
  const handleUpdateRoom = (roomKey: string, field: keyof PackRoom, value: any) => {
    setRooms(rooms.map(room =>
      room.key === roomKey ? { ...room, [field]: value } : room
    ));
  };

  // Add item to room
  const handleAddItem = (roomKey: string) => {
    const newItem: PackItem = {
      key: Date.now().toString(),
      item_name: '',
      quantity: 1,
      floor_level: 'MAIN_LEVEL',
      fragile: false,
      requires_disassembly: false,
    };

    setRooms(rooms.map(room => {
      if (room.key === roomKey) {
        return { ...room, items: [...room.items, newItem] };
      }
      return room;
    }));
  };

  // Remove item
  const handleRemoveItem = (roomKey: string, itemKey: string) => {
    setRooms(rooms.map(room => {
      if (room.key === roomKey) {
        return { ...room, items: room.items.filter(item => item.key !== itemKey) };
      }
      return room;
    }));
  };

  // Update item
  const handleUpdateItem = (
    roomKey: string,
    itemKey: string,
    field: keyof PackItem,
    value: any
  ) => {
    setRooms(rooms.map(room => {
      if (room.key === roomKey) {
        return {
          ...room,
          items: room.items.map(item =>
            item.key === itemKey ? { ...item, [field]: value } : item
          ),
        };
      }
      return room;
    }));
  };

  // Calculate
  const handleCalculate = async () => {
    // Validate
    if (rooms.length === 0) {
      message.warning('Please add at least one room');
      return;
    }

    const hasEmptyRooms = rooms.some(room => room.items.length === 0);
    if (hasEmptyRooms) {
      message.warning('All rooms must have at least one item');
      return;
    }

    setLoading(true);

    try {
      // Prepare request payload
      const payload: PackCalculationRequest = {
        calculation_name: form.getFieldValue('calculation_name') || 'Untitled Calculation',
        project_address: form.getFieldValue('project_address'),
        notes: form.getFieldValue('notes'),
        rooms: rooms.map(room => ({
          room_name: room.room_name,
          floor_level: room.floor_level,
          input_method: room.input_method as 'STRUCTURED' | 'TEXT' | 'IMAGE',
          raw_input: room.raw_input,
          items: room.items.map(item => {
            const itemPayload = {
              item_name: item.item_name,
              item_category: item.item_category,
              quantity: item.quantity,
              size_category: item.size_category,
              floor_level: item.floor_level,
              fragile: !!item.fragile,
              requires_disassembly: !!item.requires_disassembly,
              special_notes: item.special_notes,
            };
            console.log('Item payload:', item.item_name, itemPayload);
            return itemPayload;
          }),
        })),
        building_info: {
          building_type: buildingInfo.building_type as 'HOUSE' | 'APARTMENT' | 'CONDO' | 'COMMERCIAL',
          total_floors: buildingInfo.total_floors,
          has_elevator: buildingInfo.has_elevator,
        },
        auto_detect_strategies: true,
      };

      // Call API - update if editing, create if new
      const result = id
        ? await packCalculationAPI.update(id, payload)
        : await packCalculationAPI.calculate(payload);

      console.log('📊 Calculation result:', result);
      console.log('📊 Rooms:', result.rooms);

      setCalculationResult(result);
      message.success(id ? 'Calculation updated successfully!' : 'Calculation completed successfully!');

      // If this was a new calculation, update URL with the ID
      if (!id && result.id) {
        navigate(`/pack-calculator/${result.id}`, { replace: true });
      }

    } catch (error) {
      console.error('Calculation error:', error);
      message.error('Failed to calculate. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle opening correction modal
  const handleOpenCorrection = (match: FuzzyMatch) => {
    setCorrectionItem(match);
    correctionForm.setFieldsValue({
      item_name: match.original_name,
      matched_category: match.matched_key,
    });
    setCorrectionModalVisible(true);
  };

  // Handle saving correction
  const handleSaveCorrection = async () => {
    try {
      const values = await correctionForm.validateFields();

      // Create new mapping in database
      await itemMappingAPI.create({
        item_name: correctionItem!.original_name,
        xactimate_materials: values.xactimate_materials || correctionItem!.matched_materials,
        item_category: values.item_category,
        size_category: values.size_category,
        fragile: values.fragile || false,
        requires_disassembly: values.requires_disassembly || false,
      });

      message.success('Mapping correction saved! It will be used in future calculations.');
      setCorrectionModalVisible(false);
      setCorrectionItem(null);
      correctionForm.resetFields();
    } catch (error) {
      console.error('Failed to save correction:', error);
      message.error('Failed to save correction.');
    }
  };

  if (loadingData) {
    return (
      <div style={{ padding: '24px', textAlign: 'center' }}>
        <Spin size="large" tip="Loading calculation data..." />
      </div>
    );
  }

  return (
    <div style={{ padding: '24px' }}>
      <Title level={2}>
        <CalculatorOutlined /> {id ? 'Edit Pack Calculation' : 'Pack-In/Out Calculator'}
      </Title>
      <Text type="secondary">
        Calculate materials and labor for packing/unpacking operations with floor-level awareness
      </Text>

      <Divider />

      <Form form={form} layout="vertical">
        {/* Project Information */}
        <Card title="Project Information" style={{ marginBottom: 24 }}>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="calculation_name" label="Calculation Name">
                <Input placeholder="e.g., Smith Residence Pack-Out" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="project_address" label="Project Address">
                <Input placeholder="123 Main St, City, State" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="notes" label="Notes">
                <TextArea rows={1} placeholder="Additional notes..." />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        {/* Building Information */}
        <Card title="Building Information" style={{ marginBottom: 24 }}>
          <Row gutter={16}>
            <Col xs={24} md={6}>
              <Form.Item label="Building Type">
                <Select
                  value={buildingInfo.building_type}
                  onChange={val => setBuildingInfo({ ...buildingInfo, building_type: val })}
                >
                  <Option value="HOUSE">Single Family House</Option>
                  <Option value="APARTMENT">Apartment</Option>
                  <Option value="TOWNHOUSE">Townhouse</Option>
                  <Option value="CONDO">Condominium</Option>
                  <Option value="COMMERCIAL">Commercial</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item label="Total Floors">
                <InputNumber
                  min={1}
                  max={10}
                  value={buildingInfo.total_floors}
                  onChange={val => setBuildingInfo({ ...buildingInfo, total_floors: val || 1 })}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item label="Elevator Available">
                <Switch
                  checked={buildingInfo.has_elevator}
                  onChange={val => setBuildingInfo({ ...buildingInfo, has_elevator: val })}
                  checkedChildren="Yes"
                  unCheckedChildren="No"
                />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        {/* Rooms */}
        <Card
          title="Rooms & Items"
          extra={
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAddRoom}>
              Add Room
            </Button>
          }
          style={{ marginBottom: 24 }}
        >
          {rooms.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <Text type="secondary">No rooms added yet. Click "Add Room" to get started.</Text>
            </div>
          ) : (
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              {rooms.map((room, roomIndex) => (
                <Card
                  key={room.key}
                  size="small"
                  title={
                    <Space>
                      <Input
                        placeholder="Room name (e.g., Living Room)"
                        value={room.room_name}
                        onChange={e => handleUpdateRoom(room.key, 'room_name', e.target.value)}
                        style={{ width: 200 }}
                      />
                      <Select
                        value={room.floor_level}
                        onChange={val => handleUpdateRoom(room.key, 'floor_level', val)}
                        style={{ width: 150 }}
                      >
                        <Option value="BASEMENT">🏠 Basement</Option>
                        <Option value="MAIN_LEVEL">🏠 Main Level</Option>
                        <Option value="SECOND_FLOOR">🏢 2nd Floor</Option>
                        <Option value="THIRD_FLOOR">🏢 3rd Floor</Option>
                        <Option value="FOURTH_FLOOR">🏢 4th Floor+</Option>
                      </Select>
                    </Space>
                  }
                  extra={
                    <Button
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={() => handleRemoveRoom(room.key)}
                    >
                      Remove Room
                    </Button>
                  }
                >
                  {/* Items Table */}
                  <Table
                    dataSource={room.items}
                    pagination={false}
                    size="small"
                    rowKey="key"
                    columns={[
                      {
                        title: 'Item Name',
                        dataIndex: 'item_name',
                        width: 200,
                        render: (text, record) => (
                          <Input
                            placeholder="e.g., bed_queen, couch"
                            value={text}
                            onChange={e => handleUpdateItem(room.key, record.key, 'item_name', e.target.value)}
                          />
                        ),
                      },
                      {
                        title: 'Quantity',
                        dataIndex: 'quantity',
                        width: 100,
                        render: (text, record) => (
                          <InputNumber
                            min={1}
                            value={text}
                            onChange={val => handleUpdateItem(room.key, record.key, 'quantity', val || 1)}
                            style={{ width: '100%' }}
                          />
                        ),
                      },
                      {
                        title: 'Fragile',
                        dataIndex: 'fragile',
                        width: 80,
                        render: (text, record) => (
                          <Switch
                            checked={!!text}
                            onChange={val => {
                              console.log('Fragile toggle:', record.key, val);
                              handleUpdateItem(room.key, record.key, 'fragile', val);
                            }}
                          />
                        ),
                      },
                      {
                        title: 'Disassembly',
                        dataIndex: 'requires_disassembly',
                        width: 100,
                        render: (text, record) => (
                          <Switch
                            checked={!!text}
                            onChange={val => {
                              console.log('Disassembly toggle:', record.key, val);
                              handleUpdateItem(room.key, record.key, 'requires_disassembly', val);
                            }}
                          />
                        ),
                      },
                      {
                        title: 'Action',
                        width: 80,
                        render: (_, record) => (
                          <Button
                            danger
                            type="text"
                            size="small"
                            icon={<DeleteOutlined />}
                            onClick={() => handleRemoveItem(room.key, record.key)}
                          />
                        ),
                      },
                    ]}
                    footer={() => (
                      <Button
                        type="dashed"
                        icon={<PlusOutlined />}
                        onClick={() => handleAddItem(room.key)}
                        block
                      >
                        Add Item
                      </Button>
                    )}
                  />
                </Card>
              ))}
            </Space>
          )}
        </Card>

        {/* Calculate Button */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Button
            type="primary"
            size="large"
            icon={<CalculatorOutlined />}
            onClick={handleCalculate}
            loading={loading}
            disabled={rooms.length === 0}
          >
            Calculate Materials & Labor
          </Button>
        </div>

        {/* Results */}
        {calculationResult && (
          <Card title="Calculation Results">
            <Alert
              type="info"
              message={`ML Confidence: ${(calculationResult.ml_confidence * 100).toFixed(0)}%`}
              description={`Strategies: Material (${calculationResult.strategies_used.material_estimation}), Labor (${calculationResult.strategies_used.labor_calculation})`}
              style={{ marginBottom: 16 }}
            />

            <Tabs defaultActiveKey="rooms">
              <TabPane tab="Room Breakdown" key="rooms">
                {calculationResult.rooms && calculationResult.rooms.length > 0 ? (
                  <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    {calculationResult.rooms.map((room: any) => (
                      <Card
                        key={room.room_id}
                        size="small"
                        title={`${room.room_name} (${room.floor_level})`}
                        extra={<Tag color="blue">{room.item_count} items</Tag>}
                      >
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <div>
                            <Text strong>Labor Hours: </Text>
                            <Text>Pack-Out: {room.pack_out_labor_hours?.toFixed(1) || 0}h</Text>
                            <Divider type="vertical" />
                            <Text>Pack-In: {room.pack_in_labor_hours?.toFixed(1) || 0}h</Text>
                          </div>
                          {(room.explanation_pack_out || room.explanation_pack_in) && (
                            <Card size="small" type="inner" title="How we calculated">
                              {room.explanation_pack_out && (
                                <div style={{ marginBottom: 6 }}>
                                  <Text strong>Pack-Out: </Text>
                                  <Text>{room.explanation_pack_out}</Text>
                                </div>
                              )}
                              {room.explanation_pack_in && (
                                <div>
                                  <Text strong>Pack-In: </Text>
                                  <Text>{room.explanation_pack_in}</Text>
                                </div>
                              )}
                            </Card>
                          )}
                          {room.materials && room.materials.length > 0 && (
                            <Table
                              dataSource={room.materials}
                              pagination={false}
                              size="small"
                              columns={[
                                {
                                  title: 'Code',
                                  dataIndex: 'code',
                                  width: 120,
                                  render: (code: string) => <Tag>{code}</Tag>
                                },
                                {
                                  title: 'Description',
                                  dataIndex: 'description',
                                  ellipsis: true,
                                },
                                {
                                  title: 'Quantity',
                                  dataIndex: 'quantity',
                                  width: 100,
                                  render: (qty: number) => qty.toFixed(2)
                                },
                                {
                                  title: 'Unit',
                                  dataIndex: 'unit',
                                  width: 80,
                                },
                              ]}
                            />
                          )}
                        </Space>
                      </Card>
                    ))}
                  </Space>
                ) : (
                  <Empty description="No room breakdown available" />
                )}
              </TabPane>

              <TabPane tab="Pack-Out Materials" key="pack_out">
                {calculationResult.rooms && calculationResult.rooms.length > 0 ? (
                  <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    {calculationResult.rooms.map((room: any) => (
                      <Card
                        key={room.room_id}
                        size="small"
                        title={`${room.room_name} (${room.floor_level})`}
                        extra={<Tag color="blue">{room.item_count} items</Tag>}
                      >
                        {room.materials && room.materials.length > 0 ? (
                          <Table
                            dataSource={room.materials}
                            pagination={false}
                            size="small"
                            columns={[
                              { title: 'Code', dataIndex: 'code', width: 120, render: code => <Tag>{code}</Tag> },
                              { title: 'Description', dataIndex: 'description', ellipsis: true },
                              { title: 'Quantity', dataIndex: 'quantity', width: 100, render: qty => qty.toFixed(2) },
                              { title: 'Unit', dataIndex: 'unit', width: 80 },
                            ]}
                          />
                        ) : (
                          <Empty description="No materials for this room" />
                        )}
                      </Card>
                    ))}
                  </Space>
                ) : (
                  <Empty description="No room breakdown available" />
                )}
              </TabPane>

              <TabPane tab="Pack-Out Labor" key="labor_out">
                {calculationResult.rooms && calculationResult.rooms.length > 0 ? (
                  <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    {calculationResult.rooms.map((room: any) => (
                      <Card
                        key={room.room_id}
                        size="small"
                        title={`${room.room_name} (${room.floor_level})`}
                        extra={<Tag color="blue">{room.pack_out_labor_hours?.toFixed(1) || 0}h</Tag>}
                      >
                        {room.pack_out_labor && room.pack_out_labor.length > 0 ? (
                          <Table
                            dataSource={room.pack_out_labor}
                            pagination={false}
                            size="small"
                            columns={[
                              { title: 'Code', dataIndex: 'code', width: 120, render: code => <Tag color="blue">{code}</Tag> },
                              { title: 'Description', dataIndex: 'description', ellipsis: true },
                              { title: 'Hours', dataIndex: 'quantity', width: 100, render: qty => `${qty.toFixed(1)}` },
                              { title: 'Unit', dataIndex: 'unit', width: 80 },
                            ]}
                          />
                        ) : (
                          <Empty description="No labor for this room" />
                        )}
                      </Card>
                    ))}
                  </Space>
                ) : (
                  <Empty description="No room breakdown available" />
                )}
              </TabPane>

              <TabPane tab="Protection" key="protection">
                {calculationResult.explanation_protection && (
                  <Card size="small" type="inner" style={{ marginBottom: 16 }}>
                    <Text strong>Calculation: </Text>
                    <Text>{calculationResult.explanation_protection}</Text>
                  </Card>
                )}
                <Table
                  dataSource={calculationResult.protection}
                  pagination={false}
                  size="small"
                  columns={[
                    { title: 'Code', dataIndex: 'code', width: 120, render: code => <Tag color="orange">{code}</Tag> },
                    { title: 'Description', dataIndex: 'description', ellipsis: true },
                    { title: 'Quantity', dataIndex: 'quantity', width: 100, render: qty => qty.toFixed(2) },
                    { title: 'Unit', dataIndex: 'unit', width: 80 },
                  ]}
                />
              </TabPane>

              <TabPane tab="Pack-In Labor" key="labor_in">
                <Table
                  dataSource={calculationResult.pack_in_labor}
                  pagination={false}
                  size="small"
                  columns={[
                    { title: 'Code', dataIndex: 'code', width: 120, render: code => <Tag color="green">{code}</Tag> },
                    { title: 'Description', dataIndex: 'description', ellipsis: true },
                    { title: 'Hours', dataIndex: 'quantity', width: 100, render: qty => `${qty.toFixed(1)}` },
                    { title: 'Unit', dataIndex: 'unit', width: 80 },
                  ]}
                />
              </TabPane>

              <TabPane tab="Debris" key="debris">
                <Row gutter={16}>
                  <Col span={8}>
                    <Card size="small">
                      <div>Cardboard: {calculationResult.debris.cardboard_recyclable_lb} lbs</div>
                      <div>Plastic: {calculationResult.debris.plastic_waste_lb} lbs</div>
                      <div>Paper: {calculationResult.debris.paper_waste_lb} lbs</div>
                    </Card>
                  </Col>
                  <Col span={8}>
                    <Card size="small">
                      <div><strong>Total: {calculationResult.debris.total_debris_lb} lbs</strong></div>
                      <div><strong>({calculationResult.debris.total_debris_ton.toFixed(4)} tons)</strong></div>
                    </Card>
                  </Col>
                </Row>
              </TabPane>

              <TabPane tab="AI Insights" key="ai_insights">
                <Space direction="vertical" style={{ width: '100%' }} size="large">
                  {/* ML Confidence Score */}
                  <Card size="small" title="Machine Learning Confidence">
                    <Row gutter={16} align="middle">
                      <Col span={12}>
                        <div style={{ fontSize: '16px' }}>
                          <strong>Confidence Score:</strong>
                        </div>
                      </Col>
                      <Col span={12}>
                        <Tag color={calculationResult.ml_confidence >= 0.8 ? 'green' : calculationResult.ml_confidence >= 0.6 ? 'orange' : 'red'} style={{ fontSize: '16px', padding: '4px 12px' }}>
                          {(calculationResult.ml_confidence * 100).toFixed(1)}%
                        </Tag>
                      </Col>
                    </Row>
                    <div style={{ marginTop: '12px', color: '#666' }}>
                      {calculationResult.ml_confidence >= 0.8 && '✅ High confidence - calculations are reliable'}
                      {calculationResult.ml_confidence >= 0.6 && calculationResult.ml_confidence < 0.8 && '⚠️ Medium confidence - review recommended'}
                      {calculationResult.ml_confidence < 0.6 && '❌ Low confidence - manual verification required'}
                    </div>
                  </Card>

                  {/* Calculation Strategies */}
                  <Card size="small" title="Calculation Strategies Used">
                    <Row gutter={[16, 16]}>
                      <Col span={12}>
                        <Card size="small" type="inner" title="Material Estimation">
                          <Tag color="blue">{calculationResult.strategies_used?.material_estimation || 'Seed Data'}</Tag>
                          <div style={{ marginTop: '8px', fontSize: '12px', color: '#666' }}>
                            {calculationResult.strategies_used?.material_estimation === 'ml_model' && 'AI model predicted materials based on item characteristics'}
                            {calculationResult.strategies_used?.material_estimation === 'rule_based' && 'Rule-based calculation using predefined formulas'}
                            {!calculationResult.strategies_used?.material_estimation && 'Using seed data mappings for material estimation'}
                          </div>
                        </Card>
                      </Col>
                      <Col span={12}>
                        <Card size="small" type="inner" title="Labor Calculation">
                          <Tag color="blue">{calculationResult.strategies_used?.labor_calculation || 'Item-Based'}</Tag>
                          <div style={{ marginTop: '8px', fontSize: '12px', color: '#666' }}>
                            {calculationResult.strategies_used?.labor_calculation === 'ml_model' && 'AI model predicted labor hours'}
                            {calculationResult.strategies_used?.labor_calculation === 'item_based' && 'Calculated from item properties and floor levels'}
                            {!calculationResult.strategies_used?.labor_calculation && 'Standard time estimates per item'}
                          </div>
                        </Card>
                      </Col>
                      <Col span={12}>
                        <Card size="small" type="inner" title="Protection Estimate">
                          <Tag color="blue">{calculationResult.strategies_used?.protection_estimate || 'Building-Based'}</Tag>
                          <div style={{ marginTop: '8px', fontSize: '12px', color: '#666' }}>
                            Based on building type, floors, and access
                          </div>
                        </Card>
                      </Col>
                      <Col span={12}>
                        <Card size="small" type="inner" title="Debris Calculation">
                          <Tag color="blue">{calculationResult.strategies_used?.debris_calculation || 'Material-Based'}</Tag>
                          <div style={{ marginTop: '8px', fontSize: '12px', color: '#666' }}>
                            Calculated from packing materials used
                          </div>
                        </Card>
                      </Col>
                    </Row>
                  </Card>

                  {/* Fuzzy Matching Details */}
                  {calculationResult.strategies_used?.fuzzy_matching_used && calculationResult.strategies_used?.fuzzy_matches && calculationResult.strategies_used.fuzzy_matches.length > 0 && (
                    <Card size="small" title="Fuzzy Matching Details" style={{ marginTop: '16px' }}>
                      <Alert
                        message={`${calculationResult.strategies_used.fuzzy_matches.length} items were automatically matched`}
                        description="The following items were matched to known categories using intelligent fuzzy matching"
                        type="info"
                        showIcon
                        style={{ marginBottom: '16px' }}
                      />

                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ borderBottom: '2px solid #f0f0f0', backgroundColor: '#fafafa' }}>
                            <th style={{ padding: '8px', textAlign: 'left' }}>Your Input</th>
                            <th style={{ padding: '8px', textAlign: 'center' }}>→</th>
                            <th style={{ padding: '8px', textAlign: 'left' }}>Matched Category</th>
                            <th style={{ padding: '8px', textAlign: 'left' }}>Materials Applied</th>
                            <th style={{ padding: '8px', textAlign: 'center' }}>Qty</th>
                            <th style={{ padding: '8px', textAlign: 'center' }}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {calculationResult.strategies_used.fuzzy_matches.map((match, index) => (
                            <tr key={index} style={{ borderBottom: '1px solid #f0f0f0' }}>
                              <td style={{ padding: '8px' }}>
                                <strong>{match.original_name}</strong>
                              </td>
                              <td style={{ padding: '8px', textAlign: 'center', color: '#1890ff' }}>
                                →
                              </td>
                              <td style={{ padding: '8px' }}>
                                <Tag color="green">{match.matched_key.replace(/_/g, ' ')}</Tag>
                              </td>
                              <td style={{ padding: '8px' }}>
                                {Object.entries(match.matched_materials).map(([code, qty], i) => (
                                  <Tag key={i} color="blue" style={{ marginBottom: '4px' }}>
                                    {code}: {qty}
                                  </Tag>
                                ))}
                              </td>
                              <td style={{ padding: '8px', textAlign: 'center' }}>
                                <Tag>{match.quantity}</Tag>
                              </td>
                              <td style={{ padding: '8px', textAlign: 'center' }}>
                                <Button
                                  size="small"
                                  type="link"
                                  onClick={() => handleOpenCorrection(match)}
                                >
                                  Correct
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </Card>
                  )}

                  {/* Review Recommendation */}
                  {calculationResult.needs_review && (
                    <Alert
                      message="Manual Review Recommended"
                      description="This calculation may benefit from manual review and adjustment based on specific project requirements."
                      type="warning"
                      showIcon
                    />
                  )}
                </Space>
              </TabPane>
            </Tabs>

            <Divider />

            <Space>
              <Button 
                icon={<SaveOutlined />} 
                onClick={handleCalculate}
                loading={loading}
              >
                Save Calculation
              </Button>
              <Button icon={<DownloadOutlined />}>Export to Xactimate</Button>
            </Space>
          </Card>
        )}
      </Form>

      {/* Correction Modal */}
      <Modal
        title="Correct Item Mapping"
        open={correctionModalVisible}
        onOk={handleSaveCorrection}
        onCancel={() => {
          setCorrectionModalVisible(false);
          setCorrectionItem(null);
          correctionForm.resetFields();
        }}
        width={600}
      >
        {correctionItem && (
          <Form form={correctionForm} layout="vertical">
            <Alert
              message="Incorrect Mapping Detected"
              description={`"${correctionItem.original_name}" was matched to "${correctionItem.matched_key.replace(/_/g, ' ')}". Please correct the mapping below.`}
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
            />

            <Form.Item label="Item Name" name="item_name">
              <Input disabled />
            </Form.Item>

            <Form.Item label="Current Matched Category" name="matched_category">
              <Input disabled />
            </Form.Item>

            <Form.Item
              label="Correct Category (Select from seed mappings)"
              name="item_category"
              rules={[{ required: true, message: 'Please select the correct category' }]}
              help="Select the most appropriate category that matches this item"
            >
              <Select
                placeholder="Search and select category..."
                showSearch
                filterOption={(input, option) =>
                  (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                }
                options={seedCategories.map(cat => ({
                  value: cat.value,
                  label: `${cat.label} (${cat.size})`,
                }))}
              />
            </Form.Item>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="Fragile" name="fragile" valuePropName="checked">
                  <Switch />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="Requires Disassembly" name="requires_disassembly" valuePropName="checked">
                  <Switch />
                </Form.Item>
              </Col>
            </Row>

            <Alert
              message="Note"
              description="This correction will be saved and automatically applied to future calculations with the same item name."
              type="info"
              showIcon
            />
          </Form>
        )}
      </Modal>
    </div>
  );
};

export default PackCalculator;
