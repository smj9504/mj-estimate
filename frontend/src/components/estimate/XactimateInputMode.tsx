/**
 * Xactimate Input Mode Component
 * Allows searching and selecting Xactimate line items for estimates
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Card,
  Input,
  Select,
  Table,
  Button,
  Space,
  Modal,
  Row,
  Col,
  Typography,
  InputNumber,
  Descriptions,
  Tag,
  Badge,
  Tabs,
  Alert,
  Spin,
  Empty,
} from 'antd';
import {
  SearchOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  EyeOutlined,
  ReloadOutlined,
} from '@ant-design/icons';

import { XactimateItem, XactimateCategory } from '../../types/xactimate';
import xactimateService from '../../services/xactimateService';
import { 
  convertXactimateToLineItem, 
  formatXactimateForTable,
  getXactimateCostBreakdown,
  XactimateLineItemData 
} from '../../utils/xactimateTransform';

const { Text, Title } = Typography;
const { Option } = Select;

interface XactimateInputModeProps {
  onAddItems: (items: XactimateLineItemData[]) => void;
  onCancel: () => void;
}

interface XactimateTableRow {
  key: string;
  item_code: string;
  category: string;
  description: string;
  unit_price: string;
  labor: string;
  material: string;
  equipment: string;
  price_date: string;
  rawItem: XactimateItem;
}

const XactimateInputMode: React.FC<XactimateInputModeProps> = ({
  onAddItems,
  onCancel,
}) => {
  // State
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [categories, setCategories] = useState<XactimateCategory[]>([]);
  const [items, setItems] = useState<XactimateItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<XactimateItem[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedDetailItem, setSelectedDetailItem] = useState<XactimateItem | null>(null);
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 50,
    total: 0,
  });

  // Load categories on mount
  useEffect(() => {
    loadCategories();
  }, []);

  // Load items when search parameters change
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchTerm || selectedCategory) {
        searchItems();
      } else {
        setItems([]);
        setPagination(prev => ({ ...prev, total: 0 }));
      }
    }, 300); // Debounce search

    return () => clearTimeout(timer);
  }, [searchTerm, selectedCategory, pagination.current, pagination.pageSize]);

  const loadCategories = async () => {
    try {
      setLoading(true);
      const response = await xactimateService.getCategories();
      setCategories(response);
    } catch (error) {
      console.error('Failed to load categories:', error);
    } finally {
      setLoading(false);
    }
  };

  const searchItems = async () => {
    try {
      setLoading(true);
      const response = await xactimateService.searchItems({
        search_term: searchTerm || undefined,
        category_code: selectedCategory || undefined,
        page: pagination.current,
        page_size: pagination.pageSize,
        include_components: true, // Include components for detailed view
      });

      setItems(response.items);
      setPagination(prev => ({
        ...prev,
        total: response.total_count,
      }));
    } catch (error) {
      console.error('Failed to search items:', error);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  // Table configuration
  const tableData = useMemo(() => {
    return items.map(formatXactimateForTable);
  }, [items]);

  const columns = [
    {
      title: 'Code',
      dataIndex: 'item_code',
      key: 'item_code',
      width: 120,
      sorter: (a: XactimateTableRow, b: XactimateTableRow) => 
        a.item_code.localeCompare(b.item_code),
    },
    {
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
      width: 100,
      render: (category: string) => <Tag>{category}</Tag>,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
    },
    {
      title: 'Unit Price',
      dataIndex: 'unit_price',
      key: 'unit_price',
      width: 100,
      align: 'right' as const,
    },
    {
      title: 'Lab',
      dataIndex: 'labor',
      key: 'labor',
      width: 70,
      align: 'right' as const,
    },
    {
      title: 'Mat',
      dataIndex: 'material',
      key: 'material',
      width: 70,
      align: 'right' as const,
    },
    {
      title: 'Eq',
      dataIndex: 'equipment',
      key: 'equipment',
      width: 70,
      align: 'right' as const,
    },
    {
      title: 'Action',
      key: 'action',
      width: 80,
      render: (_: any, record: XactimateTableRow) => (
        <Button
          icon={<EyeOutlined />}
          size="small"
          onClick={() => showItemDetail(record.rawItem)}
          type="link"
        />
      ),
    },
  ];

  const rowSelection = {
    selectedRowKeys,
    onChange: (newSelectedRowKeys: React.Key[], newSelectedRows: XactimateTableRow[]) => {
      setSelectedRowKeys(newSelectedRowKeys);
      setSelectedItems(newSelectedRows.map(row => row.rawItem));
    },
    getCheckboxProps: (record: XactimateTableRow) => ({
      name: record.item_code,
    }),
  };

  const showItemDetail = (item: XactimateItem) => {
    setSelectedDetailItem(item);
    setDetailModalVisible(true);
  };

  const handleAddSelected = () => {
    if (selectedItems.length === 0) return;

    console.log('XactimateInputMode: Selected items:', selectedItems);

    // Convert selected Xactimate items to EstimateLineItem format
    const lineItems = selectedItems.map(item => {
      const lineItem = convertXactimateToLineItem(item, 1, 'EA');
      console.log('XactimateInputMode: Converted item:', {
        itemCode: item.item_code,
        category: item.category,
        categoryCode: item.category_code,
        resultingGroup: lineItem.primary_group,
        fullLineItem: lineItem
      });
      return lineItem;
    });

    console.log('XactimateInputMode: Calling onAddItems with:', lineItems);
    onAddItems(lineItems);

    // Clear selection
    setSelectedItems([]);
    setSelectedRowKeys([]);
  };

  const clearSearch = () => {
    setSearchTerm('');
    setSelectedCategory('');
    setItems([]);
    setSelectedItems([]);
    setSelectedRowKeys([]);
    setPagination(prev => ({ ...prev, total: 0, current: 1 }));
  };

  const handleTableChange = (newPagination: any) => {
    setPagination({
      ...pagination,
      current: newPagination.current,
      pageSize: newPagination.pageSize,
    });
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Search Controls */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}>
            <Select
              placeholder="Select category"
              style={{ width: '100%' }}
              value={selectedCategory}
              onChange={setSelectedCategory}
              allowClear
              showSearch
              optionFilterProp="children"
            >
              {categories.map(category => (
                <Option key={category.category_code} value={category.category_code}>
                  {category.category_code} - {category.category_name}
                </Option>
              ))}
            </Select>
          </Col>
          <Col xs={24} md={12}>
            <Input
              placeholder="Search Xactimate items..."
              prefix={<SearchOutlined />}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              allowClear
            />
          </Col>
          <Col xs={24} md={4}>
            <Space>
              <Button 
                icon={<ReloadOutlined />}
                onClick={searchItems}
                loading={loading}
              />
              <Button onClick={clearSearch}>Clear</Button>
            </Space>
          </Col>
        </Row>
        
        {selectedItems.length > 0 && (
          <Row style={{ marginTop: 16 }}>
            <Col span={24}>
              <Alert
                message={`${selectedItems.length} items selected`}
                type="info"
                action={
                  <Button
                    size="small"
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={handleAddSelected}
                  >
                    Add Selected Items
                  </Button>
                }
              />
            </Col>
          </Row>
        )}
      </Card>

      {/* Results Table */}
      <Card 
        title={
          <Space>
            <span>Xactimate Items</span>
            <Badge count={pagination.total} overflowCount={9999} />
          </Space>
        }
        size="small"
        style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
        styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column' } }}
      >
        <Table
          columns={columns}
          dataSource={tableData}
          rowSelection={rowSelection}
          loading={loading}
          pagination={{
            ...pagination,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) => 
              `${range[0]}-${range[1]} of ${total} items`,
          }}
          onChange={handleTableChange}
          scroll={{ y: 400 }}
          size="small"
          locale={{
            emptyText: searchTerm || selectedCategory ? 
              <Empty description="No items found" /> : 
              <Empty description="Enter search terms to find Xactimate items" />
          }}
        />
      </Card>

      {/* Action Buttons */}
      <div style={{ marginTop: 16, textAlign: 'right' }}>
        <Space>
          <Button onClick={onCancel}>Cancel</Button>
          <Button 
            type="primary" 
            onClick={handleAddSelected}
            disabled={selectedItems.length === 0}
            icon={<PlusOutlined />}
          >
            Add {selectedItems.length > 0 ? `${selectedItems.length} ` : ''}Items
          </Button>
        </Space>
      </div>

      {/* Detail Modal */}
      <ItemDetailModal
        visible={detailModalVisible}
        item={selectedDetailItem}
        onClose={() => setDetailModalVisible(false)}
      />
    </div>
  );
};

