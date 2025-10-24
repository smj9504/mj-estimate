/**
 * Line Item Template Manager Component
 * Allows users to browse, edit, and delete line item templates
 */

import React, { useState, useEffect } from 'react';
import {
  Modal,
  Table,
  Button,
  Space,
  message,
  Popconfirm,
  Tag,
  Typography,
  Input,
  Select,
  Tooltip,
} from 'antd';
import {
  FolderOpenOutlined,
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import lineItemService from '../../services/lineItemService';
import { LineItemTemplate } from '../../types/lineItem';
import { useTemplateBuilder } from '../../contexts/TemplateBuilderContext';

const { Text } = Typography;
const { Search } = Input;

interface LineItemTemplateManagerProps {
  open: boolean;
  onClose: () => void;
  companyId?: string;
}

const LineItemTemplateManager: React.FC<LineItemTemplateManagerProps> = ({
  open,
  onClose,
  companyId,
}) => {
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<LineItemTemplate[]>([]);
  const [filteredTemplates, setFilteredTemplates] = useState<LineItemTemplate[]>([]);
  const [searchText, setSearchText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>(undefined);

  const { loadTemplate, openBuilder } = useTemplateBuilder();

  // Fetch templates when modal opens
  useEffect(() => {
    if (open) {
      fetchTemplates();
    }
  }, [open, companyId]);

  // Filter templates when search or category changes
  useEffect(() => {
    let filtered = templates;

    // Filter by search text
    if (searchText) {
      const searchLower = searchText.toLowerCase();
      filtered = filtered.filter(
        t =>
          t.name.toLowerCase().includes(searchLower) ||
          t.description?.toLowerCase().includes(searchLower) ||
          t.category?.toLowerCase().includes(searchLower)
      );
    }

    // Filter by category
    if (selectedCategory) {
      filtered = filtered.filter(t => t.category === selectedCategory);
    }

    setFilteredTemplates(filtered);
  }, [templates, searchText, selectedCategory]);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const fetchedTemplates = await lineItemService.getTemplates(
        companyId,
        undefined, // all categories
        true       // only active templates
      );
      setTemplates(fetchedTemplates);
    } catch (error: any) {
      message.error(error.message || 'Failed to fetch templates');
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (template: LineItemTemplate) => {
    openBuilder('edit', template);
    onClose(); // Close the manager modal
  };

  const handleDelete = async (templateId: string) => {
    try {
      await lineItemService.deleteTemplate(templateId);
      message.success('Template deleted successfully');
      fetchTemplates(); // Refresh the list
    } catch (error: any) {
      message.error(error.message || 'Failed to delete template');
    }
  };

  const handleDuplicate = async (template: LineItemTemplate) => {
    try {
      const newName = `${template.name} (Copy)`;
      await lineItemService.duplicateTemplate(template.id, newName, template.description);
      message.success(`Template "${template.name}" duplicated successfully`);
      fetchTemplates(); // Refresh the list
    } catch (error: any) {
      message.error(error.message || 'Failed to duplicate template');
    }
  };

  // Get unique categories for filter
  const categories = Array.from(new Set(templates.map(t => t.category).filter(Boolean)));

  const columns = [
    {
      title: 'Template Name',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: LineItemTemplate) => (
        <Space direction="vertical" size={0}>
          <Text strong>{text}</Text>
          {record.description && (
            <Text type="secondary" style={{ fontSize: '12px' }}>
              {record.description}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
      width: 120,
      render: (category: string) =>
        category ? <Tag color="blue">{category}</Tag> : <Text type="secondary">-</Text>,
    },
    {
      title: 'Items',
      dataIndex: 'template_items',
      key: 'items',
      width: 80,
      align: 'center' as const,
      render: (items: any[]) => (
        <Tag color="green">{items?.length || 0}</Tag>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 90,
      render: (isActive: boolean) =>
        isActive ? (
          <Tag color="success">Active</Tag>
        ) : (
          <Tag color="default">Inactive</Tag>
        ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 180,
      render: (_: any, record: LineItemTemplate) => (
        <Space size="small">
          <Tooltip title="Edit Template">
            <Button
              type="primary"
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record)}
            >
              Edit
            </Button>
          </Tooltip>

          <Popconfirm
            title="Delete Template"
            description="Are you sure you want to delete this template?"
            onConfirm={() => handleDelete(record.id)}
            okText="Delete"
            cancelText="Cancel"
            okButtonProps={{ danger: true }}
          >
            <Tooltip title="Delete Template">
              <Button
                danger
                size="small"
                icon={<DeleteOutlined />}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Modal
      title={
        <Space>
          <FolderOpenOutlined />
          <span>Manage Line Item Templates</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose}>
          Close
        </Button>,
      ]}
      width={900}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {/* Filters */}
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space>
            <Search
              placeholder="Search templates..."
              allowClear
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              style={{ width: 250 }}
              prefix={<SearchOutlined />}
            />

            <Select
              placeholder="Filter by category"
              allowClear
              value={selectedCategory}
              onChange={setSelectedCategory}
              style={{ width: 180 }}
            >
              {categories.map(cat => (
                <Select.Option key={cat} value={cat}>
                  {cat}
                </Select.Option>
              ))}
            </Select>
          </Space>

          <Button
            icon={<ReloadOutlined />}
            onClick={fetchTemplates}
            loading={loading}
          >
            Refresh
          </Button>
        </Space>

        {/* Templates Table */}
        <Table
          columns={columns}
          dataSource={filteredTemplates}
          rowKey="id"
          loading={loading}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (total) => `Total ${total} templates`,
          }}
          size="small"
        />
      </Space>
    </Modal>
  );
};

export default LineItemTemplateManager;
