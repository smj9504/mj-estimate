/**
 * Water Mitigation Document Upload Modal
 * Allows manual upload of documents (COS, EWA, Invoice, Sketch, Photo, Other)
 * Invoice type includes amount field
 */

import React, { useState } from 'react';
import { Modal, Select, Input, InputNumber, Upload, Button, Space, Typography, message } from 'antd';
import { UploadOutlined, InboxOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import waterMitigationService from '../../services/waterMitigationService';

const { Text } = Typography;
const { Dragger } = Upload;
const { TextArea } = Input;

interface WMDocumentUploadModalProps {
  open: boolean;
  jobId: string;
  onClose: () => void;
  onSuccess: () => void;
}

const UPLOAD_DOCUMENT_TYPES = [
  { value: 'COS', label: 'Certificate of Satisfaction (COS)' },
  { value: 'EWA', label: 'Emergency Work Agreement (EWA)' },
  { value: 'Invoice', label: 'Invoice' },
  { value: 'Sketch', label: 'Sketch' },
  { value: 'Photo', label: 'Photo' },
  { value: 'Other', label: 'Other' },
];

const WMDocumentUploadModal: React.FC<WMDocumentUploadModalProps> = ({
  open,
  jobId,
  onClose,
  onSuccess,
}) => {
  const [documentType, setDocumentType] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState<number | null>(null);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);

  const resetForm = () => {
    setDocumentType(null);
    setTitle('');
    setDescription('');
    setInvoiceAmount(null);
    setFileList([]);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleUpload = async () => {
    if (!documentType) {
      message.error('Please select a document type');
      return;
    }
    if (fileList.length === 0) {
      message.error('Please select a file to upload');
      return;
    }

    setUploading(true);
    try {
      for (const uploadFile of fileList) {
        const file = uploadFile.originFileObj as File;
        await waterMitigationService.documents.uploadDocument(
          jobId,
          file,
          documentType,
          title || undefined,
          description || undefined,
          documentType === 'Invoice' && invoiceAmount !== null ? invoiceAmount : undefined
        );
      }

      message.success(
        fileList.length === 1
          ? 'Document uploaded successfully'
          : `${fileList.length} documents uploaded successfully`
      );
      resetForm();
      onSuccess();
    } catch (error: any) {
      console.error('Failed to upload document:', error);
      const errorMessage = error?.response?.data?.detail || 'Failed to upload document';
      message.error(errorMessage);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal
      title="Upload Document"
      open={open}
      onCancel={handleClose}
      footer={[
        <Button key="cancel" onClick={handleClose}>
          Cancel
        </Button>,
        <Button
          key="upload"
          type="primary"
          icon={<UploadOutlined />}
          onClick={handleUpload}
          disabled={!documentType || fileList.length === 0}
          loading={uploading}
        >
          Upload
        </Button>,
      ]}
      width={520}
      destroyOnClose
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {/* Document Type */}
        <div>
          <Text strong style={{ display: 'block', marginBottom: 4 }}>Document Type *</Text>
          <Select
            style={{ width: '100%' }}
            placeholder="Select document type"
            value={documentType}
            onChange={setDocumentType}
            options={UPLOAD_DOCUMENT_TYPES}
          />
        </div>

        {/* Invoice Amount - only for Invoice type */}
        {documentType === 'Invoice' && (
          <div>
            <Text strong style={{ display: 'block', marginBottom: 4 }}>Invoice Amount</Text>
            <InputNumber
              style={{ width: '100%' }}
              value={invoiceAmount}
              onChange={(value) => setInvoiceAmount(value)}
              placeholder="Enter invoice amount"
              prefix="$"
              precision={2}
              min={0}
            />
          </div>
        )}

        {/* Title */}
        <div>
          <Text strong style={{ display: 'block', marginBottom: 4 }}>Title</Text>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Optional title"
            maxLength={200}
          />
        </div>

        {/* Description */}
        <div>
          <Text strong style={{ display: 'block', marginBottom: 4 }}>Description</Text>
          <TextArea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
            rows={2}
            maxLength={500}
          />
        </div>

        {/* File Upload */}
        <div>
          <Text strong style={{ display: 'block', marginBottom: 4 }}>File *</Text>
          <Dragger
            fileList={fileList}
            onChange={({ fileList: newFileList }) => setFileList(newFileList)}
            beforeUpload={() => false}
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.tiff,.tif"
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">Click or drag file to upload</p>
            <p className="ant-upload-hint">
              PDF, Images, Word, Excel files supported
            </p>
          </Dragger>
        </div>
      </Space>
    </Modal>
  );
};

export default WMDocumentUploadModal;
