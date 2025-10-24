/**
 * Editable Section Component
 * Card with Edit/Save/Cancel buttons for entire section
 */

import React, { useState } from 'react';
import { Card, Button, Space, message } from 'antd';
import { EditOutlined, SaveOutlined, CloseOutlined } from '@ant-design/icons';

interface EditableSectionProps {
  title: string;
  children: (isEditing: boolean) => React.ReactNode;
  onSave: () => Promise<void>;
  style?: React.CSSProperties;
}

const EditableSection: React.FC<EditableSectionProps> = ({
  title,
  children,
  onSave,
  style
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
  };

  const handleSave = async () => {
    try {
      setLoading(true);
      await onSave();
      setIsEditing(false);
      message.success('Section updated successfully');
    } catch (error) {
      message.error('Failed to update section');
      console.error('Save section error:', error);
    } finally {
      setLoading(false);
    }
  };

  const extra = isEditing ? (
    <Space>
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
    </Space>
  ) : (
    <Button
      type="default"
      icon={<EditOutlined />}
      onClick={handleEdit}
    >
      Edit
    </Button>
  );

  return (
    <Card title={title} extra={extra} style={style}>
      {children(isEditing)}
    </Card>
  );
};

export default EditableSection;
