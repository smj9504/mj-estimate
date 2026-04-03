/**
 * WMFloorSelector
 *
 * Horizontal tab navigation for WM floor sketches.
 * Uses Ant Design Tabs with editable-card type so the built-in "+"
 * button creates new floors and each tab's close icon removes one.
 * A context-menu dropdown on each tab label provides rename/reorder/delete.
 *
 * Usage:
 *   <WMFloorSelector
 *     floors={floors}
 *     activeFloorId={activeFloorId}
 *     onFloorSelect={handleSelect}
 *     onAddFloor={handleAdd}
 *     onDeleteFloor={handleDelete}
 *     onReorderFloor={handleReorder}
 *   />
 */

import React, { useState } from 'react';
import {
  Tabs,
  Dropdown,
  Modal,
  Form,
  Select,
  Input,
  Radio,
  Space,
  Typography,
  Popconfirm,
  message,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  MoreOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import type { WMFloorSketch } from '../../../types/wmSketch';
import type { FloorPlanSourceType } from '../../../types/wmSketch';
import { FLOOR_LABEL_PRESETS } from './utils/wmDefaults';

// ============================================================================
// Props
// ============================================================================

export interface WMFloorSelectorProps {
  floors: WMFloorSketch[];
  activeFloorId: string | null;
  onFloorSelect: (floorId: string) => void;
  onAddFloor: (label: string, sourceType: FloorPlanSourceType) => void;
  onDeleteFloor: (floorId: string) => void;
  onReorderFloor: (floorId: string, direction: 'up' | 'down') => void;
  onRenameFloor?: (floorId: string, newLabel: string) => void;
}

// ============================================================================
// Add Floor Modal
// ============================================================================

interface AddFloorModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (label: string, sourceType: FloorPlanSourceType) => void;
}

const AddFloorModal: React.FC<AddFloorModalProps> = ({ open, onClose, onConfirm }) => {
  const [form] = Form.useForm<{ label: string; customLabel: string; sourceType: FloorPlanSourceType }>();
  const [isCustom, setIsCustom] = useState(false);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      const label = isCustom ? values.customLabel : values.label;
      if (!label?.trim()) {
        message.warning('Please enter a floor label.');
        return;
      }
      onConfirm(label.trim(), values.sourceType);
      form.resetFields();
      setIsCustom(false);
      onClose();
    } catch {
      // validation errors shown inline
    }
  };

  const handleCancel = () => {
    form.resetFields();
    setIsCustom(false);
    onClose();
  };

  return (
    <Modal
      title="Add Floor"
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      okText="Add Floor"
      width={400}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ label: '1st Floor', sourceType: 'sketch' as FloorPlanSourceType }}
        style={{ marginTop: 8 }}
      >
        <Form.Item label="Floor Label">
          <Space.Compact style={{ width: '100%' }}>
            {!isCustom ? (
              <Form.Item name="label" noStyle>
                <Select
                  style={{ flex: 1 }}
                  options={[
                    ...FLOOR_LABEL_PRESETS.map((p) => ({ value: p, label: p })),
                    { value: '__custom__', label: 'Custom...' },
                  ]}
                  onChange={(val) => {
                    if (val === '__custom__') {
                      setIsCustom(true);
                      form.setFieldValue('label', '__custom__');
                    }
                  }}
                />
              </Form.Item>
            ) : (
              <Form.Item
                name="customLabel"
                noStyle
                rules={[{ required: true, message: 'Label is required' }]}
              >
                <Input
                  placeholder="e.g. Garage, Crawlspace..."
                  style={{ flex: 1 }}
                  suffix={
                    <Typography.Link
                      style={{ fontSize: 12, whiteSpace: 'nowrap' }}
                      onClick={() => {
                        setIsCustom(false);
                        form.setFieldValue('label', '1st Floor');
                      }}
                    >
                      Presets
                    </Typography.Link>
                  }
                />
              </Form.Item>
            )}
          </Space.Compact>
        </Form.Item>

        <Form.Item name="sourceType" label="Floor Plan Source">
          <Radio.Group>
            <Radio value="sketch">Draw Floor Plan</Radio>
            <Radio value="image">Import Image</Radio>
          </Radio.Group>
        </Form.Item>
      </Form>
    </Modal>
  );
};

// ============================================================================
// Rename Floor Modal
// ============================================================================

interface RenameFloorModalProps {
  open: boolean;
  currentLabel: string;
  onClose: () => void;
  onConfirm: (newLabel: string) => void;
}

