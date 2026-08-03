import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Modal,
  message,
  Spin,
  Alert,
  Typography,
  Divider,
  Table,
  Button,
  Form,
  Input,
  Space,
  Switch,
  Tooltip,
  Tag,
} from 'antd';
import {
  TeamOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
  StarFilled,
  LinkOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { Company, CompanyFormData, CompanyFilter, CompanyContact } from '../types';
import { companyService } from '../services/companyService';
import { contractorPortalService } from '../services/contractorPortalService';
import CompanyTable from '../components/company/CompanyTable';
import CompanyForm from '../components/company/CompanyForm';

const { Title } = Typography;

const { confirm } = Modal;

const CompanyManagement: React.FC = () => {
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [formModalVisible, setFormModalVisible] = useState(false);
  const [filter, setFilter] = useState<CompanyFilter>({});

  // Contacts modal state
  const [contactsCompany, setContactsCompany] = useState<Company | null>(null);
  const [contactsModalVisible, setContactsModalVisible] = useState(false);
  const [contactForm] = Form.useForm();
  const [editingContact, setEditingContact] = useState<CompanyContact | null>(null);
  const [contactFormVisible, setContactFormVisible] = useState(false);
  const [contactFormLoading, setContactFormLoading] = useState(false);

  const queryClient = useQueryClient();

  // Fetch companies with filters
  const {
    data: companies = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['companies', filter],
    queryFn: () => companyService.getCompanies(filter.search, filter.city, filter.state),
  });

  // Create company mutation
  const createMutation = useMutation({
    mutationFn: companyService.createCompany,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      setFormModalVisible(false);
      setSelectedCompany(null);
    },
    onError: (error: any) => {
      message.error(error.message || 'Failed to register company.');
    },
  });

  // Update company mutation
  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; company: Partial<Company> }) => {
      console.log('Updating company:', data);
      return companyService.updateCompany(data.id, data.company);
    },
    onSuccess: () => {
      message.success('Company information updated successfully.');
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      setFormModalVisible(false);
      setSelectedCompany(null);
    },
    onError: (error: any) => {
      console.error('Update error:', error);
      const errorMessage = error.response?.data?.detail || error.message || 'Failed to update company information.';
      message.error(errorMessage);
    },
  });

  // Delete company mutation
  const deleteMutation = useMutation({
    mutationFn: companyService.deleteCompany,
    onSuccess: () => {
      message.success('Company deleted successfully.');
      queryClient.invalidateQueries({ queryKey: ['companies'] });
    },
    onError: (error: any) => {
      console.error('Delete error:', error);
      message.error(error.message || 'Failed to delete company.');
    },
  });

  // Contacts query
  const { data: contacts = [], isLoading: contactsLoading } = useQuery({
    queryKey: ['contacts', contactsCompany?.id],
    queryFn: () => companyService.listContacts(contactsCompany!.id),
    enabled: !!contactsCompany,
  });

  const handleManageContacts = (company: Company) => {
    setContactsCompany(company);
    setContactsModalVisible(true);
  };

  const handleCloseContacts = () => {
    setContactsModalVisible(false);
    setContactsCompany(null);
    setContactFormVisible(false);
    setEditingContact(null);
    contactForm.resetFields();
  };

  const handleAddContact = () => {
    setEditingContact(null);
    contactForm.resetFields();
    contactForm.setFieldsValue({ is_primary: false, is_active: true });
    setContactFormVisible(true);
  };

  const handleEditContact = (contact: CompanyContact) => {
    setEditingContact(contact);
    contactForm.setFieldsValue({
      name: contact.name,
      title: contact.title,
      email: contact.email,
      phone: contact.phone,
      is_primary: contact.is_primary,
      is_active: contact.is_active,
      notes: contact.notes,
    });
    setContactFormVisible(true);
  };

  const handleDeleteContact = (contact: CompanyContact) => {
    confirm({
      title: 'Delete Contact',
      icon: <ExclamationCircleOutlined />,
      content: `Are you sure you want to delete contact "${contact.name}"?`,
      okText: 'Delete',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          await companyService.deleteContact(contactsCompany!.id, contact.id);
          queryClient.invalidateQueries({ queryKey: ['contacts', contactsCompany!.id] });
          message.success('Contact deleted.');
        } catch {
          message.error('Failed to delete contact.');
        }
      },
    });
  };

  const handleContactFormSubmit = async () => {
    try {
      const values = await contactForm.validateFields();
      setContactFormLoading(true);
      if (editingContact) {
        await companyService.updateContact(contactsCompany!.id, editingContact.id, values);
        message.success('Contact updated.');
      } else {
        await companyService.createContact(contactsCompany!.id, values);
        message.success('Contact added.');
      }
      queryClient.invalidateQueries({ queryKey: ['contacts', contactsCompany!.id] });
      setContactFormVisible(false);
      setEditingContact(null);
      contactForm.resetFields();
    } catch (err: any) {
      if (err?.errorFields) return; // validation error, don't show message
      message.error('Failed to save contact.');
    } finally {
      setContactFormLoading(false);
    }
  };

  const contactColumns: ColumnsType<CompanyContact> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name, record) => (
        <Space>
          {record.is_primary && <StarFilled style={{ color: '#faad14', fontSize: 12 }} />}
          <span style={{ fontWeight: record.is_primary ? 'bold' : 'normal' }}>{name}</span>
          {!record.is_active && <Tag color="default">Inactive</Tag>}
        </Space>
      ),
    },
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
      render: (v) => v || <span style={{ color: '#8c8c8c' }}>-</span>,
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
      render: (v) => v || <span style={{ color: '#8c8c8c' }}>-</span>,
    },
    {
      title: 'Phone',
      dataIndex: 'phone',
      key: 'phone',
      render: (v) => v || <span style={{ color: '#8c8c8c' }}>-</span>,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 130,
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="Generate Portal Link">
            <Button type="text" icon={<LinkOutlined />} size="small" onClick={async () => {
              try {
                const result = await contractorPortalService.createToken(record.id);
                const portalUrl = `${window.location.origin}/contractor-portal/${result.token}`;
                await navigator.clipboard.writeText(portalUrl);
                message.success('Portal link copied to clipboard!');
              } catch {
                message.error('Failed to generate portal link');
              }
            }} />
          </Tooltip>
          <Tooltip title="Edit">
            <Button type="text" icon={<EditOutlined />} size="small" onClick={() => handleEditContact(record)} />
          </Tooltip>
          <Tooltip title="Delete">
            <Button type="text" danger icon={<DeleteOutlined />} size="small" onClick={() => handleDeleteContact(record)} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  const handleAdd = () => {
    setSelectedCompany(null);
    setFormModalVisible(true);
  };

  const handleEdit = (company: Company) => {
    setSelectedCompany(company);
    setFormModalVisible(true);
  };

  const handleDelete = async (id: string) => {
    await deleteMutation.mutateAsync(id);
  };

  const handleSubmit = async (data: CompanyFormData) => {
    if (selectedCompany) {
      // Update existing company
      await updateMutation.mutateAsync({
        id: selectedCompany.id,
        company: data,
      });
    } else {
      // Create new company
      await createMutation.mutateAsync(data);
    }
  };

  const handleCancel = () => {
    setFormModalVisible(false);
    setSelectedCompany(null);
  };

  const isFormLoading = createMutation.isPending || updateMutation.isPending;

  if (error) {
    return (
      <Alert
        message="Error"
        description="Failed to load company information."
        type="error"
        showIcon
        style={{ margin: '24px 0' }}
      />
    );
  }

  return (
    <div>
      {/* Header */}
      <Card style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <TeamOutlined style={{ fontSize: 24, marginRight: 12, color: '#1890ff' }} />
          <Title level={2} style={{ margin: 0 }}>
            Company Management
          </Title>
        </div>
        <p style={{ margin: 0, color: '#666' }}>
          Manage company information for estimates and invoices.
        </p>
      </Card>

      <Divider />

      {/* Companies Table */}
      <Spin spinning={isLoading}>
        <CompanyTable
          companies={companies}
          loading={isLoading}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onAdd={handleAdd}
          onManageContacts={handleManageContacts}
          filter={filter}
          onFilterChange={setFilter}
        />
      </Spin>

      {/* Company Form Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {selectedCompany ? (
              <>
                <TeamOutlined style={{ marginRight: 8 }} />
                Edit Company
              </>
            ) : (
              <>
                <PlusOutlined style={{ marginRight: 8 }} />
                Register New Company
              </>
            )}
          </div>
        }
        open={formModalVisible}
        onCancel={handleCancel}
        footer={null}
        width={800}
        destroyOnHidden
        maskClosable={false}
      >
        <Divider style={{ margin: '16px 0 24px 0' }} />
        <CompanyForm
          initialData={selectedCompany || undefined}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          loading={isFormLoading}
        />
      </Modal>

      {/* Contacts Management Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>
              <TeamOutlined style={{ marginRight: 8 }} />
              Contacts — {contactsCompany?.name}
            </span>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              size="small"
              onClick={handleAddContact}
              style={{ marginRight: 32 }}
            >
              Add Contact
            </Button>
          </div>
        }
        open={contactsModalVisible}
        onCancel={handleCloseContacts}
        footer={null}
        width={700}
        destroyOnHidden
      >
        <Table
          columns={contactColumns}
          dataSource={contacts}
          rowKey="id"
          loading={contactsLoading}
          size="small"
          pagination={false}
          style={{ marginBottom: contactFormVisible ? 16 : 0 }}
        />

        {contactFormVisible && (
          <>
            <Divider style={{ margin: '16px 0' }} />
            <div style={{ background: '#fafafa', padding: 16, borderRadius: 8, border: '1px solid #f0f0f0' }}>
              <div style={{ fontWeight: 'bold', marginBottom: 12 }}>
                {editingContact ? 'Edit Contact' : 'New Contact'}
              </div>
              <Form form={contactForm} layout="vertical" size="small">
                <Space style={{ width: '100%' }} direction="vertical" size={0}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                    <Form.Item name="name" label="Name" rules={[{ required: true, message: 'Name is required' }]}>
                      <Input placeholder="Full name" />
                    </Form.Item>
                    <Form.Item name="title" label="Title">
                      <Input placeholder="e.g. Senior Adjuster" />
                    </Form.Item>
                    <Form.Item name="email" label="Email" rules={[{ type: 'email', message: 'Invalid email' }]}>
                      <Input placeholder="email@example.com" />
                    </Form.Item>
                    <Form.Item name="phone" label="Phone">
                      <Input placeholder="Phone number" />
                    </Form.Item>
                  </div>
                  <div style={{ display: 'flex', gap: 24, alignItems: 'center', marginBottom: 8 }}>
                    <Form.Item name="is_primary" valuePropName="checked" label="Primary Contact" style={{ margin: 0 }}>
                      <Switch size="small" />
                    </Form.Item>
                    <Form.Item name="is_active" valuePropName="checked" label="Active" style={{ margin: 0 }}>
                      <Switch size="small" />
                    </Form.Item>
                  </div>
                  <Form.Item name="notes" label="Notes">
                    <Input.TextArea rows={2} placeholder="Optional notes" />
                  </Form.Item>
                </Space>
              </Form>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <Button size="small" onClick={() => { setContactFormVisible(false); setEditingContact(null); contactForm.resetFields(); }}>
                  Cancel
                </Button>
                <Button type="primary" size="small" loading={contactFormLoading} onClick={handleContactFormSubmit}>
                  {editingContact ? 'Update' : 'Add'}
                </Button>
              </div>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
};

export default CompanyManagement;