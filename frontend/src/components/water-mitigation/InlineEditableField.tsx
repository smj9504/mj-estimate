/**
 * Inline Editable Field Component
 * Allows editing values directly in Descriptions without modal
 */

import React, { useState, useEffect } from 'react';
import { Input, DatePicker, InputNumber, Button, Space } from 'antd';
import { EditOutlined, SaveOutlined, CloseOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';

const { TextArea } = Input;

export type FieldType = 'text' | 'textarea' | 'date' | 'number' | 'email' | 'phone';

interface InlineEditableFieldProps {
  value: any;
  type?: FieldType;
  onSave: (value: any) => Promise<void>;
  placeholder?: string;
  prefix?: string;
  suffix?: string;
  maxLength?: number;
  rows?: number;
  precision?: number;
}

const InlineEditableField: React.FC<InlineEditableFieldProps> = ({
  value,
  type = 'text',
  onSave,
  placeholder = '',
  prefix = '',
  suffix = '',
  maxLength,
  rows = 3,
  precision = 2
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState<any>(value);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  const handleEdit = () => {
    setIsEditing(true);
    setEditValue(value);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue(value);
  };

  const handleSave = async () => {
    try {
      setLoading(true);
      await onSave(editValue);
      setIsEditing(false);
    } catch (error) {
      console.error('Save error:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDisplayValue = (val: any): string => {
    if (val === null || val === undefined || val === '') {
      return '-';
    }

    switch (type) {
      case 'date':
        return dayjs(val).format('YYYY-MM-DD');
      case 'number':
        return prefix + Number(val).toLocaleString(undefined, {
          minimumFractionDigits: precision,
          maximumFractionDigits: precision
        }) + suffix;
      default:
        return String(val);
    }
  };

  const renderEditInput = () => {
    switch (type) {
      case 'textarea':
        return (
          <TextArea
            value={editValue || ''}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder={placeholder}
            maxLength={maxLength}
            rows={rows}
            autoSize={{ minRows: rows, maxRows: 10 }}
          />
        );

      case 'date':
        return (
          <DatePicker
            value={editValue ? dayjs(editValue) : null}
            onChange={(date: Dayjs | null) => setEditValue(date ? date.toISOString() : null)}
            format="YYYY-MM-DD"
            style={{ width: '100%' }}
          />
        );

      case 'number':
        return (
          <InputNumber
            value={editValue}
            onChange={(val) => setEditValue(val)}
            placeholder={placeholder}
            prefix={prefix}
            suffix={suffix}
            precision={precision}
            style={{ width: '100%' }}
          />
        );

      case 'email':
        return (
          <Input
            type="email"
            value={editValue || ''}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder={placeholder}
            maxLength={maxLength}
          />
        );

      case 'phone':
        return (
          <Input
            type="tel"
            value={editValue || ''}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder={placeholder}
            maxLength={maxLength}
          />
        );

      default:
        return (
          <Input
            value={editValue || ''}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder={placeholder}
            maxLength={maxLength}
          />
        );
    }
  };

  if (isEditing) {
    return (
      <Space.Compact style={{ width: '100%' }}>
        <div style={{ flex: 1 }}>
          {renderEditInput()}
        </div>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={handleSave}
          loading={loading}
        >
          Save
        </Button>
        <Button
          icon={<CloseOutlined />}
          onClick={handleCancel}
          disabled={loading}
        >
          Cancel
        </Button>
      </Space.Compact>
    );
  }

  return (
    <Space style={{ width: '100%', justifyContent: 'space-between' }}>
      <span>{formatDisplayValue(value)}</span>
      <Button
        type="link"
        size="small"
        icon={<EditOutlined />}
        onClick={handleEdit}
      >
        Edit
      </Button>
    </Space>
  );
};

export default InlineEditableField;
