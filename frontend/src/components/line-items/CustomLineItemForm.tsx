/**
 * Custom Line Item Form Component
 * Form for creating custom line items
 */

import React, { useState } from 'react';
import {
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  AutoComplete,
  Switch,
  message,
  Row,
  Col,
  Space,
  Alert
} from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import lineItemService from '../../services/lineItemService';
import { LineItem, LineItemCategory, LineItemType, LineItemCreate } from '../../types/lineItem';

const { TextArea } = Input;
const { Option } = Select;

interface CustomLineItemFormProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (item: LineItem) => void;
  categories: LineItemCategory[];
  saveToLibrary?: boolean; // Option to save to line item library
}

// 자주 사용되는 단위들
const COMMON_UNITS = [
  { value: 'EA', label: 'EA (Each)' },
  { value: 'SF', label: 'SF (Square Foot)' },
  { value: 'LF', label: 'LF (Linear Foot)' },
  { value: 'SY', label: 'SY (Square Yard)' },
  { value: 'CF', label: 'CF (Cubic Foot)' },
  { value: 'CY', label: 'CY (Cubic Yard)' },
  { value: 'HR', label: 'HR (Hour)' },
  { value: 'DAY', label: 'DAY' },
  { value: 'WEEK', label: 'WEEK' },
  { value: 'MONTH', label: 'MONTH' },
  { value: 'TON', label: 'TON' },
  { value: 'GAL', label: 'GAL (Gallon)' },
  { value: 'QT', label: 'QT (Quart)' },
  { value: 'LB', label: 'LB (Pound)' },
  { value: 'OZ', label: 'OZ (Ounce)' },
  { value: 'BAG', label: 'BAG' },
  { value: 'BOX', label: 'BOX' },
  { value: 'ROLL', label: 'ROLL' },
  { value: 'SHEET', label: 'SHEET' },
  { value: 'PC', label: 'PC (Piece)' },
  { value: 'SET', label: 'SET' },
  { value: 'PAIR', label: 'PAIR' },
  { value: 'M', label: 'M (Meter)' },
  { value: 'M2', label: 'M² (Square Meter)' },
  { value: 'M3', label: 'M³ (Cubic Meter)' },
  { value: 'KG', label: 'KG (Kilogram)' },
  { value: 'L', label: 'L (Liter)' }
];

