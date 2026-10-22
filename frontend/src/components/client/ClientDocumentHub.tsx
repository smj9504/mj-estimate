import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Table,
  Select,
  Tag,
  Input,
  Tooltip,
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
  CheckOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { clientService } from '../../services/clientService';
import type { ClientDocument, ClientDocType } from '../../types/client';
import type { ColumnsType } from 'antd/es/table';
import { Pill, humanize, type TagTone } from '../common/ui';
import { tagTones } from '../../styles/tokens';
import { WM_STATUS_TONES } from '../water-mitigation/wmStatus';

dayjs.extend(relativeTime);

// Each type keeps one tone, shown as the dot on its filter chip and in the table
const DOC_TYPE_CONFIG: Record<ClientDocType, { label: string; tone: TagTone; icon: React.ReactNode }> = {
  email:              { label: 'Email',              tone: 'blue',   icon: <MailOutlined /> },
  invoice:            { label: 'Invoice',            tone: 'green',  icon: <DollarOutlined /> },
  estimate:           { label: 'Estimate',           tone: 'purple', icon: <FileTextOutlined /> },
  contract:           { label: 'Contract',           tone: 'orange', icon: <SafetyOutlined /> },
  insurance_estimate: { label: 'Insurance Est.',     tone: 'red',    icon: <FilePdfOutlined /> },
  work_order:         { label: 'Work Order',         tone: 'brown',  icon: <ToolOutlined /> },
  wm_job:             { label: 'WM Job',             tone: 'blue',   icon: <HomeOutlined /> },
  cabinet_estimate:   { label: 'Cabinet Est.',       tone: 'pink',   icon: <ExperimentOutlined /> },
  plumber_report:     { label: 'Plumber Report',     tone: 'yellow', icon: <ToolOutlined /> },
  packing_estimate:   { label: 'Packing Est.',       tone: 'gray',   icon: <FileTextOutlined /> },
};

const STATUS_TONES: Record<string, TagTone> = {
  sent: 'blue', sending: 'blue', draft: 'gray', paid: 'green',
  pending: 'orange', overdue: 'red', cancelled: 'gray',
  signed: 'green', viewed: 'yellow', voided: 'gray',
  accepted: 'green', rejected: 'red', expired: 'gray',
  completed: 'green', in_progress: 'blue', approved: 'green',
  uploaded: 'blue', extracted: 'green', failed: 'red',
  'In Progress': 'blue', Completed: 'green',
  calculated: 'blue', exported: 'purple', final: 'green',
  ...WM_STATUS_TONES,
};

// WM job statuses are already written as labels; enum values get sentence case
const statusLabel = (status: string) => (/[A-Z ]/.test(status) ? status : humanize(status));

interface ClientDocumentHubProps {
  clientId: string;
}

