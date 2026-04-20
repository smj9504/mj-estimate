import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  Select,
  message,
  Popconfirm,
  Typography,
  Row,
  Col,
  Divider,
  Checkbox,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
  UserOutlined,
  MinusCircleOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { clientService } from '../services/clientService';
import type { Client, ClientCreate, ClientListItem, OwnerInfo } from '../types/client';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';

// Simple debounce hook (no extra dependency)
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(value), delay);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [value, delay]);
  return debounced;
}

const { Title, Text } = Typography;
const { Option } = Select;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
];

const formatDate = (dateStr?: string) =>
  dateStr ? dayjs(dateStr).format('MM/DD/YYYY') : '—';

const primaryOwner = (owners: OwnerInfo[]) =>
  owners.find((o) => o.is_primary) ?? owners[0];

// ─────────────────────────────────────────────
// Client Form Modal (Add / Edit)
// ─────────────────────────────────────────────

interface ClientFormModalProps {
  open: boolean;
  initialValues?: Client | null;
  onCancel: () => void;
  onSubmit: (values: ClientCreate) => Promise<void>;
  loading: boolean;
}

const ClientFormModal: React.FC<ClientFormModalProps> = ({
  open,
  initialValues,
  onCancel,
  onSubmit,
  loading,
}) => {
  const [form] = Form.useForm<ClientCreate>();

  // Populate form when editing
  React.useEffect(() => {
    if (open) {
      if (initialValues) {
        form.setFieldsValue({
          display_name: initialValues.display_name,
          owners: initialValues.owners.length > 0 ? initialValues.owners : [{ name: '', is_primary: true }],
          address: initialValues.address,
          city: initialValues.city,
          state: initialValues.state,
          zipcode: initialValues.zipcode,
          phone: initialValues.phone,
          email: initialValues.email,
          insurance_company: initialValues.insurance_company,
          insurance_policy_number: initialValues.insurance_policy_number,
          notes: initialValues.notes,
        });
      } else {
        form.resetFields();
        form.setFieldsValue({ owners: [{ name: '', is_primary: true }] });
      }
    }
  }, [open, initialValues, form]);

  const handleFinish = async (values: ClientCreate) => {
    // Ensure exactly one owner is marked primary; default to first if none
    const owners = values.owners ?? [];
    const hasPrimary = owners.some((o) => o.is_primary);
    if (!hasPrimary && owners.length > 0) {
      owners[0].is_primary = true;
    }
    await onSubmit({ ...values, owners });
  };

  return (
    <Modal
      title={
        <Space>
          <UserOutlined />
          {initialValues ? 'Edit Client' : 'Add New Client'}
        </Space>
      }
      open={open}
      onCancel={onCancel}
      footer={null}
      width={760}
      destroyOnHidden
      maskClosable={false}
    >
      <Divider style={{ margin: '16px 0 24px' }} />
      <Form
        form={form}
        layout="vertical"
        onFinish={handleFinish}
        scrollToFirstError
      >
        {/* Display Name */}
        <Form.Item
          name="display_name"
          label="Display Name"
          rules={[{ required: true, message: 'Display name is required' }]}
        >
          <Input placeholder="e.g. Smith Residence" />
        </Form.Item>

        {/* Owners */}
        <Divider orientation="left" plain style={{ marginBottom: 8 }}>
          Owners
        </Divider>
        <Form.List
          name="owners"
          rules={[
            {
              validator: async (_, owners) => {
                if (!owners || owners.length < 1) {
                  return Promise.reject(new Error('At least one owner is required'));
                }
              },
            },
          ]}
        >
          {(fields, { add, remove }, { errors }) => (
            <>
              {fields.map(({ key, name, ...restField }) => (
                <Card
                  key={key}
                  size="small"
                  style={{ marginBottom: 12, background: '#fafafa' }}
                  extra={
                    fields.length > 1 ? (
                      <MinusCircleOutlined
                        style={{ color: '#ff4d4f', cursor: 'pointer' }}
                        onClick={() => remove(name)}
                      />
                    ) : null
                  }
                >
                  <Row gutter={12}>
                    <Col xs={24} sm={10}>
                      <Form.Item
                        {...restField}
                        name={[name, 'name']}
                        label="Name"
                        rules={[{ required: true, message: 'Owner name is required' }]}
                        style={{ marginBottom: 8 }}
                      >
                        <Input placeholder="Full name" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={7}>
                      <Form.Item
                        {...restField}
                        name={[name, 'phone']}
                        label="Phone"
                        style={{ marginBottom: 8 }}
                      >
                        <Input placeholder="555-000-0000" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={7}>
                      <Form.Item
                        {...restField}
                        name={[name, 'email']}
                        label="Email"
                        rules={[{ type: 'email', message: 'Invalid email' }]}
                        style={{ marginBottom: 8 }}
                      >
                        <Input placeholder="email@example.com" />
                      </Form.Item>
                    </Col>
                    <Col xs={24}>
                      <Form.Item
                        {...restField}
                        name={[name, 'is_primary']}
                        valuePropName="checked"
                        style={{ marginBottom: 0 }}
                      >
                        <Checkbox>Primary contact</Checkbox>
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>
              ))}
              <Form.Item>
                <Button
                  type="dashed"
                  onClick={() => add({ name: '', is_primary: false })}
                  icon={<PlusOutlined />}
                  block
                >
                  Add Owner
                </Button>
                <Form.ErrorList errors={errors} />
              </Form.Item>
            </>
          )}
        </Form.List>

        {/* Address */}
        <Divider orientation="left" plain style={{ marginBottom: 8 }}>
          Address
        </Divider>
        <Form.Item name="address" label="Street Address">
          <Input placeholder="123 Main St" />
        </Form.Item>
        <Row gutter={12}>
          <Col xs={24} sm={10}>
            <Form.Item name="city" label="City">
              <Input placeholder="City" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={7}>
            <Form.Item name="state" label="State">
              <Select showSearch placeholder="State" allowClear>
                {US_STATES.map((s) => (
                  <Option key={s} value={s}>{s}</Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
          <Col xs={24} sm={7}>
            <Form.Item name="zipcode" label="Zipcode">
              <Input placeholder="00000" />
            </Form.Item>
          </Col>
        </Row>

        {/* Contact */}
        <Divider orientation="left" plain style={{ marginBottom: 8 }}>
          Contact
        </Divider>
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item name="phone" label="Phone">
              <Input placeholder="555-000-0000" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              name="email"
              label="Email"
              rules={[{ type: 'email', message: 'Invalid email' }]}
            >
              <Input placeholder="email@example.com" />
            </Form.Item>
          </Col>
        </Row>

        {/* Insurance */}
        <Divider orientation="left" plain style={{ marginBottom: 8 }}>
          Insurance
        </Divider>
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item name="insurance_company" label="Insurance Company">
              <Input placeholder="e.g. Allstate" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="insurance_policy_number" label="Policy Number">
              <Input placeholder="Policy #" />
            </Form.Item>
          </Col>
        </Row>

        {/* Notes */}
        <Form.Item name="notes" label="Notes">
          <Input.TextArea rows={3} placeholder="Any additional notes..." />
        </Form.Item>

        {/* Actions */}
        <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
          <Space>
            <Button onClick={onCancel}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={loading}>
              {initialValues ? 'Save Changes' : 'Create Client'}
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  );
};

// ─────────────────────────────────────────────
// ClientList Page
// ─────────────────────────────────────────────

const ClientList: React.FC = () => {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 350);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);

  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // ── Data fetching ──────────────────────────
  const {
    data,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['clients', debouncedSearch],
    queryFn: () =>
      clientService.list({ search: debouncedSearch || undefined, limit: 200 }),
  });

  const clients: ClientListItem[] = data?.clients ?? [];

  // ── Mutations ──────────────────────────────
  const createMutation = useMutation({
    mutationFn: (payload: ClientCreate) => clientService.create(payload),
    onSuccess: () => {
      message.success('Client created successfully.');
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      setModalOpen(false);
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || err.message || 'Failed to create client.');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<ClientCreate> }) =>
      clientService.update(id, payload),
    onSuccess: () => {
      message.success('Client updated successfully.');
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      setModalOpen(false);
      setEditingClient(null);
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || err.message || 'Failed to update client.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => clientService.delete(id),
    onSuccess: () => {
      message.success('Client deleted.');
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || err.message || 'Failed to delete client.');
    },
  });

  // ── Handlers ───────────────────────────────
  const handleAdd = () => {
    setEditingClient(null);
    setModalOpen(true);
  };

  const handleEdit = (client: ClientListItem, e: React.MouseEvent) => {
    e.stopPropagation();
    // Fetch full client data for the edit form
    clientService.getById(client.id).then((full) => {
      setEditingClient(full);
      setModalOpen(true);
    });
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteMutation.mutateAsync(id);
  };

  const handleSubmit = async (values: ClientCreate) => {
    if (editingClient) {
      await updateMutation.mutateAsync({ id: editingClient.id, payload: values });
    } else {
      await createMutation.mutateAsync(values);
    }
  };

  // ── Table columns ──────────────────────────
  const columns: ColumnsType<ClientListItem> = [
    {
      title: 'Display Name',
      dataIndex: 'display_name',
      key: 'display_name',
      render: (name: string, record) => {
        const owner = primaryOwner(record.owners);
        return (
          <div>
            <div style={{ fontWeight: 600 }}>{name}</div>
            {owner && owner.name !== name && (
              <Text type="secondary" style={{ fontSize: 12 }}>{owner.name}</Text>
            )}
          </div>
        );
      },
    },
    {
      title: 'Phone',
      key: 'phone',
      render: (_: any, record) => {
        const owner = primaryOwner(record.owners);
        return record.phone || owner?.phone || '—';
      },
      responsive: ['md'],
    },
    {
      title: 'Email',
      key: 'email',
      render: (_: any, record) => {
        const owner = primaryOwner(record.owners);
        return record.email || owner?.email || '—';
      },
      responsive: ['lg'],
    },
    {
      title: 'Insurance Company',
      dataIndex: 'insurance_company',
      key: 'insurance_company',
      render: (val?: string) => val || '—',
      responsive: ['lg'],
    },
    {
      title: 'Claims',
      dataIndex: 'claim_count',
      key: 'claim_count',
      align: 'center',
      width: 80,
      render: (count: number) => (
        <Tag color={count > 0 ? 'blue' : 'default'}>{count}</Tag>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 100,
      render: (active: boolean) =>
        active ? (
          <Tag color="success">Active</Tag>
        ) : (
          <Tag color="default">Inactive</Tag>
        ),
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 120,
      render: formatDate,
      responsive: ['xl'],
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      align: 'center',
      render: (_: any, record) => (
        <Space size="small" onClick={(e) => e.stopPropagation()}>
          <Button
            type="text"
            icon={<EditOutlined />}
            size="small"
            onClick={(e) => handleEdit(record, e)}
          />
          <Popconfirm
            title="Delete this client?"
            description="This action cannot be undone."
            onConfirm={(e) => handleDelete(record.id, e as React.MouseEvent)}
            okText="Delete"
            okButtonProps={{ danger: true }}
            cancelText="Cancel"
          >
            <Button
              type="text"
              icon={<DeleteOutlined />}
              size="small"
              danger
              onClick={(e) => e.stopPropagation()}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // ── Render ─────────────────────────────────
  if (error) {
    return (
      <Card>
        <Text type="danger">Failed to load clients. Please try again.</Text>
      </Card>
    );
  }

  return (
    <div>
      {/* Header */}
      <Card style={{ marginBottom: 24 }}>
        <Row align="middle" justify="space-between" wrap gutter={[16, 12]}>
          <Col>
            <Space align="center">
              <UserOutlined style={{ fontSize: 24, color: '#1890ff' }} />
              <div>
                <Title level={2} style={{ margin: 0 }}>
                  Clients
                </Title>
                <Text type="secondary">Manage client profiles and insurance claims</Text>
              </div>
            </Space>
          </Col>
          <Col>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
              Add Client
            </Button>
          </Col>
        </Row>
      </Card>

      {/* Filters */}
      <Card style={{ marginBottom: 16 }}>
        <Input
          prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
          placeholder="Search by name, phone, email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
          style={{ maxWidth: 400 }}
        />
      </Card>

      {/* Table */}
      <Card>
        <Table<ClientListItem>
          rowKey="id"
          columns={columns}
          dataSource={clients}
          loading={isLoading}
          onRow={(record) => ({
            onClick: () => navigate(`/clients/${record.id}`),
            style: { cursor: 'pointer' },
          })}
          pagination={{
            pageSize: 25,
            showSizeChanger: true,
            showTotal: (total) => `${total} clients`,
          }}
          scroll={{ x: 700 }}
        />
      </Card>

      {/* Add / Edit Modal */}
      <ClientFormModal
        open={modalOpen}
        initialValues={editingClient}
        onCancel={() => {
          setModalOpen(false);
          setEditingClient(null);
        }}
        onSubmit={handleSubmit}
        loading={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
};

export default ClientList;
