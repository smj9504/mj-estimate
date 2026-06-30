/**
 * ContractTemplateManagement - Admin page for managing contract PDF templates per company.
 *
 * Usage (in App.tsx):
 *   const ContractTemplateManagement = lazy(() => import('./pages/ContractTemplateManagement'));
 *   <Route path="/admin/contract-templates" element={<ProtectedRoute><Layout><Suspense fallback={<PageLoader />}><ContractTemplateManagement /></Suspense></Layout></ProtectedRoute>} />
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { UploadFile } from 'antd/es/upload/interface';
import {
  DeleteOutlined,
  EditOutlined,
  FileAddOutlined,
  FilePdfOutlined,
  FormOutlined,
  PlusOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { contractTemplateService } from '../services/contractService';
import { companyService } from '../services/companyService';
import type { ContractTemplate, DocumentType } from '../types/contract';

const FieldMappingEditor = React.lazy(() => import('../components/contract/FieldMappingEditor'));

const { Title, Text } = Typography;
const { Option } = Select;
const { TextArea } = Input;

// ── Constants ────────────────────────────────────────────────────────────────

const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  authorization: 'Authorization to Work',
  certificate_of_satisfaction: 'Certificate of Satisfaction (WM)',
  certificate_of_completion: 'Certificate of Completion (Recon)',
  scope_of_work: 'Scope of Work',
  lien_waiver: 'Lien Waiver',
  change_order: 'Change Order',
  other: 'Other',
};

const DOCUMENT_TYPE_COLORS: Record<DocumentType, string> = {
  authorization: 'blue',
  certificate_of_satisfaction: 'green',
  certificate_of_completion: 'cyan',
  scope_of_work: 'purple',
  lien_waiver: 'orange',
  change_order: 'red',
  other: 'default',
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface TemplateFormValues {
  company_id: string;
  name: string;
  document_type: DocumentType;
  description?: string;
  requires_signature: boolean;
  is_active: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

const ContractTemplateManagement: React.FC = () => {
  const [form] = Form.useForm<TemplateFormValues>();
  const queryClient = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ContractTemplate | null>(null);
  const [filterCompanyId, setFilterCompanyId] = useState<string | undefined>(undefined);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [fieldMappingTemplate, setFieldMappingTemplate] = useState<ContractTemplate | null>(null);

  // ── Queries ─────────────────────────────────────────────────────────────────

  const { data: companiesData = [], isLoading: companiesLoading } = useQuery({
    queryKey: ['companies'],
    queryFn: () => companyService.getCompanies(),
  });

  const {
    data: templatesData,
    isLoading: templatesLoading,
    error: templatesError,
  } = useQuery({
    queryKey: ['contract-templates', filterCompanyId],
    queryFn: () => contractTemplateService.list(filterCompanyId),
  });

  const templates = templatesData?.templates ?? [];

  // ── Mutations ────────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (formData: FormData) => contractTemplateService.create(formData),
    onSuccess: () => {
      message.success('Template created successfully.');
      queryClient.invalidateQueries({ queryKey: ['contract-templates'] });
      handleCloseModal();
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || 'Failed to create template.');
    },
  });

  const updateMetaMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<ContractTemplate> }) =>
      contractTemplateService.update(id, payload),
    onSuccess: async (_, { id }) => {
      // If a new PDF was selected, upload it after meta update
      const raw = fileList[0]?.originFileObj;
      if (raw) {
        await contractTemplateService.uploadPdf(id, raw);
      }
      message.success('Template updated successfully.');
      queryClient.invalidateQueries({ queryKey: ['contract-templates'] });
      handleCloseModal();
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || 'Failed to update template.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => contractTemplateService.delete(id),
    onSuccess: () => {
      message.success('Template deleted.');
      queryClient.invalidateQueries({ queryKey: ['contract-templates'] });
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || 'Failed to delete template.');
    },
  });

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleOpenCreate = () => {
    setEditing(null);
    setFileList([]);
    form.resetFields();
    form.setFieldsValue({ requires_signature: true, is_active: true });
    setModalOpen(true);
  };

  const handleOpenEdit = (record: ContractTemplate) => {
    setEditing(record);
    setFileList([]);
    form.setFieldsValue({
      company_id: record.company_id,
      name: record.name,
      document_type: record.document_type,
      description: record.description,
      requires_signature: record.requires_signature,
      is_active: record.is_active,
    });
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setEditing(null);
    setFileList([]);
    form.resetFields();
  };

  const handleSubmit = async () => {
    let values: TemplateFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    if (editing) {
      updateMetaMutation.mutate({
        id: editing.id,
        payload: {
          company_id: values.company_id,
          name: values.name,
          document_type: values.document_type,
          description: values.description,
          requires_signature: values.requires_signature,
          is_active: values.is_active,
        },
      });
    } else {
      // Create via multipart/form-data
      const rawFile = fileList[0]?.originFileObj;
      if (!rawFile) {
        message.error('Please select a PDF file.');
        return;
      }
      const fd = new FormData();
      fd.append('company_id', values.company_id);
      fd.append('name', values.name);
      fd.append('document_type', values.document_type);
      if (values.description) fd.append('description', values.description);
      fd.append('requires_signature', String(values.requires_signature));
      fd.append('is_active', String(values.is_active));
      fd.append('file', rawFile);
      createMutation.mutate(fd);
    }
  };

  const handleDelete = (id: string) => {
    Modal.confirm({
      title: 'Delete Template',
      content: 'This cannot be undone. Any contracts using this template will be unaffected.',
      okText: 'Delete',
      okType: 'danger',
      onOk: () => deleteMutation.mutate(id),
    });
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // ── Table Columns ─────────────────────────────────────────────────────────────

  const columns: ColumnsType<ContractTemplate> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{name}</Text>
          {record.file_name && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              <FilePdfOutlined style={{ marginRight: 4, color: '#ff4d4f' }} />
              {record.file_name} ({formatBytes(record.file_size)})
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Company',
      dataIndex: 'company_name',
      key: 'company_name',
      render: (v?: string) => v || <Text type="secondary">—</Text>,
    },
    {
      title: 'Document Type',
      dataIndex: 'document_type',
      key: 'document_type',
      render: (dt: DocumentType) => (
        <Tag color={DOCUMENT_TYPE_COLORS[dt]}>{DOCUMENT_TYPE_LABELS[dt]}</Tag>
      ),
    },
    {
      title: 'File',
      dataIndex: 'file_name',
      key: 'file_name',
      render: (_: unknown, record) => {
        if (!record.file_url) return <Text type="secondary">No file</Text>;
        if (record.file_available === false)
          return (
            <Tooltip title="PDF file is missing. Please re-upload.">
              <Tag color="error" icon={<FilePdfOutlined />}>
                File Missing
              </Tag>
            </Tooltip>
          );
        return (
          <Button
            size="small"
            type="link"
            icon={<FilePdfOutlined />}
            href={record.file_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            View PDF
          </Button>
        );
      },
    },
    {
      title: 'Signature',
      dataIndex: 'requires_signature',
      key: 'requires_signature',
      align: 'center',
      render: (v: boolean) =>
        v ? <Tag color="blue">Required</Tag> : <Tag color="default">Not Required</Tag>,
    },
    {
      title: 'Status',
      dataIndex: 'is_active',
      key: 'is_active',
      align: 'center',
      render: (v: boolean) =>
        v ? <Tag color="success">Active</Tag> : <Tag color="default">Inactive</Tag>,
    },
    {
      title: 'Actions',
      key: 'actions',
      align: 'right',
      render: (_: unknown, record) => (
        <Space>
          <Tooltip title={record.file_available === false ? 'PDF file is missing' : 'Field Mapping'}>
            <Button
              icon={<FormOutlined />}
              size="small"
              onClick={() => setFieldMappingTemplate(record)}
              disabled={!record.file_url || record.file_available === false}
            />
          </Tooltip>
          <Tooltip title="Edit">
            <Button
              icon={<EditOutlined />}
              size="small"
              onClick={() => handleOpenEdit(record)}
            />
          </Tooltip>
          <Tooltip title="Delete">
            <Button
              icon={<DeleteOutlined />}
              size="small"
              danger
              onClick={() => handleDelete(record.id)}
              loading={deleteMutation.isPending}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  // ── Render ────────────────────────────────────────────────────────────────────

  const isMutating = createMutation.isPending || updateMetaMutation.isPending;

  return (
    <div style={{ padding: '24px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <Space align="center">
          <FileAddOutlined style={{ fontSize: 24, color: '#1677ff' }} />
          <Title level={3} style={{ margin: 0 }}>
            Contract Templates
          </Title>
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreate}>
          Add Template
        </Button>
      </div>

      {/* Filters */}
      <Card style={{ marginBottom: 16 }} size="small">
        <Space wrap>
          <Text type="secondary">Filter by company:</Text>
          <Select
            allowClear
            placeholder="All companies"
            style={{ minWidth: 220 }}
            loading={companiesLoading}
            value={filterCompanyId}
            onChange={(v) => setFilterCompanyId(v)}
          >
            {companiesData.map((c) => (
              <Option key={c.id} value={c.id}>
                {c.name}
              </Option>
            ))}
          </Select>
        </Space>
      </Card>

      {/* Table */}
      {templatesError ? (
        <div style={{ color: '#ff4d4f', padding: 16 }}>
          Failed to load templates. Please try again.
        </div>
      ) : (
        <Card>
          <Table<ContractTemplate>
            rowKey="id"
            dataSource={templates}
            columns={columns}
            loading={templatesLoading}
            pagination={{ pageSize: 20, showSizeChanger: false }}
          />
        </Card>
      )}

      {/* Add / Edit Modal */}
      <Modal
        title={editing ? 'Edit Template' : 'Add Template'}
        open={modalOpen}
        onCancel={handleCloseModal}
        onOk={handleSubmit}
        okText={editing ? 'Save Changes' : 'Create Template'}
        confirmLoading={isMutating}
        destroyOnClose
        width={560}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ requires_signature: true, is_active: true }}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            label="Company"
            name="company_id"
            rules={[{ required: true, message: 'Please select a company.' }]}
          >
            <Select
              placeholder="Select company"
              showSearch
              optionFilterProp="children"
              loading={companiesLoading}
            >
              {companiesData.map((c) => (
                <Option key={c.id} value={c.id}>
                  {c.name}
                </Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            label="Template Name"
            name="name"
            rules={[{ required: true, message: 'Please enter a template name.' }]}
          >
            <Input placeholder="e.g. Water Mitigation Authorization" maxLength={200} />
          </Form.Item>

          <Form.Item
            label="Document Type"
            name="document_type"
            rules={[{ required: true, message: 'Please select a document type.' }]}
          >
            <Select placeholder="Select document type">
              {(Object.entries(DOCUMENT_TYPE_LABELS) as [DocumentType, string][]).map(
                ([val, label]) => (
                  <Option key={val} value={val}>
                    {label}
                  </Option>
                )
              )}
            </Select>
          </Form.Item>

          <Form.Item label="Description" name="description">
            <TextArea rows={3} placeholder="Optional description" maxLength={1000} />
          </Form.Item>

          <Form.Item
            label={editing ? 'Replace PDF (optional)' : 'PDF File'}
            required={!editing}
          >
            <Upload
              accept=".pdf"
              maxCount={1}
              beforeUpload={() => false}
              fileList={fileList}
              onChange={({ fileList: fl }) => setFileList(fl)}
            >
              <Button icon={<UploadOutlined />}>
                {editing ? 'Choose New PDF' : 'Choose PDF'}
              </Button>
            </Upload>
            {editing && editing.file_name && fileList.length === 0 && (
              <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
                Current: {editing.file_name}
              </Text>
            )}
          </Form.Item>

          <Space>
            <Form.Item name="requires_signature" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Checkbox>Requires Signature</Checkbox>
            </Form.Item>
            <Form.Item name="is_active" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Checkbox>Active</Checkbox>
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      {/* Field Mapping Editor */}
      {fieldMappingTemplate && (
        <React.Suspense fallback={<Spin size="large" />}>
        <FieldMappingEditor
          open={!!fieldMappingTemplate}
          templateId={fieldMappingTemplate.id}
          templateName={fieldMappingTemplate.name}
          fileUrl={fieldMappingTemplate.file_url || ''}
          onClose={() => setFieldMappingTemplate(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['contract-templates'] })}
        />
        </React.Suspense>
      )}
    </div>
  );
};

export default ContractTemplateManagement;
