import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Table,
  Select,
  Tag,
  Space,
  Typography,
  Input,
  Row,
  Col,
  Empty,
  Tooltip,
  Badge,
  Statistic,
  Card,
} from 'antd';
import {
  MailOutlined,
  FileTextOutlined,
  FilePdfOutlined,
  DollarOutlined,
  SafetyOutlined,
  ToolOutlined,
  HomeOutlined,
  ExperimentOutlined,
  SearchOutlined,
  CheckCircleOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { clientService } from '../../services/clientService';
import type { ClientDocument, ClientDocType } from '../../types/client';
import type { ColumnsType } from 'antd/es/table';

dayjs.extend(relativeTime);

const { Text } = Typography;

const DOC_TYPE_CONFIG: Record<ClientDocType, { label: string; color: string; icon: React.ReactNode }> = {
  email:              { label: 'Email',              color: 'blue',       icon: <MailOutlined /> },
  invoice:            { label: 'Invoice',            color: 'green',      icon: <DollarOutlined /> },
  estimate:           { label: 'Estimate',           color: 'purple',     icon: <FileTextOutlined /> },
  contract:           { label: 'Contract',           color: 'orange',     icon: <SafetyOutlined /> },
  insurance_estimate: { label: 'Insurance Est.',     color: 'red',        icon: <FilePdfOutlined /> },
  work_order:         { label: 'Work Order',         color: 'cyan',       icon: <ToolOutlined /> },
  wm_job:             { label: 'WM Job',             color: 'geekblue',   icon: <HomeOutlined /> },
  cabinet_estimate:   { label: 'Cabinet Est.',       color: 'magenta',    icon: <ExperimentOutlined /> },
  plumber_report:     { label: 'Plumber Report',     color: 'volcano',    icon: <ToolOutlined /> },
  packing_estimate:   { label: 'Packing Est.',       color: 'lime',       icon: <FileTextOutlined /> },
};

const STATUS_COLORS: Record<string, string> = {
  sent: 'blue', sending: 'processing', draft: 'default', paid: 'green',
  pending: 'orange', overdue: 'red', cancelled: 'default',
  signed: 'green', viewed: 'cyan', voided: 'default',
  accepted: 'green', rejected: 'red', expired: 'default',
  completed: 'green', in_progress: 'processing', approved: 'green',
  uploaded: 'blue', extracted: 'green', failed: 'red',
  Lead: 'default', 'In Progress': 'processing', 'Sent to adjuster': 'blue',
  Completed: 'green', calculated: 'processing', exported: 'cyan', final: 'green',
};

interface ClientDocumentHubProps {
  clientId: string;
}

const ClientDocumentHub: React.FC<ClientDocumentHubProps> = ({ clientId }) => {
  const navigate = useNavigate();
  const [typeFilter, setTypeFilter] = useState<string | undefined>();
  const [claimFilter, setClaimFilter] = useState<string | undefined>();
  const [searchText, setSearchText] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['client-all-documents', clientId, typeFilter, claimFilter],
    queryFn: () => clientService.getAllDocuments(clientId, {
      doc_type: typeFilter,
      claim_id: claimFilter,
    }),
  });

  const documents = data?.documents ?? [];
  const claims = data?.claims ?? [];

  // Local text search filter
  const filtered = useMemo(() => {
    if (!searchText) return documents;
    const q = searchText.toLowerCase();
    return documents.filter(d =>
      d.title.toLowerCase().includes(q) ||
      (d.description || '').toLowerCase().includes(q) ||
      (d.claim_number || '').toLowerCase().includes(q)
    );
  }, [documents, searchText]);

  // Summary counts by type
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of documents) {
      counts[d.doc_type] = (counts[d.doc_type] || 0) + 1;
    }
    return counts;
  }, [documents]);

  const columns: ColumnsType<ClientDocument> = [
    {
      title: 'Type',
      dataIndex: 'doc_type',
      key: 'doc_type',
      width: 140,
      render: (type: ClientDocType) => {
        const cfg = DOC_TYPE_CONFIG[type];
        return cfg ? (
          <Tag color={cfg.color} icon={cfg.icon} style={{ margin: 0 }}>
            {cfg.label}
          </Tag>
        ) : type;
      },
      filters: Object.entries(DOC_TYPE_CONFIG).map(([k, v]) => ({
        text: v.label,
        value: k,
      })),
      onFilter: (value, record) => record.doc_type === value,
    },
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      render: (title: string, record: ClientDocument) => (
        <Space direction="vertical" size={0}>
          <Space size={4}>
            <Text strong style={{ fontSize: 13 }}>{title}</Text>
            {record.link && <LinkOutlined style={{ color: '#1890ff', fontSize: 11 }} />}
            {record.reply_received && (
              <Tooltip title="Reply received">
                <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 12 }} />
              </Tooltip>
            )}
          </Space>
          {record.description && (
            <Text type="secondary" style={{ fontSize: 12 }} ellipsis>
              {record.description}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Claim',
      dataIndex: 'claim_number',
      key: 'claim_number',
      width: 130,
      render: (num?: string) => num ? <Text type="secondary">{num}</Text> : '—',
      responsive: ['md'] as any,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status: string) => (
        <Tag color={STATUS_COLORS[status] || 'default'} style={{ margin: 0 }}>
          {status}
        </Tag>
      ),
    },
    {
      title: 'Amount',
      dataIndex: 'amount',
      key: 'amount',
      width: 110,
      align: 'right',
      render: (val?: number | null) =>
        val ? `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—',
      sorter: (a, b) => (a.amount || 0) - (b.amount || 0),
      responsive: ['lg'] as any,
    },
    {
      title: 'Date',
      dataIndex: 'date',
      key: 'date',
      width: 120,
      render: (d?: string) => d ? (
        <Tooltip title={dayjs(d).format('YYYY-MM-DD HH:mm')}>
          <Text style={{ fontSize: 12 }}>{dayjs(d).fromNow()}</Text>
        </Tooltip>
      ) : '—',
      sorter: (a, b) => dayjs(a.date).unix() - dayjs(b.date).unix(),
      defaultSortOrder: 'descend',
    },
  ];

  const handleRowClick = (record: ClientDocument) => {
    if (record.link) {
      navigate(record.link);
    }
  };

  return (
    <div>
      {/* Summary cards */}
      <Row gutter={[8, 8]} style={{ marginBottom: 16 }}>
        {Object.entries(typeCounts).map(([type, count]) => {
          const cfg = DOC_TYPE_CONFIG[type as ClientDocType];
          if (!cfg) return null;
          return (
            <Col key={type}>
              <Card
                size="small"
                style={{
                  cursor: 'pointer',
                  borderColor: typeFilter === type ? '#1890ff' : undefined,
                  background: typeFilter === type ? '#e6f4ff' : undefined,
                }}
                styles={{ body: { padding: '8px 16px' } }}
                onClick={() => setTypeFilter(typeFilter === type ? undefined : type)}
              >
                <Statistic
                  title={<span style={{ fontSize: 11 }}>{cfg.label}</span>}
                  value={count}
                  valueStyle={{ fontSize: 20 }}
                  prefix={cfg.icon}
                />
              </Card>
            </Col>
          );
        })}
      </Row>

      {/* Filters */}
      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        <Col xs={24} sm={8}>
          <Input
            placeholder="Search documents..."
            prefix={<SearchOutlined />}
            allowClear
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
          />
        </Col>
        <Col xs={12} sm={6}>
          <Select
            placeholder="Document type"
            allowClear
            style={{ width: '100%' }}
            value={typeFilter}
            onChange={setTypeFilter}
            options={Object.entries(DOC_TYPE_CONFIG).map(([k, v]) => ({
              value: k,
              label: <Space>{v.icon}{v.label}</Space>,
            }))}
          />
        </Col>
        <Col xs={12} sm={6}>
          <Select
            placeholder="All claims"
            allowClear
            style={{ width: '100%' }}
            value={claimFilter}
            onChange={setClaimFilter}
            options={claims.map(c => ({
              value: c.id,
              label: `Claim #${c.claim_number}`,
            }))}
          />
        </Col>
        <Col xs={24} sm={4}>
          <Badge count={filtered.length} style={{ backgroundColor: '#1890ff' }}>
            <Text type="secondary" style={{ lineHeight: '32px' }}>
              Total documents
            </Text>
          </Badge>
        </Col>
      </Row>

      {/* Table */}
      <Table<ClientDocument>
        rowKey="id"
        columns={columns}
        dataSource={filtered}
        loading={isLoading}
        size="small"
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          showTotal: (total) => `${total} documents`,
        }}
        locale={{
          emptyText: (
            <Empty
              description={typeFilter ? `No ${DOC_TYPE_CONFIG[typeFilter as ClientDocType]?.label || typeFilter} found` : 'No documents found'}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ),
        }}
        onRow={(record) => ({
          onClick: () => handleRowClick(record),
          style: { cursor: record.link ? 'pointer' : 'default' },
        })}
      />
    </div>
  );
};

export default ClientDocumentHub;
