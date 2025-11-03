/**
 * Debris Calculator Page
 * Simple interface for calculating construction debris weight
 */

import React, { useState, useEffect } from 'react';
import {
  Card,
  Row,
  Col,
  Form,
  Select,
  InputNumber,
  Radio,
  Button,
  Table,
  Statistic,
  Space,
  message,
  Spin,
  Empty,
  Typography,
  Divider,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  CalculatorOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import {
  MaterialWeight,
  MaterialCategory,
  MoistureLevel,
  DebrisItemInput,
  DebrisCalculationResult,
  CategoryBreakdown,
} from '../types/reconstructionEstimate';
import { materialWeightAPI, materialCategoryAPI, debrisCalculationAPI } from '../services/reconstructionEstimateService';
import Calculator from '../components/common/Calculator';

const { Title, Text } = Typography;
const { Option, OptGroup } = Select;

interface DebrisItemForm extends DebrisItemInput {
  key: string;
}

const DebrisCalculator: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [materials, setMaterials] = useState<MaterialWeight[]>([]);
  const [categories, setCategories] = useState<MaterialCategory[]>([]);
  const [items, setItems] = useState<DebrisItemForm[]>([]);
  const [result, setResult] = useState<DebrisCalculationResult | null>(null);

  // Load materials and categories on mount
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [materialsData, categoriesData] = await Promise.all([
        materialWeightAPI.getAll({ active_only: true }),
        materialCategoryAPI.getAll(),
      ]);
      setMaterials(materialsData.materials);
      setCategories(categoriesData);
    } catch (error) {
      message.error('Failed to load materials');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // Add new item
  const handleAddItem = () => {
    const newItem: DebrisItemForm = {
      key: Date.now().toString(),
      material_id: '',
      quantity: 0,
      moisture_level: MoistureLevel.DRY,
    };
    setItems([...items, newItem]);
  };

  // Remove item
  const handleRemoveItem = (key: string) => {
    setItems(items.filter(item => item.key !== key));
    // Recalculate if there are remaining items
    if (items.length > 1) {
      setTimeout(() => handleCalculate(), 100);
    } else {
      setResult(null);
    }
  };

  // Update item
  const handleItemChange = (key: string, field: keyof DebrisItemInput, value: any) => {
    const updatedItems = items.map(item =>
      item.key === key ? { ...item, [field]: value } : item
    );
    setItems(updatedItems);
  };

  // Calculate debris
  const handleCalculate = async () => {
    // Validate items
    const validItems = items.filter(
      item => item.material_id && item.quantity > 0
    );

    if (validItems.length === 0) {
      message.warning('Please add at least one item with material and quantity');
      return;
    }

    try {
      setLoading(true);
      const result = await debrisCalculationAPI.calculateQuick({
        items: validItems,
      });
      setResult(result);
      message.success('Calculation completed!');
    } catch (error) {
      message.error('Failed to calculate debris');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // Group materials by category for Select
  const getMaterialOptions = () => {
    const grouped: Record<string, MaterialWeight[]> = {};

    materials.forEach(material => {
      const categoryName = material.category_name || 'Other';
      if (!grouped[categoryName]) {
        grouped[categoryName] = [];
      }
      grouped[categoryName].push(material);
    });

    return Object.entries(grouped).map(([categoryName, materials]) => (
      <OptGroup key={categoryName} label={categoryName}>
        {materials.map(material => (
          <Option key={material.id} value={material.id}>
            {material.material_type.replace(/_/g, ' ')} ({material.unit})
          </Option>
        ))}
      </OptGroup>
    ));
  };

  // Get material info
  const getMaterialInfo = (materialId: string) => {
    return materials.find(m => m.id === materialId);
  };

  if (loading && materials.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '50px' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div>
      <Title level={2}>
        <CalculatorOutlined /> Debris Calculator
      </Title>
      <Text type="secondary">
        Calculate construction debris weight with moisture adjustments
      </Text>

      <Divider />

      <Row gutter={[24, 24]}>
        {/* Input Section */}
        <Col xs={24} lg={14}>
          <Card
            title="Debris Items"
            extra={
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={handleAddItem}
              >
                Add Item
              </Button>
            }
          >
            {items.length === 0 ? (
              <Empty
                description="No items added yet"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              >
                <Button type="primary" icon={<PlusOutlined />} onClick={handleAddItem}>
                  Add First Item
                </Button>
              </Empty>
            ) : (
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                {items.map((item, index) => {
                  const material = getMaterialInfo(item.material_id);
                  return (
                    <Card key={item.key} size="small" style={{ backgroundColor: '#fafafa' }}>
                      <Row gutter={16} align="middle">
                        <Col xs={24} sm={8}>
                          <Form.Item label="Material" style={{ marginBottom: 0 }}>
                            <Select
                              placeholder="Select material"
                              value={item.material_id || undefined}
                              onChange={(value) => handleItemChange(item.key, 'material_id', value)}
                              showSearch
                              optionFilterProp="children"
                              filterOption={(input, option) => {
                                if (!option || !option.children) return false;
                                const label = String(option.children);
                                return label.toLowerCase().includes(input.toLowerCase());
                              }}
                            >
                              {getMaterialOptions()}
                            </Select>
                          </Form.Item>
                        </Col>
                        <Col xs={12} sm={6}>
                          <Form.Item label="Quantity" style={{ marginBottom: 0 }}>
                            <Calculator
                              initialValue={item.quantity}
                              onChange={(value) => handleItemChange(item.key, 'quantity', value)}
                              placeholder="Enter number or formula"
                              decimalPlaces={2}
                              unit={material?.unit || ''}
                              min={0}
                              size="middle"
                              showIcon={false}
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={12} sm={8}>
                          <Form.Item label="Moisture" style={{ marginBottom: 0 }}>
                            <Radio.Group
                              value={item.moisture_level}
                              onChange={(e) => handleItemChange(item.key, 'moisture_level', e.target.value)}
                              size="small"
                            >
                              <Radio.Button value={MoistureLevel.DRY}>Dry</Radio.Button>
                              <Radio.Button value={MoistureLevel.DAMP}>Damp</Radio.Button>
                              <Radio.Button value={MoistureLevel.WET}>Wet</Radio.Button>
                              <Radio.Button value={MoistureLevel.SATURATED}>Sat</Radio.Button>
                            </Radio.Group>
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={2} style={{ textAlign: 'right' }}>
                          <Button
                            type="text"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => handleRemoveItem(item.key)}
                          />
                        </Col>
                      </Row>
                    </Card>
                  );
                })}
              </Space>
            )}

            {items.length > 0 && (
              <div style={{ marginTop: 16, textAlign: 'center' }}>
                <Button
                  type="primary"
                  size="large"
                  icon={<CalculatorOutlined />}
                  onClick={handleCalculate}
                  loading={loading}
                >
                  Calculate
                </Button>
              </div>
            )}
          </Card>
        </Col>

        {/* Results Section */}
        <Col xs={24} lg={10}>
          {result ? (
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              {/* Total Weight */}
              <Card>
                <Row gutter={16}>
                  <Col span={12}>
                    <Statistic
                      title="Total Weight"
                      value={Number(result.total_weight_lb).toFixed(2)}
                      suffix="lbs"
                      precision={2}
                    />
                  </Col>
                  <Col span={12}>
                    <Statistic
                      title="Total Weight"
                      value={Number(result.total_weight_ton).toFixed(4)}
                      suffix="tons"
                      precision={4}
                    />
                  </Col>
                </Row>
              </Card>

              {/* Dumpster Recommendation */}
              <Card title="Dumpster Recommendation">
                <Space direction="vertical" style={{ width: '100%' }}>
                  <div>
                    <Text strong>Size: </Text>
                    <Text>{result.dumpster_recommendation.size}</Text>
                  </div>
                  <div>
                    <Text strong>Capacity: </Text>
                    <Text>{Number(result.dumpster_recommendation.capacity_ton).toFixed(2)} tons</Text>
                  </div>
                  {result.dumpster_recommendation.multiple_loads && (
                    <div>
                      <Text type="warning" strong>
                        Multiple loads required: {result.dumpster_recommendation.load_count} loads
                      </Text>
                    </div>
                  )}
                </Space>
              </Card>

              {/* Category Breakdown */}
              <Card title="Category Breakdown">
                <Table
                  dataSource={result.category_breakdown}
                  pagination={false}
                  size="small"
                  rowKey="category_name"
                  columns={[
                    {
                      title: 'Category',
                      dataIndex: 'category_name',
                      key: 'category_name',
                    },
                    {
                      title: 'Weight (tons)',
                      dataIndex: 'weight_ton',
                      key: 'weight_ton',
                      render: (val: number) => Number(val).toFixed(4),
                      align: 'right',
                    },
                    {
                      title: '%',
                      dataIndex: 'percentage',
                      key: 'percentage',
                      render: (val: number) => `${Number(val).toFixed(1)}%`,
                      align: 'right',
                    },
                  ]}
                />
              </Card>
            </Space>
          ) : (
            <Card>
              <Empty
                description="No calculation results yet"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              >
                <Text type="secondary">Add items and click Calculate to see results</Text>
              </Empty>
            </Card>
          )}
        </Col>
      </Row>
    </div>
  );
};

export default DebrisCalculator;
