import React, { useEffect, useState } from 'react';
import {
  Card, Row, Col, Statistic, Button, Space, Typography, Alert,
  List, Checkbox, Tag, Tooltip, Empty, Badge,
} from 'antd';
import { useNavigate } from 'react-router-dom';
import {
  FileTextOutlined,
  DollarOutlined,
  TeamOutlined,
  CheckSquareOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { documentService } from '../services/documentService';
import { companyService } from '../services/companyService';
import { supplementService } from '../services/supplementService';
import { claimTodoService } from '../services/clientService';
import { useStore } from '../store/useStore';
import type { ClaimTodoDashboard, TodoPriority } from '../types/client';
import { TODO_PRIORITY_COLORS } from '../types/client';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

const { Title } = Typography;

const { Text } = Typography;

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setCompanies, companies } = useStore();
  const [showCompletedTodos, setShowCompletedTodos] = useState(false);

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

  const { data: pendingSupplements = [] } = useQuery({
    queryKey: ['supplements-pending-review'],
    queryFn: () => supplementService.getPendingReview(),
  });

  // Active Todos
  const { data: activeTodos = [], isLoading: todosLoading } = useQuery({
    queryKey: ['active-todos', showCompletedTodos],
    queryFn: () => claimTodoService.getActiveTodos(showCompletedTodos),
  });

  const toggleTodoMutation = useMutation({
    mutationFn: ({ todo, completed }: { todo: ClaimTodoDashboard; completed: boolean }) =>
      claimTodoService.update(todo.client_id!, todo.claim_id, todo.id, { is_completed: completed }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['active-todos'] });
    },
  });

  const uncompletedCount = activeTodos.filter((t) => !t.is_completed).length;

  return (
    <div>
      <Title level={2}>Dashboard</Title>

      {pendingSupplements.length > 0 && (
        <Alert
          type="warning"
          showIcon
          closable
          style={{ marginBottom: 16 }}
          message={`${pendingSupplements.length} insurance estimate${pendingSupplements.length > 1 ? 's' : ''} pending review`}
          action={
            <Button size="small" type="primary" onClick={() => navigate('/supplements')}>
              Review Now
            </Button>
          }
        />
      )}

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

      {/* Active Todos */}
      {(activeTodos.length > 0 || todosLoading) && (
        <Card
          title={
            <Space>
              <CheckSquareOutlined />
              <span>Active Todos</span>
              {uncompletedCount > 0 && <Badge count={uncompletedCount} style={{ backgroundColor: '#fa8c16' }} />}
            </Space>
          }
          extra={
            <Button
              type="link"
              size="small"
              onClick={() => setShowCompletedTodos(!showCompletedTodos)}
            >
              {showCompletedTodos ? 'Hide completed' : 'Show completed'}
            </Button>
          }
          style={{ marginBottom: 24 }}
          loading={todosLoading}
        >
          <List
            dataSource={activeTodos}
            locale={{ emptyText: <Empty description="All caught up!" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            renderItem={(todo: ClaimTodoDashboard) => {
              const isOverdue = todo.due_date && !todo.is_completed && dayjs(todo.due_date).isBefore(dayjs(), 'day');
              return (
                <List.Item
                  style={{
                    padding: '8px 0',
                    opacity: todo.is_completed ? 0.5 : 1,
                  }}
                  actions={[
                    <Button
                      key="go"
                      type="link"
                      size="small"
                      onClick={() => navigate(`/clients/${todo.client_id}`)}
                    >
                      View
                    </Button>,
                  ]}
                >
                  <Space align="start">
                    <Checkbox
                      checked={todo.is_completed}
                      onChange={() => toggleTodoMutation.mutate({ todo, completed: !todo.is_completed })}
                    />
                    <div>
                      <div style={{ textDecoration: todo.is_completed ? 'line-through' : undefined }}>
                        <Text strong={!todo.is_completed}>{todo.title}</Text>
                      </div>
                      <Space size={4} wrap>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {todo.client_name} - {todo.claim_number}
                        </Text>
                        <Tag color={TODO_PRIORITY_COLORS[todo.priority as TodoPriority]} style={{ fontSize: 11, lineHeight: '16px' }}>
                          {todo.priority}
                        </Tag>
                        {todo.due_date && (
                          <Tooltip title={dayjs(todo.due_date).format('YYYY-MM-DD')}>
                            <Tag color={isOverdue ? 'red' : undefined} style={{ fontSize: 11, lineHeight: '16px' }}>
                              {isOverdue ? 'Overdue: ' : 'Due: '}
                              {dayjs(todo.due_date).format('MM/DD')}
                            </Tag>
                          </Tooltip>
                        )}
                      </Space>
                    </div>
                  </Space>
                </List.Item>
              );
            }}
          />
        </Card>
      )}

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
                  <span style={{ color: '#8c8c8c', fontSize: '12px' }}>{doc.client_name}</span>
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
                  <span style={{ color: '#8c8c8c', fontSize: '12px' }}>{doc.client_name}</span>
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