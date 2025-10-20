/**
 * Description Edit Modal Component
 * Shows when user modifies a LineItem's description
 * Offers options: Update existing / Create new / Use one-time
 */

import React from 'react';
import { Modal, Radio, Space, Typography, Alert } from 'antd';
import {
  EditOutlined,
  PlusOutlined,
  FileTextOutlined
} from '@ant-design/icons';

const { Text } = Typography;

export type DescriptionEditAction = 'update' | 'create_new' | 'one_time';

interface DescriptionEditModalProps {
  visible: boolean;
  originalDescription: string;
  modifiedDescription: string;
  onConfirm: (action: DescriptionEditAction) => void;
  onCancel: () => void;
}

const DescriptionEditModal: React.FC<DescriptionEditModalProps> = ({
  visible,
  originalDescription,
  modifiedDescription,
  onConfirm,
  onCancel,
}) => {
  const [selectedAction, setSelectedAction] = React.useState<DescriptionEditAction>('one_time');

  const handleOk = () => {
    onConfirm(selectedAction);
  };

  return (
    <Modal
      title="Description Modified"
      open={visible}
      onOk={handleOk}
      onCancel={onCancel}
      okText="Confirm"
      width={600}
    >
      <Alert
        message="You have modified the description"
        description={
          <div>
            <div style={{ marginTop: 8 }}>
              <Text strong>Original:</Text> {originalDescription}
            </div>
            <div style={{ marginTop: 4 }}>
              <Text strong>Modified:</Text> {modifiedDescription}
            </div>
          </div>
        }
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      <Text strong>What would you like to do?</Text>

      <Radio.Group
        value={selectedAction}
        onChange={e => setSelectedAction(e.target.value)}
        style={{ marginTop: 12, width: '100%' }}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Radio value="update">
            <Space>
              <EditOutlined />
              <div>
                <div><Text strong>Update Existing Item in Library</Text></div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  This will update the LineItem in the library. All future uses will see the new description.
                </Text>
              </div>
            </Space>
          </Radio>

          <Radio value="create_new">
            <Space>
              <PlusOutlined />
              <div>
                <div><Text strong>Save as New Item in Library</Text></div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Create a new LineItem with the modified description. Original item remains unchanged.
                </Text>
              </div>
            </Space>
          </Radio>

          <Radio value="one_time">
            <Space>
              <FileTextOutlined />
              <div>
                <div><Text strong>Use for This Document Only</Text></div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Use the modified description only in this document. Will not be saved to library.
                </Text>
              </div>
            </Space>
          </Radio>
        </Space>
      </Radio.Group>
    </Modal>
  );
};

export default DescriptionEditModal;
