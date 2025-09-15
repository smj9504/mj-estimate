import React, { useState } from 'react';
import {
  Table,
  Button,
  Space,
  Input,
  Row,
  Col,
  Card,
  Avatar,
  Modal,
  Tooltip,
  Tag,
  Badge,
} from 'antd';
import {
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
  PlusOutlined,
  ExclamationCircleOutlined,
  PhoneOutlined,
  MailOutlined,
  EnvironmentOutlined,
  BuildOutlined,
  FileTextOutlined,
  SafetyOutlined,
  CheckCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { Company, CompanyFilter } from '../../types';

const { Search } = Input;
const { confirm } = Modal;

interface CompanyTableProps {
  companies: Company[];
  loading?: boolean;
  onEdit: (company: Company) => void;
  onDelete: (id: string) => Promise<void>;
  onAdd: () => void;
  filter: CompanyFilter;
  onFilterChange: (filter: CompanyFilter) => void;
}

const CompanyTable: React.FC<CompanyTableProps> = ({
  companies,
  loading = false,
  onEdit,
  onDelete,
  onAdd,
  filter,
  onFilterChange,
}) => {
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);

  const handleDelete = (company: Company) => {
    confirm({
      title: 'Delete Company',
      icon: <ExclamationCircleOutlined />,
      content: (
        <div>
          <p>Are you sure you want to delete <strong>{company.name}</strong>?</p>
          <p style={{ color: '#ff4d4f', fontSize: '12px' }}>
            ⚠️ This action cannot be undone.
          </p>
        </div>
      ),
      okText: 'Delete',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      onOk: async () => {
        setDeleteLoading(company.id);
        try {
          await onDelete(company.id);
          // 메시지는 상위 컴포넌트에서 처리
        } catch (error) {
          // 에러 메시지도 상위 컴포넌트에서 처리
        } finally {
          setDeleteLoading(null);
        }
      },
    });
  };

  const renderLogo = (logo?: string, name?: string) => {
    if (logo) {
      try {
        // Handle both base64 data URLs and regular URLs
        const logoSrc = logo.startsWith('data:image') ? logo : `data:image/png;base64,${logo}`;
        return (
          <Avatar
            src={logoSrc}
            size={40}
            alt={name}
            style={{ flexShrink: 0 }}
          />
        );
      } catch {
        return (
          <Avatar
            icon={<BuildOutlined />}
            size={40}
            style={{ backgroundColor: '#f0f0f0', color: '#999' }}
          />
        );
      }
    }
    return (
      <Avatar
        icon={<BuildOutlined />}
        size={40}
        style={{ backgroundColor: '#f0f0f0', color: '#999' }}
      />
    );
  };

  const columns: ColumnsType<Company> = [
    {
      title: 'Logo',
      dataIndex: 'logo',
      key: 'logo',
      width: 80,
      render: (logo, record) => renderLogo(logo, record.name),
    },
    {
      title: 'Company Name',
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (name, record) => (
        <div>
          <div style={{ fontWeight: 'bold', fontSize: '14px' }}>{name}</div>
          {record.email && (
            <div style={{ fontSize: '12px', color: '#666' }}>
              <MailOutlined style={{ marginRight: 4 }} />
              {record.email}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Company Code',
      dataIndex: 'company_code',
      key: 'company_code',
      width: 100,
      render: (code) => code ? (
        <Tag color="purple" style={{ fontWeight: 'bold' }}>
          {code}
        </Tag>
      ) : (
        <span style={{ color: '#ccc' }}>-</span>
      ),
    },
    {
      title: 'Contact',
      dataIndex: 'phone',
      key: 'phone',
      width: 150,
      render: (phone) => phone ? (
        <Tag icon={<PhoneOutlined />} color="blue">
          {phone}
        </Tag>
      ) : (
        <span style={{ color: '#ccc' }}>-</span>
      ),
    },
    {
      title: 'Compliance',
      key: 'compliance',
      width: 150,
      render: (_, record: any) => {
        const licenses = record.licenses || [];
        const insurancePolicies = record.insurance_policies || [];
        
        // Count active licenses
        const activeLicenses = licenses.filter((l: any) => {
          const expirationDate = new Date(l.expiration_date);
          return l.status === 'active' && expirationDate > new Date();
        }).length;
        
        // Count active insurance policies
        const activeInsurance = insurancePolicies.filter((p: any) => {
          const expirationDate = new Date(p.expiration_date);
          const effectiveDate = new Date(p.effective_date);
          const now = new Date();
          return p.status === 'active' && effectiveDate <= now && expirationDate > now;
        }).length;
        
        // Check for expiring licenses/insurance (within 30 days)
        const hasExpiring = [...licenses, ...insurancePolicies].some((item: any) => {
          const expirationDate = new Date(item.expiration_date);
          const daysUntilExpiration = Math.floor((expirationDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
          return daysUntilExpiration >= 0 && daysUntilExpiration <= 30;
        });
        
        return (
          <Space>
            <Tooltip title={`${activeLicenses} active license(s)`}>
              <Badge count={activeLicenses} showZero color={activeLicenses > 0 ? '#52c41a' : '#d9d9d9'}>
                <FileTextOutlined style={{ fontSize: 16 }} />
              </Badge>
            </Tooltip>
            <Tooltip title={`${activeInsurance} active insurance polic${activeInsurance === 1 ? 'y' : 'ies'}`}>
              <Badge count={activeInsurance} showZero color={activeInsurance > 0 ? '#52c41a' : '#d9d9d9'}>
                <SafetyOutlined style={{ fontSize: 16 }} />
              </Badge>
            </Tooltip>
            {hasExpiring && (
              <Tooltip title="Has expiring documents">
                <WarningOutlined style={{ color: '#faad14', fontSize: 16 }} />
              </Tooltip>
            )}
          </Space>
        );
      },
    },
    {
      title: 'Address',
      dataIndex: 'address',
      key: 'address',
      render: (address, record) => (
        <div>
          <div style={{ marginBottom: 4 }}>
            <EnvironmentOutlined style={{ marginRight: 4, color: '#666' }} />
            {address}
          </div>
          <div style={{ fontSize: '12px', color: '#666' }}>
            {record.city}, {record.state} {record.zipcode}
          </div>
        </div>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 120,
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="Edit">
            <Button
              type="text"
              icon={<EditOutlined />}
              onClick={() => onEdit(record)}
              size="small"
            />
          </Tooltip>
          <Tooltip title="Delete">
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDelete(record)}
              loading={deleteLoading === record.id}
              size="small"
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  const filteredCompanies = companies.filter((company) => {
    const searchTerm = filter.search?.toLowerCase() || '';
    const cityFilter = filter.city?.toLowerCase() || '';
    const stateFilter = filter.state?.toLowerCase() || '';

    const matchesSearch = !searchTerm || 
      company.name.toLowerCase().includes(searchTerm) ||
      company.address?.toLowerCase().includes(searchTerm) ||
      company.email?.toLowerCase().includes(searchTerm) ||
      company.phone?.toLowerCase().includes(searchTerm);

    const matchesCity = !cityFilter || 
      company.city.toLowerCase().includes(cityFilter);

    const matchesState = !stateFilter || 
      company.state.toLowerCase().includes(stateFilter);

    return matchesSearch && matchesCity && matchesState;
  });

  return (
    <Card
      title={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Registered Companies</span>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={onAdd}
          >
            Register New Company
          </Button>
        </div>
      }
      style={{ marginBottom: 24 }}
    >
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24}>
          <Search
            placeholder="Search by company name, address, email, phone"
            value={filter.search}
            onChange={(e) => onFilterChange({ ...filter, search: e.target.value })}
            onSearch={(value) => onFilterChange({ ...filter, search: value })}
            enterButton={<SearchOutlined />}
            allowClear
            style={{ maxWidth: 500 }}
          />
        </Col>
      </Row>

      <Table
        columns={columns}
        dataSource={filteredCompanies}
        rowKey="id"
        loading={loading}
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          showQuickJumper: true,
          showTotal: (total, range) =>
            `${range[0]}-${range[1]} of ${total} total`,
        }}
        scroll={{ x: 800 }}
        size="middle"
      />
    </Card>
  );
};

export default CompanyTable;