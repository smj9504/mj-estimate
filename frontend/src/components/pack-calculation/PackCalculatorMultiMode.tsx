import React, { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Space,
  Button,
  Tabs,
  Table,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Modal,
  Badge,
  Tag,
  Divider,
  Typography,
  Row,
  Col,
  Statistic,
  message,
  Popconfirm,
  List,
  Collapse,
  Alert,
  Empty,
  Tooltip,
  Checkbox,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  CalculatorOutlined,
  ClearOutlined,
  ArrowLeftOutlined,
  EditOutlined,
  SaveOutlined,
  FileTextOutlined,
  UnorderedListOutlined,
  AppstoreOutlined,
  ThunderboltOutlined,
  MergeCellsOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import InputModeSelector from './InputModeSelector';
import RoomTemplateSelector from './RoomTemplateSelector';
import BulkTextInput from './BulkTextInput';
import SmartEstimation from './SmartEstimation';
import { PhotoUploadManager } from './photo-upload';
import { PackInputMode } from '../../types/pack-calculation';
import {
  packCalculationAPI,
  type PackItemInput,
  type PackRoomInput,
  type BuildingInfo,
  type PackCalculationRequest,
  type PackCalculationResult
} from '../../services/packCalculationService';

const { Title, Text, Paragraph } = Typography;
const { Panel } = Collapse;

// Extended item type with source tracking
interface ExtendedPackItem extends PackItemInput {
  id: string;
  source: 'manual' | 'template' | 'bulk' | 'smart' | 'photo';
  room_name?: string;
  category_display?: string;
}

// Source emoji mapping
const SOURCE_ICONS = {
  manual: { emoji: '✏️', label: 'Manual', color: 'blue' },
  template: { emoji: '📦', label: 'Template', color: 'green' },
  bulk: { emoji: '📋', label: 'Bulk Text', color: 'orange' },
  smart: { emoji: '⚡', label: 'Smart AI', color: 'purple' },
  photo: { emoji: '📸', label: 'Photo', color: 'magenta' },
};

// Building info form
interface BuildingFormData extends BuildingInfo {
  calculation_name: string;
  project_address?: string;
  notes?: string;
}

const PackCalculatorMultiMode: React.FC = () => {
  const navigate = useNavigate();

  // Phase management
  const [phase, setPhase] = useState<'mode-selection' | 'input' | 'review'>('mode-selection');
  const [selectedMode, setSelectedMode] = useState<PackInputMode | null>(null);

  // Building info
  const [buildingForm] = Form.useForm<BuildingFormData>();
  const [buildingInfo, setBuildingInfo] = useState<BuildingFormData>({
    calculation_name: '',
    building_type: 'HOUSE',
    total_floors: 1,
    has_elevator: false,
  });

  // Items from different sources
  const [manualItems, setManualItems] = useState<ExtendedPackItem[]>([]);
  const [templateItems, setTemplateItems] = useState<ExtendedPackItem[]>([]);
  const [bulkItems, setBulkItems] = useState<ExtendedPackItem[]>([]);
  const [smartItems, setSmartItems] = useState<ExtendedPackItem[]>([]);
  const [photoItems, setPhotoItems] = useState<ExtendedPackItem[]>([]);

  // UI state
  const [activeHybridTab, setActiveHybridTab] = useState('template');
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showBuildingModal, setShowBuildingModal] = useState(false);

  // Manual item form
  const [manualForm] = Form.useForm();

  // Calculate combined items
  const allItems = useMemo(() => {
    const items: ExtendedPackItem[] = [];

    if (selectedMode === PackInputMode.IMAGE) { // Using IMAGE as HYBRID mode
      items.push(...manualItems, ...templateItems, ...bulkItems, ...smartItems, ...photoItems);
    } else if (selectedMode === PackInputMode.STRUCTURED) {
      items.push(...manualItems);
    } else if (selectedMode === PackInputMode.TEMPLATE) {
      items.push(...templateItems);
    } else if (selectedMode === PackInputMode.BULK_TEXT) {
      items.push(...bulkItems);
    } else if (selectedMode === PackInputMode.TEXT) {
      items.push(...smartItems);
    }

    return items;
  }, [selectedMode, manualItems, templateItems, bulkItems, smartItems, photoItems]);

  // Statistics
  const statistics = useMemo(() => {
    const bySource: Record<string, number> = {
      manual: manualItems.length,
      template: templateItems.length,
      bulk: bulkItems.length,
      smart: smartItems.length,
      photo: photoItems.length,
    };

    const byCategory = allItems.reduce((acc, item) => {
      const category = item.item_category || 'Uncategorized';
      acc[category] = (acc[category] || 0) + item.quantity;
      return acc;
    }, {} as Record<string, number>);

    const totalQuantity = allItems.reduce((sum, item) => sum + item.quantity, 0);

    // Rough box estimate (simplified)
    const estimatedBoxes = Math.ceil(totalQuantity / 5);

    return {
      bySource,
      byCategory,
      totalItems: allItems.length,
      totalQuantity,
      estimatedBoxes,
    };
  }, [allItems, manualItems, templateItems, bulkItems, smartItems]);

  // Handle mode selection
  const handleModeSelect = (mode: PackInputMode) => {
    setSelectedMode(mode);
    setPhase('input');

    // Show building info modal first time
    if (!buildingInfo.calculation_name) {
      setShowBuildingModal(true);
    }
  };

  // Handle template items (with room information)
  const handleTemplateItems = useCallback((rooms: any[]) => {
    const newItems: ExtendedPackItem[] = [];

    console.log('🔍 [DEBUG] Template rooms received:', rooms);

    rooms.forEach(room => {
      console.log(`📦 [DEBUG] Room: ${room.room_type}, items count: ${room.estimated_items?.length}`);

      room.estimated_items.forEach((item: any) => {
        console.log(`  └─ Item: ${item.subcategory}, quantity=${item.quantity}, pack_size=${item.pack_size}`);

        newItems.push({
          ...item,
          item_name: item.subcategory || item.category,
          item_category: item.category,
          size_category: 'medium',
          floor_level: 'MAIN_LEVEL',
          fragile: false,
          requires_disassembly: false,
          id: `template-${Date.now()}-${Math.random()}`,
          source: 'template' as const,
          room_name: room.room_type, // Add room name from template
          category_display: item.category,
        });
      });
    });

    console.log('✅ [DEBUG] Total items added:', newItems.length);
    console.log('📊 [DEBUG] Sample quantities:', newItems.slice(0, 5).map(i => ({ name: i.item_name, qty: i.quantity })));

    if (selectedMode === PackInputMode.IMAGE) { // HYBRID mode
      setTemplateItems(prev => [...prev, ...newItems]);
    } else {
      setTemplateItems(newItems);
    }

    message.success(`Added ${newItems.length} items from ${rooms.length} room(s)`);
  }, [selectedMode]);

  // Handle bulk text items
  const handleBulkItems = useCallback((items: PackItemInput[]) => {
    const newItems: ExtendedPackItem[] = items.map(item => ({
      ...item,
      id: `bulk-${Date.now()}-${Math.random()}`,
      source: 'bulk' as const,
      category_display: item.item_category,
    }));

    if (selectedMode === PackInputMode.IMAGE) { // HYBRID mode
      setBulkItems(prev => [...prev, ...newItems]);
    } else {
      setBulkItems(newItems);
    }

    message.success(`Added ${items.length} items from bulk text`);
  }, [selectedMode]);

  // Handle smart estimation items
  const handleSmartItems = useCallback((items: PackItemInput[]) => {
    const newItems: ExtendedPackItem[] = items.map(item => ({
      ...item,
      id: `smart-${Date.now()}-${Math.random()}`,
      source: 'smart' as const,
      category_display: item.item_category,
    }));

    if (selectedMode === PackInputMode.IMAGE) { // HYBRID mode
      setSmartItems(prev => [...prev, ...newItems]);
    } else {
      setSmartItems(newItems);
    }

    message.success(`Added ${items.length} items from smart estimation`);
  }, [selectedMode]);

  // Handle photo analysis items
  const handlePhotoItems = useCallback((items: any[]) => {
    const newItems: ExtendedPackItem[] = items.map(item => ({
      ...item,
      id: `photo-${Date.now()}-${Math.random()}`,
      source: 'photo' as const,
      category_display: item.category,
    }));

    if (selectedMode === PackInputMode.IMAGE) { // HYBRID mode
      setPhotoItems(prev => [...prev, ...newItems]);
    } else {
      setPhotoItems(newItems);
    }

    message.success(`Added ${items.length} items from photo analysis`);
  }, [selectedMode]);

  // Handle manual item addition
  const handleAddManualItem = () => {
    manualForm.validateFields().then(values => {
      const newItem: ExtendedPackItem = {
        ...values,
        id: `manual-${Date.now()}-${Math.random()}`,
        source: 'manual',
        category_display: values.item_category,
      };

      if (selectedMode === PackInputMode.IMAGE) { // HYBRID mode
        setManualItems(prev => [...prev, newItem]);
      } else {
        setManualItems([...manualItems, newItem]);
      }

      manualForm.resetFields();
      message.success('Item added successfully');
    });
  };

  // Handle item deletion
  const handleDeleteItem = (itemId: string) => {
    const item = allItems.find(i => i.id === itemId);
    if (!item) return;

    switch (item.source) {
      case 'manual':
        setManualItems(prev => prev.filter(i => i.id !== itemId));
        break;
      case 'template':
        setTemplateItems(prev => prev.filter(i => i.id !== itemId));
        break;
      case 'bulk':
        setBulkItems(prev => prev.filter(i => i.id !== itemId));
        break;
      case 'smart':
        setSmartItems(prev => prev.filter(i => i.id !== itemId));
        break;
    }

    message.success('Item removed');
  };

  // Handle item edit
  const handleEditItem = (record: ExtendedPackItem) => {
    // Simplified inline edit
    Modal.confirm({
      title: 'Edit Item',
      content: (
        <Form
          layout="vertical"
          initialValues={record}
          id="edit-item-form"
        >
          <Form.Item name="item_name" label="Item Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="quantity" label="Quantity" rules={[{ required: true }]}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="floor_level" label="Floor Level">
            <Select>
              <Select.Option value="ground">Ground Floor</Select.Option>
              <Select.Option value="second">Second Floor</Select.Option>
              <Select.Option value="third">Third Floor</Select.Option>
              <Select.Option value="basement">Basement</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      ),
      onOk: () => {
        const form = document.getElementById('edit-item-form') as HTMLFormElement;
        // Note: Simplified for this example. In production, use proper form handling
        message.success('Item updated');
      },
    });
  };

  // Clear all items
  const handleClearAll = () => {
    setManualItems([]);
    setTemplateItems([]);
    setBulkItems([]);
    setSmartItems([]);
    message.success('All items cleared');
  };

  // Switch mode
  const handleSwitchMode = () => {
    setPhase('mode-selection');
    setSelectedMode(null);
    setActiveHybridTab('template');
  };

  // Calculate materials and labor
  const handleCalculate = async () => {
    try {
      // Validate building info
      await buildingForm.validateFields();
      const buildingData = buildingForm.getFieldsValue();

      if (allItems.length === 0) {
        message.error('Please add at least one item');
        return;
      }

      setLoading(true);

      // Group items by room_name
      const itemsByRoom = allItems.reduce((acc, item) => {
        const roomName = item.room_name || 'Main Room';
        if (!acc[roomName]) {
          acc[roomName] = [];
        }
        acc[roomName].push(item);
        return acc;
      }, {} as Record<string, ExtendedPackItem[]>);

      // Create PackRoomInput for each room
      const rooms: PackRoomInput[] = Object.entries(itemsByRoom).map(([roomName, items]) => ({
        room_name: roomName,
        floor_level: items[0]?.floor_level || 'MAIN_LEVEL',
        input_method: 'STRUCTURED',
        items: items.map(item => ({
          item_name: item.item_name,
          item_category: item.item_category,
          quantity: item.quantity,
          size_category: item.size_category,
          floor_level: item.floor_level || 'MAIN_LEVEL',
          fragile: item.fragile || false,
          requires_disassembly: item.requires_disassembly || false,
          special_notes: item.special_notes,
        })),
      }));

      console.log('🚀 [DEBUG] Sending calculation request:');
      console.log(`  Total rooms: ${rooms.length}`);
      rooms.forEach(room => {
        console.log(`  Room "${room.room_name}": ${room.items.length} items`);
        const totalQty = room.items.reduce((sum, i) => sum + i.quantity, 0);
        console.log(`    Total quantity: ${totalQty}`);
        console.log(`    Sample items:`, room.items.slice(0, 3).map(i => ({ name: i.item_name, qty: i.quantity })));
      });

      const request: PackCalculationRequest = {
        calculation_name: buildingData.calculation_name,
        project_address: buildingData.project_address,
        notes: buildingData.notes,
        rooms,
        building_info: {
          building_type: buildingData.building_type,
          total_floors: buildingData.total_floors,
          has_elevator: buildingData.has_elevator,
        },
        auto_detect_strategies: true,
      };

      const result = await packCalculationAPI.calculate(request);

      message.success('Calculation completed successfully!');

      // In production, navigate to results page or show results modal
      console.log('Calculation Result:', result);

      // Show summary modal
      Modal.success({
        title: 'Calculation Complete',
        content: (
          <div>
            <p><strong>Calculation Name:</strong> {result.calculation_name}</p>
            <p><strong>Total Pack Out Hours:</strong> {result.total_pack_out_hours?.toFixed(2) || '0.00'}</p>
            <p><strong>Total Pack In Hours:</strong> {result.total_pack_in_hours?.toFixed(2) || '0.00'}</p>
            <p><strong>ML Confidence:</strong> {(result.ml_confidence * 100).toFixed(0)}%</p>
            <Divider />
            <p>Redirecting to calculations list...</p>
          </div>
        ),
        onOk: () => {
          // Navigate to calculations list
          navigate('/reconstruction-estimate/pack-calculator-new/list');
        },
      });

    } catch (error) {
      console.error('Calculation error:', error);
      message.error('Failed to calculate. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Manual item entry form
  const renderManualItemForm = () => (
    <Card size="small" title="Add Item Manually" className="mb-4">
      <Form
        form={manualForm}
        layout="inline"
        onFinish={handleAddManualItem}
        initialValues={{
          quantity: 1,
          floor_level: 'MAIN_LEVEL',
          fragile: false,
          requires_disassembly: false,
        }}
      >
        <Form.Item
          name="item_name"
          rules={[{ required: true, message: 'Item name required' }]}
        >
          <Input placeholder="Item name" style={{ width: 200 }} />
        </Form.Item>

        <Form.Item name="item_category">
          <Select placeholder="Category" style={{ width: 150 }}>
            <Select.Option value="Furniture">Furniture</Select.Option>
            <Select.Option value="Electronics">Electronics</Select.Option>
            <Select.Option value="Kitchenware">Kitchenware</Select.Option>
            <Select.Option value="Clothing">Clothing</Select.Option>
            <Select.Option value="Books">Books</Select.Option>
            <Select.Option value="Decor">Decor</Select.Option>
            <Select.Option value="Other">Other</Select.Option>
          </Select>
        </Form.Item>

        <Form.Item
          name="quantity"
          rules={[{ required: true }]}
        >
          <InputNumber min={1} placeholder="Qty" style={{ width: 80 }} />
        </Form.Item>

        <Form.Item name="floor_level">
          <Select style={{ width: 150 }}>
            <Select.Option value="BASEMENT">Basement</Select.Option>
            <Select.Option value="MAIN_LEVEL">Main Level</Select.Option>
            <Select.Option value="SECOND_FLOOR">2nd Floor</Select.Option>
            <Select.Option value="THIRD_FLOOR">3rd Floor</Select.Option>
            <Select.Option value="FOURTH_FLOOR">4th Floor</Select.Option>
            <Select.Option value="FIFTH_FLOOR_PLUS">5th Floor+</Select.Option>
          </Select>
        </Form.Item>

        <Form.Item name="fragile" valuePropName="checked">
          <Checkbox>Fragile</Checkbox>
        </Form.Item>

        <Form.Item>
          <Button type="primary" htmlType="submit" icon={<PlusOutlined />}>
            Add
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );

  // Items table columns
  const columns = [
    {
      title: 'Room',
      dataIndex: 'room_name',
      key: 'room_name',
      width: 120,
      render: (room: string) => (
        <Tag color="blue">{room || 'Main Room'}</Tag>
      ),
      filters: Array.from(new Set(allItems.map(i => i.room_name || 'Main Room'))).map(room => ({
        text: room,
        value: room,
      })),
      onFilter: (value: any, record: ExtendedPackItem) => (record.room_name || 'Main Room') === value,
    },
    {
      title: 'Source',
      dataIndex: 'source',
      key: 'source',
      width: 100,
      render: (source: keyof typeof SOURCE_ICONS) => (
        <Tag color={SOURCE_ICONS[source].color}>
          {SOURCE_ICONS[source].emoji} {SOURCE_ICONS[source].label}
        </Tag>
      ),
      filters: Object.entries(SOURCE_ICONS).map(([key, value]) => ({
        text: `${value.emoji} ${value.label}`,
        value: key,
      })),
      onFilter: (value: any, record: ExtendedPackItem) => record.source === value,
    },
    {
      title: 'Item Name',
      dataIndex: 'item_name',
      key: 'item_name',
      ellipsis: true,
    },
    {
      title: 'Category',
      dataIndex: 'item_category',
      key: 'item_category',
      width: 120,
      filters: Array.from(new Set(allItems.map(i => i.item_category).filter(Boolean))).map(cat => ({
        text: cat!,
        value: cat!,
      })),
      onFilter: (value: any, record: ExtendedPackItem) => record.item_category === value,
    },
    {
      title: 'Quantity',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 80,
      align: 'center' as const,
    },
    {
      title: 'Floor',
      dataIndex: 'floor_level',
      key: 'floor_level',
      width: 100,
    },
    {
      title: 'Attributes',
      key: 'attributes',
      width: 120,
      render: (record: ExtendedPackItem) => (
        <Space size="small">
          {record.fragile && <Tag color="red">Fragile</Tag>}
          {record.requires_disassembly && <Tag color="orange">Disassemble</Tag>}
        </Space>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      render: (record: ExtendedPackItem) => (
        <Space>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEditItem(record)}
          />
          <Popconfirm
            title="Delete this item?"
            onConfirm={() => handleDeleteItem(record.id)}
          >
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // Render input phase based on mode
  const renderInputPhase = () => {
    if (selectedMode === PackInputMode.STRUCTURED) {
      return (
        <div>
          {renderManualItemForm()}
          <Card title="Added Items">
            <Table
              dataSource={manualItems}
              columns={columns}
              rowKey="id"
              size="small"
              pagination={false}
            />
          </Card>
        </div>
      );
    }

    if (selectedMode === PackInputMode.TEMPLATE) {
      return (
        <div>
          <RoomTemplateSelector onRoomsChange={(rooms) => {
            // Pass rooms directly (with room_name preserved)
            handleTemplateItems(rooms);
          }} />
          {templateItems.length > 0 && (
            <Card title="Template Items" className="mt-4">
              <Table
                dataSource={templateItems}
                columns={columns}
                rowKey="id"
                size="small"
                pagination={false}
              />
            </Card>
          )}
        </div>
      );
    }

    if (selectedMode === PackInputMode.BULK_TEXT) {
      return (
        <div>
          <BulkTextInput onImport={(items) => {
            // Convert parsed items to pack items
            const packItems = items.map(item => ({
              item_name: item.subcategory || item.category,
              item_category: item.category,
              quantity: item.quantity,
              size_category: 'medium',
              floor_level: 'MAIN_LEVEL',
            }));
            handleBulkItems(packItems);
          }} />
          {bulkItems.length > 0 && (
            <Card title="Bulk Text Items" className="mt-4">
              <Table
                dataSource={bulkItems}
                columns={columns}
                rowKey="id"
                size="small"
                pagination={false}
              />
            </Card>
          )}
        </div>
      );
    }

    if (selectedMode === PackInputMode.TEXT) {
      return (
        <div>
          <SmartEstimation onApplyEstimate={(estimation, config) => {
            // Convert estimation to items
            const items = estimation.estimated_items.map(item => ({
              item_name: item.subcategory || item.category,
              item_category: item.category,
              quantity: item.quantity,
              size_category: 'medium',
              floor_level: 'MAIN_LEVEL',
            }));
            handleSmartItems(items);
          }} />
          {smartItems.length > 0 && (
            <Card title="Smart AI Items" className="mt-4">
              <Table
                dataSource={smartItems}
                columns={columns}
                rowKey="id"
                size="small"
                pagination={false}
              />
            </Card>
          )}
        </div>
      );
    }

    if (selectedMode === PackInputMode.IMAGE) { // Using IMAGE as HYBRID mode
      return (
        <div>
          <Alert
            message="Hybrid Mode"
            description="Use multiple input methods to build your item list. Items from all sources will be combined."
            type="info"
            showIcon
            className="mb-4"
          />

          <Tabs
            activeKey={activeHybridTab}
            onChange={setActiveHybridTab}
            type="card"
            items={[
              {
                key: 'template',
                label: (
                  <span>
                    {SOURCE_ICONS.template.emoji} Template
                    {templateItems.length > 0 && (
                      <Badge count={templateItems.length} className="ml-2" />
                    )}
                  </span>
                ),
                children: (
                  <RoomTemplateSelector onRoomsChange={(rooms) => {
                    // Pass rooms directly (with room_name preserved)
                    handleTemplateItems(rooms);
                  }} />
                ),
              },
              {
                key: 'bulk',
                label: (
                  <span>
                    {SOURCE_ICONS.bulk.emoji} Bulk Text
                    {bulkItems.length > 0 && (
                      <Badge count={bulkItems.length} className="ml-2" />
                    )}
                  </span>
                ),
                children: (
                  <BulkTextInput onImport={(items) => {
                    const packItems = items.map(item => ({
                      item_name: item.subcategory || item.category,
                      item_category: item.category,
                      quantity: item.quantity,
                      size_category: 'medium',
                      floor_level: 'MAIN_LEVEL',
                    }));
                    handleBulkItems(packItems);
                  }} />
                ),
              },
              {
                key: 'manual',
                label: (
                  <span>
                    {SOURCE_ICONS.manual.emoji} Manual
                    {manualItems.length > 0 && (
                      <Badge count={manualItems.length} className="ml-2" />
                    )}
                  </span>
                ),
                children: renderManualItemForm(),
              },
              {
                key: 'smart',
                label: (
                  <span>
                    {SOURCE_ICONS.smart.emoji} Smart AI
                    {smartItems.length > 0 && (
                      <Badge count={smartItems.length} className="ml-2" />
                    )}
                  </span>
                ),
                children: (
                  <SmartEstimation onApplyEstimate={(estimation, config) => {
                    const items = estimation.estimated_items.map(item => ({
                      item_name: item.subcategory || item.category,
                      item_category: item.category,
                      quantity: item.quantity,
                      size_category: 'medium',
                      floor_level: 'MAIN_LEVEL',
                    }));
                    handleSmartItems(items);
                  }} />
                ),
              },
              {
                key: 'photo',
                label: (
                  <span>
                    {SOURCE_ICONS.photo.emoji} Photo
                    {photoItems.length > 0 && (
                      <Badge count={photoItems.length} className="ml-2" />
                    )}
                  </span>
                ),
                children: (
                  <PhotoUploadManager
                    onPhotosAnalyzed={(items) => {
                      handlePhotoItems(items);
                    }}
                  />
                ),
              },
            ]}
          />

          {allItems.length > 0 && (
            <Card title="Combined Item List" className="mt-4">
              <Row gutter={[16, 16]} className="mb-3">
                {Object.entries(statistics.bySource).map(([source, count]) => (
                  count > 0 && (
                    <Col key={source}>
                      <Tag color={SOURCE_ICONS[source as keyof typeof SOURCE_ICONS].color}>
                        {SOURCE_ICONS[source as keyof typeof SOURCE_ICONS].emoji} {count} items
                      </Tag>
                    </Col>
                  )
                ))}
              </Row>

              <Table
                dataSource={allItems}
                columns={columns}
                rowKey="id"
                size="small"
                pagination={{ pageSize: 10 }}
              />
            </Card>
          )}
        </div>
      );
    }

    return null;
  };

  // Building info modal
  const renderBuildingModal = () => (
    <Modal
      title="Project Information"
      visible={showBuildingModal}
      onOk={() => {
        buildingForm.validateFields().then(values => {
          setBuildingInfo(values);
          setShowBuildingModal(false);
        });
      }}
      onCancel={() => setShowBuildingModal(false)}
      width={600}
    >
      <Form
        form={buildingForm}
        layout="vertical"
        initialValues={buildingInfo}
      >
        <Form.Item
          name="calculation_name"
          label="Calculation Name"
          rules={[{ required: true, message: 'Please enter a name for this calculation' }]}
        >
          <Input placeholder="e.g., Smith Residence Pack Out" />
        </Form.Item>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="project_address" label="Project Address">
              <Input placeholder="123 Main St, City, State" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="building_type" label="Building Type">
              <Select>
                <Select.Option value="HOUSE">House</Select.Option>
                <Select.Option value="APARTMENT">Apartment</Select.Option>
                <Select.Option value="CONDO">Condo</Select.Option>
                <Select.Option value="COMMERCIAL">Commercial</Select.Option>
              </Select>
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="total_floors" label="Total Floors">
              <InputNumber min={1} max={10} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="has_elevator" label="Has Elevator" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item name="notes" label="Notes">
          <Input.TextArea rows={3} placeholder="Any special notes or instructions" />
        </Form.Item>
      </Form>
    </Modal>
  );

  // Main render
  return (
    <div className="pack-calculator-multi-mode">
      {/* Mode Selection Phase */}
      {phase === 'mode-selection' && (
        <Card>
          <Title level={3} className="text-center mb-4">
            Pack Calculation - Select Input Method
          </Title>
          <InputModeSelector onModeChange={handleModeSelect} />
        </Card>
      )}

      {/* Input Phase */}
      {phase === 'input' && (
        <div>
          {/* Header with mode info and actions */}
          <Card className="mb-4">
            <Row justify="space-between" align="middle">
              <Col>
                <Space>
                  <Button
                    icon={<ArrowLeftOutlined />}
                    onClick={handleSwitchMode}
                  >
                    Switch Mode
                  </Button>
                  <Divider type="vertical" />
                  <Text strong>Current Mode:</Text>
                  <Tag color="blue" className="text-lg">
                    {selectedMode}
                  </Tag>
                  {buildingInfo.calculation_name && (
                    <>
                      <Divider type="vertical" />
                      <Text>Project: {buildingInfo.calculation_name}</Text>
                    </>
                  )}
                </Space>
              </Col>
              <Col>
                <Space>
                  <Button onClick={() => setShowBuildingModal(true)}>
                    Edit Project Info
                  </Button>
                  <Popconfirm
                    title="Clear all items?"
                    onConfirm={handleClearAll}
                    disabled={allItems.length === 0}
                  >
                    <Button
                      icon={<ClearOutlined />}
                      disabled={allItems.length === 0}
                    >
                      Clear All
                    </Button>
                  </Popconfirm>
                  <Button
                    type="primary"
                    icon={<CalculatorOutlined />}
                    onClick={handleCalculate}
                    disabled={allItems.length === 0}
                    loading={loading}
                  >
                    Calculate Materials & Labor
                  </Button>
                </Space>
              </Col>
            </Row>
          </Card>

          {/* Statistics Bar */}
          {allItems.length > 0 && (
            <Card className="mb-4">
              <Row gutter={[16, 16]}>
                <Col span={6}>
                  <Statistic
                    title="Total Items"
                    value={statistics.totalItems}
                    prefix={<UnorderedListOutlined />}
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="Total Quantity"
                    value={statistics.totalQuantity}
                    prefix={<AppstoreOutlined />}
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="Categories"
                    value={Object.keys(statistics.byCategory).length}
                    prefix={<AppstoreOutlined />}
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="Est. Boxes"
                    value={statistics.estimatedBoxes}
                    prefix={<FileTextOutlined />}
                    suffix="boxes"
                  />
                </Col>
              </Row>

              {selectedMode === PackInputMode.IMAGE && ( // HYBRID mode
                <div className="mt-4">
                  <Text type="secondary">Items by Source:</Text>
                  <Space className="mt-2">
                    {Object.entries(statistics.bySource).map(([source, count]) => (
                      count > 0 && (
                        <Tag key={source} color={SOURCE_ICONS[source as keyof typeof SOURCE_ICONS].color}>
                          {SOURCE_ICONS[source as keyof typeof SOURCE_ICONS].emoji}
                          {' '}{SOURCE_ICONS[source as keyof typeof SOURCE_ICONS].label}: {count}
                        </Tag>
                      )
                    ))}
                  </Space>
                </div>
              )}
            </Card>
          )}

          {/* Mode-specific input interface */}
          {renderInputPhase()}
        </div>
      )}

      {/* Building Info Modal */}
      {renderBuildingModal()}
    </div>
  );
};

export default PackCalculatorMultiMode;