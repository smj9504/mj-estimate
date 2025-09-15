import React, { useEffect } from 'react';
import { Card, Row, Col, Statistic, Button, Space, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import {
  FileTextOutlined,
  DollarOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { documentService } from '../services/documentService';
import { companyService } from '../services/companyService';
import { useStore } from '../store/useStore';

const { Title } = Typography;

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { setCompanies, companies } = useStore();

  // Fetch companies
  const { data: companiesData } = useQuery({
    queryKey: ['companies'],
    queryFn: () => companyService.getCompanies(),
  });

  // Update companies in store when data changes
  useEffect(() => {
    if (companiesData) {
      setCompanies(companiesData);
    }
  }, [companiesData, setCompanies]);

  // Fetch recent documents
  const { data: documentsData } = useQuery({
    queryKey: ['recent-documents'],
    queryFn: () => documentService.getDocuments({}, 1, 5),
  });

  const statistics = {
    totalDocuments: documentsData?.total || 0,
    totalRevenue: documentsData?.items?.reduce((sum, doc) => sum + doc.total_amount, 0) || 0,  // Changed data to items
    totalCompanies: companies.length,
    pendingDocuments: documentsData?.items?.filter(doc => doc.status === 'draft').length || 0,  // Changed data to items
  };

  const quickActions = [
    {
      title: 'Create Estimate',
      icon: <FileTextOutlined />,
      color: '#1890ff',
      onClick: () => navigate('/create/estimate'),
    },
    {
      title: 'Create Invoice',
      icon: <DollarOutlined />,
      color: '#52c41a',
      onClick: () => navigate('/create/invoice'),
    },
    {
      title: 'Create Insurance Estimate',
      icon: <FileTextOutlined />,
      color: '#722ed1',
      onClick: () => navigate('/create/insurance'),
    },
    {
      title: 'Add Company',
      icon: <TeamOutlined />,
      color: '#fa8c16',
      onClick: () => navigate('/companies/new'),
    },
  ];

  return (
    <div>
      <Title level={2}>Dashboard</Title>
      
      {/* Statistics Cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Total Documents"
              value={statistics.totalDocuments}
              prefix={<FileTextOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Total Revenue"
              value={statistics.totalRevenue}
              prefix="$"
              precision={0}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Registered Companies"
              value={statistics.totalCompanies}
              prefix={<TeamOutlined />}
              valueStyle={{ color: '#722ed1' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Pending Documents"
              value={statistics.pendingDocuments}
              valueStyle={{ color: '#fa8c16' }}
            />
          </Card>
        </Col>
      </Row>

      {/* Quick Actions */}
      <Card title="Quick Actions" style={{ marginBottom: 24 }}>
        <Row gutter={[16, 16]}>
          {quickActions.map((action, index) => (
            <Col xs={24} sm={12} lg={6} key={index}>
              <Button
                type="default"
                icon={action.icon}
                size="large"
                block
                onClick={action.onClick}
                style={{ 
                  height: 80,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderColor: action.color,
                  color: action.color,
                }}
              >
                <span style={{ marginTop: 8 }}>{action.title}</span>
              </Button>
            </Col>
          ))}
        </Row>
      </Card>

      {/* Recent Documents */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card 
            title="Recent Estimates" 
            extra={<Button type="link" onClick={() => navigate('/documents/estimate')}>View All</Button>}
          >
            {documentsData?.items?.filter(doc => doc.type === 'estimate').slice(0, 3).map(doc => (
              <Card.Grid key={doc.id} style={{ width: '100%', cursor: 'pointer' }} onClick={() => navigate(`/documents/${doc.id}`)}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                    <span>{doc.document_number}</span>
                    <span>${(doc.total_amount || 0).toLocaleString()}</span>
                  </Space>
                  <span style={{ color: '#999', fontSize: '12px' }}>{doc.client_name}</span>
                </Space>
              </Card.Grid>
            ))}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card 
            title="Recent Invoices"
            extra={<Button type="link" onClick={() => navigate('/documents/invoice')}>View All</Button>}
          >
            {documentsData?.items?.filter(doc => doc.type === 'invoice').slice(0, 3).map(doc => (
              <Card.Grid key={doc.id} style={{ width: '100%', cursor: 'pointer' }} onClick={() => navigate(`/documents/${doc.id}`)}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                    <span>{doc.document_number}</span>
                    <span>${(doc.total_amount || 0).toLocaleString()}</span>
                  </Space>
                  <span style={{ color: '#999', fontSize: '12px' }}>{doc.client_name}</span>
                </Space>
              </Card.Grid>
            ))}
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default Dashboard;