const CustomLineItemForm: React.FC<CustomLineItemFormProps> = ({
  open,
  onClose,
  onSuccess,
  categories,
  saveToLibrary = true
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saveToLib, setSaveToLib] = useState(saveToLibrary);
  const [unitSearchValue, setUnitSearchValue] = useState('');
  const [showCustomUnit, setShowCustomUnit] = useState(false);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const lineItemData: LineItemCreate = {
        cat: values.category,
        item: values.item_code || undefined,
        description: values.description,
        includes: values.includes || undefined,
        unit: values.unit || 'EA',
        untaxed_unit_price: values.untaxed_unit_price,
        is_active: true
      };

      let newItem: LineItem;

      if (saveToLib) {
        // Save to line item library
        newItem = await lineItemService.createLineItem(lineItemData);
        message.success('Custom item created and saved to library');
      } else {
        // Don't save to library - return item data without ID
        // Invoice/Estimate will save description directly without line_item_id reference
        newItem = {
          id: '', // No ID - signals to parent that this is not saved to library
          cat: lineItemData.cat,
          item: lineItemData.item,
          description: lineItemData.description,
          includes: lineItemData.includes,
          unit: lineItemData.unit,
          untaxed_unit_price: lineItemData.untaxed_unit_price,
          type: LineItemType.CUSTOM,
          is_active: true,
          version: 1,
          created_at: new Date().toISOString(),
          notes: []
        } as LineItem;
        message.success('Item created for this document only (not saved to library)');
      }

      onSuccess(newItem);
      form.resetFields();
      setShowCustomUnit(false);
      onClose();
    } catch (error: any) {
      message.error(error.message || 'Failed to create custom item');
    } finally {
      setLoading(false);
    }
  };

  // AutoComplete 옵션 필터링
  const handleUnitSearch = (searchText: string) => {
    setUnitSearchValue(searchText);
    
    // 입력값이 기존 옵션과 일치하지 않으면 커스텀 단위로 처리
    const isExistingUnit = COMMON_UNITS.some(unit => 
      unit.value.toLowerCase() === searchText.toLowerCase()
    );
    setShowCustomUnit(!isExistingUnit && searchText.length > 0);
  };

  // AutoComplete 옵션 생성
  const unitOptions = COMMON_UNITS
    .filter(unit => 
      unit.value.toLowerCase().includes(unitSearchValue.toLowerCase()) ||
      unit.label.toLowerCase().includes(unitSearchValue.toLowerCase())
    )
    .map(unit => ({
      value: unit.value,
      label: unit.label
    }));

  // 커스텀 단위 옵션 추가
  if (showCustomUnit && unitSearchValue) {
    unitOptions.unshift({
      value: unitSearchValue.toUpperCase(),
      label: `Custom: ${unitSearchValue.toUpperCase()}`
    });
  }

  return (
    <Modal
      title="Create Custom Line Item"
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      confirmLoading={loading}
      okText="Create"
      okButtonProps={{ icon: <SaveOutlined /> }}
      width={700}
    >
      <Alert
        message="Custom Item Creation"
        description="Create a custom line item that is not in the Xactimate database. You can save it to your library for future use."
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      <Form
        form={form}
        layout="vertical"
        initialValues={{
          unit: 'EA',
          saveToLibrary: saveToLib
        }}
      >
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="description"
              label="Item Description"
              rules={[
                { required: true, message: 'Please enter item description' },
                { max: 500, message: 'Description is too long' }
              ]}
            >
              <Input
                placeholder="e.g., Premium Interior Paint - Two Coats"
                maxLength={500}
              />
            </Form.Item>
          </Col>
          
          <Col span={12}>
            <Form.Item
              name="item_code"
              label="Item Code (Optional)"
              rules={[
                { max: 50, message: 'Item code is too long' }
              ]}
            >
              <Input
                placeholder="e.g., PAINT-001"
                maxLength={50}
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="category"
              label="Category"
              rules={[
                { required: true, message: 'Please select a category' }
              ]}
            >
              <Select
                placeholder="Select category"
                showSearch
                filterOption={(input, option) =>
                  option?.children ? String(option.children).toLowerCase().includes(input.toLowerCase()) : false
                }
              >
                {categories.map(cat => (
                  <Option key={cat.code} value={cat.code}>
                    {cat.name}
                  </Option>
                ))}
              </Select>
            </Form.Item>
          </Col>

          <Col span={6}>
            <Form.Item
              name="unit"
              label="Unit"
              rules={[
                { required: true, message: 'Please enter unit' },
                { max: 20, message: 'Unit is too long (max 20 characters)' }
              ]}
              tooltip="Select from common units or type your own"
            >
              <AutoComplete
                options={unitOptions}
                onSearch={handleUnitSearch}
                onChange={(value) => form.setFieldValue('unit', value.toUpperCase())}
                placeholder="Select or type unit"
                allowClear
              />
            </Form.Item>
          </Col>

          <Col span={6}>
            <Form.Item
              name="untaxed_unit_price"
              label="Unit Price ($)"
              rules={[
                { required: true, message: 'Please enter unit price' },
                { type: 'number', min: 0, message: 'Price must be positive' }
              ]}
            >
              <InputNumber
                min={0}
                precision={2}
                style={{ width: '100%' }}
                placeholder="0.00"
                formatter={value => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                parser={value => {
                  const num = parseFloat(value!.replace(/\$\s?|(,*)/g, ''));
                  return isNaN(num) ? 0 as any : num as any;
                }}
              />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          name="includes"
          label="Includes / Work Description (Optional)"
          rules={[
            { max: 1000, message: 'Description is too long' }
          ]}
        >
          <TextArea
            rows={3}
            placeholder="e.g., Includes surface preparation, primer, two coats of premium paint, and cleanup"
            maxLength={1000}
            showCount
          />
        </Form.Item>

        <Form.Item
          name="saveToLibrary"
          valuePropName="checked"
        >
          <Space>
            <Switch
              checked={saveToLib}
              onChange={setSaveToLib}
            />
            <span>Save to line item library for future use</span>
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default CustomLineItemForm;