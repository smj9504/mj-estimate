/**
 * ContractTemplateManager - Manage contract templates within a Company form.
 * Lists templates for the company, allows add/edit/delete, PDF upload.
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Checkbox,
  Empty,
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
  FilePdfOutlined,
  FormOutlined,
  PlusOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { contractTemplateService } from '../../services/contractService';
import type { ContractTemplate, DocumentType } from '../../types/contract';

const { Text } = Typography;
const { Option } = Select;
const { TextArea } = Input;

const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  authorization: 'Authorization to Work',
  certificate_of_satisfaction: 'Certificate of Satisfaction',
  scope_of_work: 'Scope of Work',
  lien_waiver: 'Lien Waiver',
  change_order: 'Change Order',
  other: 'Other',
};

const DOCUMENT_TYPE_COLORS: Record<DocumentType, string> = {
  authorization: 'blue',
  certificate_of_satisfaction: 'green',
  scope_of_work: 'purple',
  lien_waiver: 'orange',
  change_order: 'red',
  other: 'default',
};

interface ContractTemplateManagerProps {
  companyId?: string;
  disabled?: boolean;
}

interface TemplateFormValues {
  name: string;
  document_type: DocumentType;
  description?: string;
  requires_signature: boolean;
  is_active: boolean;
}

const ContractTemplateManager: React.FC<ContractTemplateManagerProps> = ({
  companyId,
  disabled = false,
}) => {
  const [form] = Form.useForm<TemplateFormValues>();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ContractTemplate | null>(null);
  const [fileList, setFileList] = useState<UploadFile[]>([]);

  const { data: templatesData, isLoading } = useQuery({
    queryKey: ['contract-templates', companyId],
    queryFn: () => contractTemplateService.list(companyId),
    enabled: !!companyId,
  });

  const templates = templatesData?.templates ?? [];

  const createMutation = useMutation({
    mutationFn: (formData: FormData) => contractTemplateService.create(formData),
    onSuccess: () => {
      message.success('Contract template created.');
      queryClient.invalidateQueries({ queryKey: ['contract-templates', companyId] });
      handleCloseModal();
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || 'Failed to create template.');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Partial<ContractTemplate> }) => {
      await contractTemplateService.update(id, payload);
      const raw = fileList[0]?.originFileObj;
      if (raw) {
        await contractTemplateService.uploadPdf(id, raw);
      }
    },
    onSuccess: () => {
      message.success('Contract template updated.');
      queryClient.invalidateQueries({ queryKey: ['contract-templates', companyId] });
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
      queryClient.invalidateQueries({ queryKey: ['contract-templates', companyId] });
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || 'Failed to delete template.');
    },
  });

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
      updateMutation.mutate({
        id: editing.id,
        payload: {
          name: values.name,
          document_type: values.document_type,
          description: values.description,
          requires_signature: values.requires_signature,
          is_active: values.is_active,
        },
      });
    } else {
      const rawFile = fileList[0]?.originFileObj;
      if (!rawFile) {
        message.error('Please select a PDF file.');
        return;
      }
      const fd = new FormData();
      fd.append('company_id', companyId!);
      fd.append('name', values.name);
      fd.append('document_type', values.document_type);
      if (values.description) fd.append('description', values.description);
      fd.append('requires_signature', String(values.requires_signature));
      fd.append('file', rawFile);
      createMutation.mutate(fd);
    }
  };

  const handleDelete = (id: string) => {
    Modal.confirm({
      title: 'Delete Template',
      content: 'This action cannot be undone. Existing contracts using this template will not be affected.',
      okText: 'Delete',
      okType: 'danger',
      onOk: () => deleteMutation.mutate(id),
    });
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (!companyId) {
    return (
      <Text type="secondary">
        Save the company first, then you can manage contract templates.
      </Text>
    );
  }

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
      title: 'Type',
      dataIndex: 'document_type',
      key: 'document_type',
      width: 180,
      render: (dt: DocumentType) => (
        <Tag color={DOCUMENT_TYPE_COLORS[dt]}>{DOCUMENT_TYPE_LABELS[dt]}</Tag>
      ),
    },
    {
      title: 'Signature',
      dataIndex: 'requires_signature',
      key: 'requires_signature',
      width: 100,
      align: 'center',
      render: (v: boolean) =>
        v ? <Tag color="blue">Required</Tag> : <Tag>No</Tag>,
    },
    {
      title: 'Status',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 80,
      align: 'center',
      render: (v: boolean) =>
        v ? <Tag color="success">Active</Tag> : <Tag>Inactive</Tag>,
    },
    {
      title: '',
      key: 'actions',
      width: 120,
      align: 'right',
      render: (_: unknown, record) => (
        <Space size={4}>
          {record.file_url && (
            <Tooltip title="View PDF">
              <Button
                icon={<FilePdfOutlined />}
                size="small"
                type="text"
                href={record.file_url}
                target="_blank"
                rel="noopener noreferrer"
              />
            </Tooltip>
          )}
          <Tooltip title="Edit">
            <Button
              icon={<EditOutlined />}
              size="small"
              type="text"
              onClick={() => handleOpenEdit(record)}
              disabled={disabled}
            />
          </Tooltip>
          <Tooltip title="Delete">
            <Button
              icon={<DeleteOutlined />}
              size="small"
              type="text"
              danger
              onClick={() => handleDelete(record.id)}
              disabled={disabled}
              loading={deleteMutation.isPending}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  const isMutating = createMutation.isPending || updateMutation.isPending;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Text type="secondary">
          Upload PDF contract templates for this company. These can be used to generate contracts with auto-filled claim data.
        </Text>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={handleOpenCreate}
          disabled={disabled}
          size="small"
        >
          Add Template
        </Button>
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin />
        </div>
      ) : templates.length === 0 ? (
        <Empty
          description="No contract templates yet"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        >
          <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreate} disabled={disabled}>
            Add First Template
          </Button>
        </Empty>
      ) : (
        <Table<ContractTemplate>
          rowKey="id"
          dataSource={templates}
          columns={columns}
          pagination={false}
          size="small"
        />
      )}

      <Modal
        title={editing ? 'Edit Contract Template' : 'Add Contract Template'}
        open={modalOpen}
        onCancel={handleCloseModal}
        onOk={handleSubmit}
        okText={editing ? 'Save Changes' : 'Create Template'}
        confirmLoading={isMutating}
        destroyOnClose
        width={520}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ requires_signature: true, is_active: true }}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            label="Template Name"
            name="name"
            rules={[{ required: true, message: 'Please enter a name.' }]}
          >
            <Input placeholder="e.g. Water Mitigation Authorization" maxLength={200} />
          </Form.Item>

          <Form.Item
            label="Document Type"
            name="document_type"
            rules={[{ required: true, message: 'Please select a type.' }]}
          >
            <Select placeholder="Select document type">
              {(Object.entries(DOCUMENT_TYPE_LABELS) as [DocumentType, string][]).map(
                ([val, label]) => (
                  <Option key={val} value={val}>{label}</Option>
                )
              )}
            </Select>
          </Form.Item>

          <Form.Item label="Description" name="description">
            <TextArea rows={2} placeholder="Optional description" maxLength={1000} />
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
    </div>
  );
};

export default ContractTemplateManager;