const ClientDocumentHub: React.FC<ClientDocumentHubProps> = ({ clientId }) => {
  const navigate = useNavigate();
  const [typeFilter, setTypeFilter] = useState<string | undefined>();
  const [claimFilter, setClaimFilter] = useState<string | undefined>();
  const [searchText, setSearchText] = useState('');

  // The type filter runs here, so the chips keep every type's count while one is selected
  const { data, isLoading } = useQuery({
    queryKey: ['client-all-documents', clientId, claimFilter],
    queryFn: () => clientService.getAllDocuments(clientId, {
      claim_id: claimFilter,
    }),
  });

  const documents = useMemo(() => data?.documents ?? [], [data]);
  const claims = data?.claims ?? [];

  const filtered = useMemo(() => {
    const q = searchText.toLowerCase();
    return documents.filter(d =>
      (!typeFilter || d.doc_type === typeFilter) && (!q ||
        d.title.toLowerCase().includes(q) ||
        (d.description || '').toLowerCase().includes(q) ||
        (d.claim_number || '').toLowerCase().includes(q))
    );
  }, [documents, searchText, typeFilter]);

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
      width: 150,
      render: (type: ClientDocType) => {
        const cfg = DOC_TYPE_CONFIG[type];
        return cfg ? (
          <span className="cl-doc-type">
            <span className="cl-doc-type-icon" aria-hidden="true">{cfg.icon}</span>
            {cfg.label}
          </span>
        ) : type;
      },
    },
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      render: (title: string, record: ClientDocument) => (
        <>
          <span className="cl-doc-title">
            <span className={record.link ? 'ui-ink-link' : 'cl-doc-title-text'}>{title}</span>
            {record.reply_received && (
              <Pill tone="green" icon={<CheckOutlined />}>Replied</Pill>
            )}
          </span>
          {record.description && <span className="ui-cell-meta">{record.description}</span>}
        </>
      ),
    },
    {
      title: 'Claim',
      dataIndex: 'claim_number',
      key: 'claim_number',
      width: 140,
      render: (num?: string) => num ? <span className="cl-meta">{num}</span> : '—',
      responsive: ['md'] as any,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 150,
      render: (status: string) => status
        ? <Pill tone={STATUS_TONES[status] || 'gray'}>{statusLabel(status)}</Pill>
        : '—',
    },
    {
      title: 'Amount',
      dataIndex: 'amount',
      key: 'amount',
      width: 120,
      align: 'right',
      render: (val?: number | null) =>
        val ? <span className="cl-money">${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> : '—',
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
          <span className="cl-nowrap">{dayjs(d).fromNow()}</span>
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

  const chip = (key: string | undefined, label: string, count: number, tone?: TagTone) => {
    const selected = typeFilter === key;
    return (
      <Tag
        key={key || 'all'}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        className={`ui-filter-chip${selected ? ' is-selected' : ''}`}
        onClick={() => setTypeFilter(selected && key ? undefined : key)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setTypeFilter(selected && key ? undefined : key);
          }
        }}
      >
        {tone && <span className="ui-filter-chip-dot" style={{ background: tagTones[tone].text }} aria-hidden="true" />}
        {label}
        <span className="ui-tab-count">{count}</span>
      </Tag>
    );
  };

  return (
    <div>
      {/* Filters: search and claim, then one chip per document type */}
      <div className="cl-hub-toolbar">
        <Input
          placeholder="Search documents..."
          prefix={<SearchOutlined />}
          allowClear
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          className="cl-hub-search"
          aria-label="Search documents"
        />
        <Select
          placeholder="All claims"
          allowClear
          className="cl-hub-claim"
          value={claimFilter}
          onChange={setClaimFilter}
          aria-label="Claim"
          options={claims.map(c => ({
            value: c.id,
            label: `Claim #${c.claim_number}`,
          }))}
        />
        <span className="cl-meta cl-hub-total">
          {filtered.length} document{filtered.length === 1 ? '' : 's'}
        </span>
      </div>

      {documents.length > 0 && (
        <div className="cl-hub-chips" role="group" aria-label="Document type">
          {chip(undefined, 'All', documents.length)}
          {(Object.keys(DOC_TYPE_CONFIG) as ClientDocType[])
            .filter(type => typeCounts[type])
            .map(type => chip(type, DOC_TYPE_CONFIG[type].label, typeCounts[type], DOC_TYPE_CONFIG[type].tone))}
        </div>
      )}

      <Table<ClientDocument>
        rowKey="id"
        columns={columns}
        dataSource={filtered}
        loading={isLoading}
        size="small"
        className="cl-table"
        scroll={{ x: 640 }}
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          showTotal: (total) => `${total} documents`,
          hideOnSinglePage: true,
        }}
        locale={{
          emptyText: (
            <div className="cl-empty">
              {typeFilter ? `No ${DOC_TYPE_CONFIG[typeFilter as ClientDocType]?.label || typeFilter} found.` : 'No documents found.'}
            </div>
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