// Item Detail Modal Component
interface ItemDetailModalProps {
  visible: boolean;
  item: XactimateItem | null;
  onClose: () => void;
}

const ItemDetailModal: React.FC<ItemDetailModalProps> = ({
  visible,
  item,
  onClose,
}) => {
  if (!item) return null;

  // Safe number conversion helper
  const safeToFixed = (value: any, decimals: number = 2): string => {
    const num = Number(value);
    return isNaN(num) ? '0.00' : num.toFixed(decimals);
  };

  const costBreakdown = {
    labor: item.labor_cost || 0,
    material: item.material_cost || 0,
    equipment: item.equipment_cost || 0,
    labor_burden: item.labor_burden || 0,
    market_conditions: item.market_conditions || 0,
  };

  return (
    <Modal
      title={`Xactimate Item: ${item.item_code}`}
      visible={visible}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose}>
          Close
        </Button>,
      ]}
      width={800}
    >
      <Tabs 
        defaultActiveKey="basic"
        items={[
          {
            key: 'basic',
            label: 'Basic Info',
            children: (
              <Descriptions column={2} bordered>
                <Descriptions.Item label="Item Code">{item.item_code}</Descriptions.Item>
                <Descriptions.Item label="Category">{item.category_code}</Descriptions.Item>
                <Descriptions.Item label="Description" span={2}>
                  {item.description}
                </Descriptions.Item>
                <Descriptions.Item label="Unit Price">
                  ${safeToFixed(item.untaxed_unit_price)}
                </Descriptions.Item>
                <Descriptions.Item label="Price Date">
                  {item.price_month}/{item.price_year}
                </Descriptions.Item>
              </Descriptions>
            )
          },
          {
            key: 'costs',
            label: 'Cost Breakdown',
            children: (
              <Row gutter={[16, 16]}>
                <Col span={12}>
                  <Descriptions column={1} bordered>
                    <Descriptions.Item label="Labor">
                      ${safeToFixed(costBreakdown.labor)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Material">
                      ${safeToFixed(costBreakdown.material)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Equipment">
                      ${safeToFixed(costBreakdown.equipment)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Labor Burden">
                      ${safeToFixed(costBreakdown.labor_burden)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Market Conditions">
                      ${safeToFixed(costBreakdown.market_conditions)}
                    </Descriptions.Item>
                  </Descriptions>
                </Col>
                <Col span={12}>
                  {item.components && item.components.length > 0 && (
                    <>
                      <Title level={5}>Components</Title>
                      <Table
                        dataSource={item.components.map((comp, idx) => ({
                          key: idx,
                          type: comp.component_type,
                          code: comp.component_code,
                          cost: comp.cost,
                          unit_price: comp.unit_price,
                        }))}
                        columns={[
                          { title: 'Type', dataIndex: 'type', key: 'type' },
                          { title: 'Code', dataIndex: 'code', key: 'code' },
                          { title: 'Cost', dataIndex: 'cost', key: 'cost', render: (val: number) => `$${safeToFixed(val, 3)}` },
                          { title: 'Unit Price', dataIndex: 'unit_price', key: 'unit_price', render: (val: number) => `$${safeToFixed(val)}` },
                        ]}
                        size="small"
                        pagination={false}
                      />
                    </>
                  )}
                </Col>
              </Row>
            )
          },
          {
            key: 'details',
            label: 'Details',
            children: (
              <Descriptions column={1} bordered>
                {item.includes_description && (
                  <Descriptions.Item label="Includes">
                    {item.includes_description}
                  </Descriptions.Item>
                )}
                {item.excludes_description && (
                  <Descriptions.Item label="Excludes">
                    {item.excludes_description}
                  </Descriptions.Item>
                )}
                {item.note_description && (
                  <Descriptions.Item label="Notes">
                    {item.note_description}
                  </Descriptions.Item>
                )}
                {item.quality_description && (
                  <Descriptions.Item label="Quality">
                    {item.quality_description}
                  </Descriptions.Item>
                )}
                {item.reference_description && (
                  <Descriptions.Item label="Reference">
                    {item.reference_description}
                  </Descriptions.Item>
                )}
              </Descriptions>
            )
          }
        ]}
      />
    </Modal>
  );
};

export default XactimateInputMode;