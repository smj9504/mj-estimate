/**
 * Template Builder Bar
 * Bottom floating bar that shows selected items and template building status
 * Provides quick access to template builder
 */

import React from 'react';
import {
  Badge,
  Button,
  Space,
  Tooltip,
  Typography,
} from 'antd';
import {
  AppstoreAddOutlined,
  CloseOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { useTemplateBuilder } from '../../contexts/TemplateBuilderContext';

const { Text } = Typography;

const TemplateBuilderBar: React.FC = () => {
  const {
    selectedItemIds,
    builderItems,
    clearSelection,
    openBuilder,
  } = useTemplateBuilder();

  const selectedCount = selectedItemIds.size;
  const builderCount = builderItems.length;
  const hasSelection = selectedCount > 0;
  const hasBuilderItems = builderCount > 0;

  // Don't show bar if nothing is selected and builder is empty
  if (!hasSelection && !hasBuilderItems) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: '60px',
        background: '#001529',
        borderTop: '2px solid #1890ff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        zIndex: 1000,
        boxShadow: '0 -2px 8px rgba(0,0,0,0.15)'
      }}
    >
      <Space size="large">
        {/* Selection Info */}
        {hasSelection && (
          <Space>
            <Badge count={selectedCount} showZero={false} style={{ backgroundColor: '#52c41a' }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: '#1890ff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <AppstoreAddOutlined style={{ color: 'white', fontSize: 20 }} />
              </div>
            </Badge>
            <div>
              <Text style={{ color: 'white', fontWeight: 'bold' }}>
                {selectedCount} item{selectedCount !== 1 ? 's' : ''} selected
              </Text>
              <br />
              <Text style={{ color: '#8c8c8c', fontSize: 12 }}>
                Ready to add to template
              </Text>
            </div>
          </Space>
        )}

        {/* Builder Info */}
        {hasBuilderItems && (
          <Space>
            <Badge count={builderCount} showZero style={{ backgroundColor: '#faad14' }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: '#faad14',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <EditOutlined style={{ color: 'white', fontSize: 20 }} />
              </div>
            </Badge>
            <div>
              <Text style={{ color: 'white', fontWeight: 'bold' }}>
                Template Builder
              </Text>
              <br />
              <Text style={{ color: '#8c8c8c', fontSize: 12 }}>
                {builderCount} item{builderCount !== 1 ? 's' : ''} in builder
              </Text>
            </div>
          </Space>
        )}
      </Space>

      {/* Actions */}
      <Space>
        {hasSelection && (
          <Tooltip title="Clear selection">
            <Button
              icon={<CloseOutlined />}
              onClick={clearSelection}
              style={{ color: 'white', borderColor: 'white' }}
            >
              Clear
            </Button>
          </Tooltip>
        )}

        {hasBuilderItems && (
          <Tooltip title="Open template builder">
            <Button
              type="primary"
              icon={<EditOutlined />}
              onClick={() => openBuilder('new')}
              style={{ background: '#faad14', borderColor: '#faad14' }}
            >
              Edit Template ({builderCount})
            </Button>
          </Tooltip>
        )}
      </Space>
    </div>
  );
};

export default TemplateBuilderBar;
