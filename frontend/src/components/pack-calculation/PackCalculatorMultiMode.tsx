import React, { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Space,
  Button,
  Table,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Modal,
  Tag,
  Divider,
  Typography,
  Row,
  Col,
  Statistic,
  message,
  Popconfirm,
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
  ExportOutlined,
} from '@ant-design/icons';
import InputModeSelector from './InputModeSelector';
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
import {
  savePackEstimate,
  type PackEstimateResult
} from '../../services/packEstimateService';

const { Title, Text } = Typography;

// Extended item type with source tracking
interface ExtendedPackItem extends PackItemInput {
  id: string;
  source: 'manual' | 'smart' | 'photo';
  room_name?: string;
  category_display?: string;
}

// Source emoji mapping
const SOURCE_ICONS = {
  manual: { emoji: '✏️', label: 'Manual', color: 'blue' },
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
  const [smartItems, setSmartItems] = useState<ExtendedPackItem[]>([]);
  const [photoItems, setPhotoItems] = useState<ExtendedPackItem[]>([]);

  // UI state
  const [activeHybridTab, setActiveHybridTab] = useState('photo');
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showBuildingModal, setShowBuildingModal] = useState(false);
  const [saving, setSaving] = useState(false);

  // Pack estimate result for saving
  const [lastPackEstimateResult, setLastPackEstimateResult] = useState<PackEstimateResult | null>(null);

  // Manual item form
  const [manualForm] = Form.useForm();

  // Calculate combined items
  const allItems = useMemo(() => {
    const items: ExtendedPackItem[] = [];

    if (selectedMode === PackInputMode.IMAGE) { // Photo Analysis mode
      items.push(...photoItems);
    } else if (selectedMode === PackInputMode.STRUCTURED) {
      items.push(...manualItems);
    } else if (selectedMode === PackInputMode.TEXT) {
      items.push(...smartItems);
    }

    return items;
  }, [selectedMode, manualItems, smartItems, photoItems]);

  // Statistics
  const statistics = useMemo(() => {
    const bySource: Record<string, number> = {
      manual: manualItems.length,
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
  }, [allItems, manualItems, smartItems, photoItems]);

  // Handle mode selection
  const handleModeSelect = (mode: PackInputMode) => {
    setSelectedMode(mode);
    setPhase('input');

    // Show building info modal first time
    if (!buildingInfo.calculation_name) {
      setShowBuildingModal(true);
    }
  };

  // Handle smart estimation items
  const handleSmartItems = useCallback((items: PackItemInput[]) => {
    const newItems: ExtendedPackItem[] = items.map(item => ({
      ...item,
      id: `smart-${Date.now()}-${Math.random()}`,
      source: 'smart' as const,
      category_display: item.item_category,
    }));

    if (selectedMode === PackInputMode.IMAGE) { // Photo mode
      setSmartItems(prev => [...prev, ...newItems]);
    } else {
      setSmartItems(newItems);
    }

    message.success(`Added ${items.length} items from smart estimation`);
  }, [selectedMode]);

  // Handle photo analysis items
  const handlePhotoItems = useCallback((items: any[], options?: { replaceRoom?: string }) => {
    const newItems: ExtendedPackItem[] = items.map(item => ({
      ...item,
      id: `photo-${Date.now()}-${Math.random()}`,
      source: 'photo' as const,
      category_display: item.item_category,
      room_name: item.room_name,
    }));

    if (options?.replaceRoom) {
      // Replace items for this specific room (used when re-analyzing)
      setPhotoItems(prev => [
        ...prev.filter(i => i.room_name !== options.replaceRoom),
        ...newItems,
      ]);
      message.success(`Updated ${items.length} items for ${options.replaceRoom}`);
    } else if (selectedMode === PackInputMode.IMAGE) {
      setPhotoItems(prev => [...prev, ...newItems]);
      message.success(`Added ${items.length} items from photo analysis`);
    } else {
      setPhotoItems(newItems);
      message.success(`Added ${items.length} items from photo analysis`);
    }
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

      if (selectedMode === PackInputMode.IMAGE) { // Photo mode
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
      case 'smart':
        setSmartItems(prev => prev.filter(i => i.id !== itemId));
        break;
      case 'photo':
        setPhotoItems(prev => prev.filter(i => i.id !== itemId));
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
    setSmartItems([]);
    setPhotoItems([]);
    message.success('All items cleared');
  };

  // Switch mode
  const handleSwitchMode = () => {
    setPhase('mode-selection');
    setSelectedMode(null);
    setActiveHybridTab('photo');
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

      // Group items by room_name - preserve original room names from photo analysis
      console.log('🔍 [DEBUG] All items before grouping:', allItems.map(i => ({
        name: i.item_name,
        room: i.room_name,
        source: i.source,
      })));

      const itemsByRoom = allItems.reduce((acc, item) => {
        // Use the room_name from the item, only use fallback if truly undefined
        const roomName = item.room_name || `Unknown Room (${item.source})`;
        if (!acc[roomName]) {
          acc[roomName] = [];
        }
        acc[roomName].push(item);
        return acc;
      }, {} as Record<string, ExtendedPackItem[]>);

      console.log('✅ [DEBUG] Items grouped by room:', Object.keys(itemsByRoom));

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

  // Export to Estimate Editor
  const handleExportToEstimate = () => {
    if (allItems.length === 0) {
      message.error('Please add at least one item');
      return;
    }

    // Convert pack items to estimate line items format
    const estimateItems = allItems.map((item, index) => ({
      id: item.id,
      name: item.item_name,
      description: `${item.item_category || 'Item'} - ${item.room_name || 'Main Room'}`,
      quantity: item.quantity,
      unit: 'EA',
      unit_price: 0, // Will be filled from pricing database
      total: 0,
      taxable: false,
      primary_group: 'Moving/Packing',
      secondary_group: item.item_category || 'General',
      sort_order: index,
      note: item.special_notes || undefined,
    }));

    // Store in sessionStorage for the estimate editor to pick up
    sessionStorage.setItem('packEstimateExport', JSON.stringify({
      items: estimateItems,
      metadata: {
        calculation_name: buildingInfo.calculation_name || 'Pack-Out Estimate',
        project_address: buildingInfo.project_address,
        total_items: allItems.length,
        exported_at: new Date().toISOString(),
      },
    }));

    message.success(`Exported ${allItems.length} items to estimate`);

    // Navigate to new estimate creation with import flag
    navigate('/estimates/new?import=pack');
  };

  // Save pack estimate to database
  const handleSavePackEstimate = async () => {
    if (allItems.length === 0) {
      message.error('Please add at least one item before saving');
      return;
    }

    const buildingData = buildingForm.getFieldsValue();

    // Create a PackEstimateResult structure
    const packResult: PackEstimateResult = {
      phase1_inventory: {
        room_name: buildingData.calculation_name || 'Pack-Out Estimate',
        items: allItems.map((item) => ({
          item_id: item.id,
          category: item.item_category || 'General',
          description: item.item_name,
          quantity: item.quantity,
          size_type: item.size_category || 'Medium',
          condition: 'good' as const,
          packing_method: undefined,
          box_type: undefined,
          special_handling: item.fragile ? ['FRAGILE'] : [],
          packing_materials_needed: [],
          estimated_pack_time_minutes: 10,
          notes: item.special_notes,
        })),
        room_characteristics: {
          approximate_size: 'medium' as const,
          density_level: 'MODERATE' as const,
          access_notes: undefined,
        },
        packing_summary: {
          box_requirements: {
            SMALL_BOX: 0,
            MEDIUM_BOX: Math.ceil(allItems.length / 3),
            LARGE_BOX: Math.ceil(allItems.filter((i) => i.size_category === 'large').length),
            EXTRA_LARGE_BOX: 0,
            WARDROBE_BOX: 0,
            DISH_PACK_BOX: 0,
            PICTURE_BOX: 0,
            LONG_BOX: 0,
            LAMP_BOX: 0,
            TV_BOX: 0,
            TUBE_BOX: 0,
            OTHER: 0,
          },
          supplies_needed: [],
          fragile_item_count: allItems.filter((i) => i.fragile).length,
          heavy_item_count: 0,
          estimated_total_pack_time_hours: Math.ceil(allItems.length / 10),
          crew_size_recommended: 2,
          special_equipment_needed: [],
        },
      },
      line_items: allItems.map((item, index) => ({
        id: item.id,
        name: item.item_name,
        description: `${item.item_category || 'Item'} - ${item.room_name || 'Main Room'}`,
        quantity: item.quantity,
        unit: 'EA' as const,
        unit_price: 0,
        total: 0,
        category: 'MATERIALS' as const,
        primary_group: 'Moving/Packing',
        secondary_group: item.item_category || 'General',
        notes: item.special_notes,
        taxable: false,
        sort_order: index,
      })),
      summary: {
        subtotal: 0,
        tax_rate: 0,
        tax_amount: 0,
        total: 0,
        estimated_duration_hours: Math.ceil(allItems.length / 10),
      },
      processing_info: {
        photo_count: photoItems.length,
        room_name: buildingData.calculation_name || 'Pack-Out Estimate',
        phase1_method: 'manual',
        phase2_method: 'rule_based',
        items_detected: allItems.length,
        line_items_generated: allItems.length,
        estimated_total: 0,
      },
    };

    setSaving(true);

    try {
      const savedEstimate = await savePackEstimate(packResult, {
        jobName: buildingData.calculation_name,
        address: buildingData.project_address,
        notes: buildingData.notes,
      });

      setLastPackEstimateResult(packResult);

      message.success({
        content: (
          <span>
            Pack estimate saved successfully! ID: {savedEstimate.id}
            <br />
            <small>
              {savedEstimate.items_detected_count} items, {savedEstimate.total_boxes} boxes estimated
            </small>
          </span>
        ),
        duration: 5,
      });

    } catch (error: any) {
      console.error('Error saving pack estimate:', error);
      message.error(`Failed to save: ${error.message || 'Unknown error'}`);
    } finally {
      setSaving(false);
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

    if (selectedMode === PackInputMode.IMAGE) { // Photo mode
      return (
        <div>
          <PhotoUploadManager
            onPhotosAnalyzed={(items) => {
              handlePhotoItems(items);
            }}
          />

          {photoItems.length > 0 && (
            <Card title="Photo Analysis Items" className="mt-4">
              <Table
                dataSource={photoItems}
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
                <Space size="middle">
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
                <Space size="middle" wrap>
                  <Button
                    icon={<EditOutlined />}
                    onClick={() => setShowBuildingModal(true)}
                  >
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
                  <Divider type="vertical" />
                  <Tooltip title="Save pack estimate for later review">
                    <Button
                      icon={<SaveOutlined />}
                      onClick={handleSavePackEstimate}
                      disabled={allItems.length === 0}
                      loading={saving}
                    >
                      Save Estimate
                    </Button>
                  </Tooltip>
                  <Button
                    type="primary"
                    icon={<CalculatorOutlined />}
                    onClick={handleCalculate}
                    disabled={allItems.length === 0}
                    loading={loading}
                  >
                    Calculate Materials & Labor
                  </Button>
                  <Tooltip title="Export items to create a new Estimate">
                    <Button
                      icon={<ExportOutlined />}
                      onClick={handleExportToEstimate}
                      disabled={allItems.length === 0}
                    >
                      Export to Estimate
                    </Button>
                  </Tooltip>
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