const RenameFloorModal: React.FC<RenameFloorModalProps> = ({
  open,
  currentLabel,
  onClose,
  onConfirm,
}) => {
  const [form] = Form.useForm<{ label: string }>();

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      if (!values.label?.trim()) return;
      onConfirm(values.label.trim());
      form.resetFields();
      onClose();
    } catch {
      // validation errors shown inline
    }
  };

  return (
    <Modal
      title="Rename Floor"
      open={open}
      onOk={handleOk}
      onCancel={() => { form.resetFields(); onClose(); }}
      okText="Rename"
      width={360}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ label: currentLabel }}
        style={{ marginTop: 8 }}
      >
        <Form.Item
          name="label"
          label="New Label"
          rules={[{ required: true, message: 'Label is required' }]}
        >
          <Input autoFocus />
        </Form.Item>
      </Form>
    </Modal>
  );
};

// ============================================================================
// Tab Label with context menu
// ============================================================================

interface TabLabelProps {
  floor: WMFloorSketch;
  isFirst: boolean;
  isLast: boolean;
  onRename: (floorId: string) => void;
  onReorder: (floorId: string, direction: 'up' | 'down') => void;
  onDelete: (floorId: string) => void;
}

const TabLabel: React.FC<TabLabelProps> = ({
  floor,
  isFirst,
  isLast,
  onRename,
  onReorder,
  onDelete,
}) => {
  const menuItems: MenuProps['items'] = [
    {
      key: 'rename',
      icon: <EditOutlined />,
      label: 'Rename',
      onClick: () => onRename(floor.id),
    },
    {
      key: 'move_up',
      icon: <ArrowUpOutlined />,
      label: 'Move Left',
      disabled: isFirst,
      onClick: () => onReorder(floor.id, 'up'),
    },
    {
      key: 'move_down',
      icon: <ArrowDownOutlined />,
      label: 'Move Right',
      disabled: isLast,
      onClick: () => onReorder(floor.id, 'down'),
    },
    { type: 'divider' },
    {
      key: 'delete',
      icon: <DeleteOutlined />,
      label: (
        <Popconfirm
          title="Delete this floor?"
          description="All sketch data for this floor will be lost."
          onConfirm={() => onDelete(floor.id)}
          okText="Delete"
          okButtonProps={{ danger: true }}
          cancelText="Cancel"
        >
          <span style={{ color: '#ff4d4f' }}>Delete Floor</span>
        </Popconfirm>
      ),
      danger: true,
    },
  ];

  return (
    <Space size={4} style={{ userSelect: 'none' }}>
      <span>{floor.floor_label}</span>
      <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="bottomRight">
        <MoreOutlined
          style={{ fontSize: 12, color: '#8c8c8c', padding: '0 2px' }}
          onClick={(e) => e.stopPropagation()}
        />
      </Dropdown>
    </Space>
  );
};

// ============================================================================
// Main Component
// ============================================================================

const WMFloorSelector: React.FC<WMFloorSelectorProps> = ({
  floors,
  activeFloorId,
  onFloorSelect,
  onAddFloor,
  onDeleteFloor,
  onReorderFloor,
  onRenameFloor,
}) => {
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<WMFloorSketch | null>(null);

  const sortedFloors = [...floors].sort((a, b) => a.floor_order - b.floor_order);

  const tabItems = sortedFloors.map((floor, idx) => ({
    key: floor.id,
    label: (
      <TabLabel
        floor={floor}
        isFirst={idx === 0}
        isLast={idx === sortedFloors.length - 1}
        onRename={(id) => {
          const f = floors.find((fl) => fl.id === id);
          if (f) setRenameTarget(f);
        }}
        onReorder={onReorderFloor}
        onDelete={onDeleteFloor}
      />
    ),
    closable: false,
  }));

  return (
    <>
      <Tabs
        type="editable-card"
        activeKey={activeFloorId ?? undefined}
        items={tabItems}
        onChange={onFloorSelect}
        onEdit={(_, action) => {
          if (action === 'add') setAddModalOpen(true);
        }}
        size="small"
        style={{ marginBottom: 0 }}
        tabBarStyle={{ marginBottom: 0 }}
      />

      <AddFloorModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onConfirm={onAddFloor}
      />

      <RenameFloorModal
        open={!!renameTarget}
        currentLabel={renameTarget?.floor_label ?? ''}
        onClose={() => setRenameTarget(null)}
        onConfirm={(newLabel) => {
          if (renameTarget) {
            onRenameFloor?.(renameTarget.id, newLabel);
          }
          setRenameTarget(null);
        }}
      />
    </>
  );
};

export default WMFloorSelector;
