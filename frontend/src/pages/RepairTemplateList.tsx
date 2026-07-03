import React, { useState } from 'react';
import {
  Button, Card, Grid, Input, Popconfirm, Select, Space, Table, Tag, Typography, message,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, ToolOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { repairSpecService } from '../services/repairSpecService';
import { RepairTemplateListItem } from '../types/repairSpec';

const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

const SURFACE_OPTIONS = [
  { value: 'wall', label: 'Wall' },
  { value: 'floor', label: 'Floor' },
  { value: 'ceiling', label: 'Ceiling' },
  { value: 'general', label: 'General' },
];

const RepairTemplateList: React.FC = () => {
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [surfaceFilter, setSurfaceFilter] = useState<string | undefined>();
  const [search, setSearch] = useState('');

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['repair-templates', surfaceFilter],
    queryFn: () => repairSpecService.listTemplates({ surface: surfaceFilter }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => repairSpecService.deleteTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repair-templates'] });
      message.success('Template deleted');
    },
  });

  const filtered = templates.filter((t) =>
    !search || t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.tags?.some((tag) => tag.toLowerCase().includes(search.toLowerCase()))
  );

  const columns = [
    {
      title: 'Name',
      key: 'name',
      render: (_: unknown, record: RepairTemplateListItem) => (
        <Space direction="vertical" size={0}>
          <Space>
            <Button type="link" style={{ padding: 0 }} onClick={() => navigate(`/repair-templates/${record.id}`)}>
              {record.name}
            </Button>
            {!record.company_id && <Tag color="default">System</Tag>}
          </Space>
          {record.tags?.length > 0 && (
            <Space size={4} style={{ marginTop: 2 }}>
              {record.tags.map((tag) => (
                <Tag key={tag} style={{ fontSize: 11 }}>{tag}</Tag>
              ))}
            </Space>
          )}
        </Space>
      ),
    },
    {
      title: 'Surface',
      dataIndex: 'surface',
      key: 'surface',
      width: 90,
      render: (v: string) => v ? <Tag>{v}</Tag> : '—',
    },
    {
      title: 'Conditions',
      dataIndex: 'condition_count',
      key: 'conditions',
      width: 90,
      align: 'center' as const,
    },
    {
      title: 'Items',
      dataIndex: 'item_count',
      key: 'items',
      width: 70,
      align: 'center' as const,
    },
    {
      title: 'Used',
      dataIndex: 'usage_count',
      key: 'usage',
      width: 70,
      align: 'center' as const,
      sorter: (a: RepairTemplateListItem, b: RepairTemplateListItem) =>
        (a.usage_count || 0) - (b.usage_count || 0),
    },
    {
      title: '',
      key: 'actions',
      width: 80,
      render: (_: unknown, record: RepairTemplateListItem) =>
        record.company_id ? (
          <Space size={4}>
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => navigate(`/repair-templates/${record.id}`)}
            />
            <Popconfirm
              title="Delete this template?"
              onConfirm={() => deleteMutation.mutate(record.id)}
            >
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        ) : null,
    },
  ];

  return (
    <div>
      <Space
        style={{
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <Space align="center">
          <ToolOutlined style={{ fontSize: 20 }} />
          <Title level={isMobile ? 4 : 3} style={{ margin: 0 }}>
            Repair Templates
          </Title>
        </Space>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          size={isMobile ? 'small' : 'middle'}
          onClick={() => navigate('/repair-templates/new')}
        >
          New Template
        </Button>
      </Space>

      <Card size={isMobile ? 'small' : 'default'}>
        <Space style={{ marginBottom: 12, flexWrap: 'wrap' }} size={8}>
          <Input.Search
            placeholder="Search templates..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: isMobile ? '100%' : 220 }}
            size={isMobile ? 'small' : 'middle'}
            allowClear
          />
          <Select
            placeholder="Surface"
            allowClear
            value={surfaceFilter}
            onChange={setSurfaceFilter}
            style={{ width: 120 }}
            size={isMobile ? 'small' : 'middle'}
            options={SURFACE_OPTIONS}
          />
        </Space>

        <Table
          size="small"
          rowKey="id"
          loading={isLoading}
          dataSource={filtered}
          columns={isMobile ? columns.filter((c) => ['name', 'surface', 'actions'].includes(c.key)) : columns}
          pagination={{ pageSize: 20 }}
          scroll={{ x: isMobile ? 300 : 700 }}
        />
      </Card>
    </div>
  );
};

export default RepairTemplateList;
