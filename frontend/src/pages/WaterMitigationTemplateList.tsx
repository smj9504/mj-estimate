/**
 * Water Mitigation Template List Page
 * Manages report templates for water mitigation photo reports
 */

import React, { useState } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  message,
  Popconfirm,
  Tag,
  Input,
  Modal,
  Typography,
  Tooltip
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CopyOutlined,
  StarOutlined,
  StarFilled,
  SearchOutlined
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ColumnsType } from 'antd/es/table';
import waterMitigationService from '../services/waterMitigationService';
import TemplateFormModal from '../components/water-mitigation/TemplateFormModal';
import type { ReportTemplate, TemplateType } from '../types/waterMitigation';

const { Title } = Typography;
const { Search } = Input;

const WaterMitigationTemplateList: React.FC = () => {
  const queryClient = useQueryClient();
  const [searchText, setSearchText] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ReportTemplate | null>(null);

  // Fetch templates
  const { data, isLoading } = useQuery({
    queryKey: ['wm-templates'],
    queryFn: waterMitigationService.templates.list
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: waterMitigationService.templates.delete,
    onSuccess: () => {
      message.success('Template deleted successfully');
      queryClient.invalidateQueries({ queryKey: ['wm-templates'] });
    },
    onError: () => {
      message.error('Failed to delete template');
    }
  });

  // Clone mutation
  const cloneMutation = useMutation({
    mutationFn: ({ templateId, name }: { templateId: string; name: string }) =>
      waterMitigationService.templates.clone(templateId, name),
    onSuccess: () => {
      message.success('Template cloned successfully');
      queryClient.invalidateQueries({ queryKey: ['wm-templates'] });
    },
    onError: () => {
      message.error('Failed to clone template');
    }
  });

  // Set as default mutation
  const setDefaultMutation = useMutation({
    mutationFn: (templateId: string) =>
      waterMitigationService.templates.update(templateId, { is_default: true }),
    onSuccess: () => {
      message.success('Default template updated');
      queryClient.invalidateQueries({ queryKey: ['wm-templates'] });
    },
    onError: () => {
      message.error('Failed to update default template');
    }
  });

  const handleCreateTemplate = () => {
    setEditingTemplate(null);
    setModalVisible(true);
  };

  const handleEditTemplate = (template: ReportTemplate) => {
    setEditingTemplate(template);
    setModalVisible(true);
  };

  const handleCloneTemplate = (template: ReportTemplate) => {
    Modal.confirm({
      title: 'Clone Template',
      content: (
        <div>
          <p>Enter a name for the cloned template:</p>
          <Input
            id="clone-template-name"
            defaultValue={`${template.name} (Copy)`}
            placeholder="Template name"
          />
        </div>
      ),
      onOk: () => {
        const input = document.getElementById('clone-template-name') as HTMLInputElement;
        const newName = input?.value || `${template.name} (Copy)`;
        cloneMutation.mutate({ templateId: template.id, name: newName });
      }
    });
  };

  const handleDeleteTemplate = (templateId: string) => {
    deleteMutation.mutate(templateId);
  };

  const handleSetDefault = (templateId: string) => {
    setDefaultMutation.mutate(templateId);
  };

  const handleModalClose = () => {
    setModalVisible(false);
    setEditingTemplate(null);
  };

  const handleModalSuccess = () => {
    setModalVisible(false);
    setEditingTemplate(null);
    queryClient.invalidateQueries({ queryKey: ['wm-templates'] });
  };

  // Filter templates by search text
  const filteredTemplates = data?.items.filter(template =>
    template.name.toLowerCase().includes(searchText.toLowerCase()) ||
    template.description?.toLowerCase().includes(searchText.toLowerCase())
  ) || [];

  const columns: ColumnsType<ReportTemplate> = [
    {
      title: 'Template Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: ReportTemplate) => (
        <Space>
          {record.is_default && (
            <Tooltip title="Default Template">
              <StarFilled style={{ color: '#faad14' }} />
            </Tooltip>
          )}
          <span style={{ fontWeight: record.is_default ? 600 : 400 }}>{name}</span>
        </Space>
      )
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true
    },
    {
      title: 'Type',
      dataIndex: 'template_type',
      key: 'template_type',
      width: 120,
      render: (type: TemplateType) => (
        <Tag color={type === 'standard' ? 'blue' : 'green'}>
          {type.charAt(0).toUpperCase() + type.slice(1)}
        </Tag>
      )
    },
    {
      title: 'Sections',
      dataIndex: 'sections',
      key: 'sections',
      width: 100,
      align: 'center',
      render: (sections: any[]) => (
        <Tag color="purple">{sections.length}</Tag>
      )
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 150,
      render: (date: string) => new Date(date).toLocaleDateString()
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 250,
      render: (_, record: ReportTemplate) => (
        <Space>
          <Tooltip title="Edit">
            <Button
              type="text"
              icon={<EditOutlined />}
              onClick={() => handleEditTemplate(record)}
              size="small"
            />
          </Tooltip>
          <Tooltip title="Clone">
            <Button
              type="text"
              icon={<CopyOutlined />}
              onClick={() => handleCloneTemplate(record)}
              size="small"
            />
          </Tooltip>
          {!record.is_default && (
            <Tooltip title="Set as Default">
              <Button
                type="text"
                icon={<StarOutlined />}
                onClick={() => handleSetDefault(record.id)}
                size="small"
              />
            </Tooltip>
          )}
          <Popconfirm
            title="Delete Template"
            description="Are you sure you want to delete this template?"
            onConfirm={() => handleDeleteTemplate(record.id)}
            okText="Yes"
            cancelText="No"
          >
            <Tooltip title="Delete">
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                size="small"
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <div>
      <Card>
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
            <Title level={4} style={{ margin: 0 }}>Report Templates</Title>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleCreateTemplate}
            >
              Create Template
            </Button>
          </div>
          <Search
            placeholder="Search templates..."
            allowClear
            prefix={<SearchOutlined />}
            onChange={e => setSearchText(e.target.value)}
            style={{ width: '100%', maxWidth: 400 }}
          />
        </div>

        <Table
          columns={columns}
          dataSource={filteredTemplates}
          rowKey="id"
          loading={isLoading}
          scroll={{ x: 600 }}
          pagination={{
            pageSize: 10,
            showTotal: (total) => `${total} templates`,
            showSizeChanger: true,
          }}
        />
      </Card>

      <TemplateFormModal
        visible={modalVisible}
        template={editingTemplate}
        onSuccess={handleModalSuccess}
        onCancel={handleModalClose}
      />
    </div>
  );
};

export default WaterMitigationTemplateList;
