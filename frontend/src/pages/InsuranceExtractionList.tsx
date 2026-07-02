import React, { useState } from 'react';
import {
  Button,
  Card,
  Grid,
  List,
  message,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd';
import {
  DeleteOutlined,
  EyeOutlined,
  PlusOutlined,
  ScanOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';

import { fileService } from '../services/fileService';
import { insuranceExtractionService } from '../services/insuranceExtractionService';
import { InsuranceExtraction } from '../types/insuranceExtraction';

const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

const fmt = (v?: number | null) =>
  v != null
    ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—';

const InsuranceExtractionList: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);

  const { data: extractions = [], isLoading } = useQuery<InsuranceExtraction[]>({
    queryKey: ['insurance-extractions'],
    queryFn: () => insuranceExtractionService.listExtractions(50),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => insuranceExtractionService.deleteExtraction(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['insurance-extractions'] });
      message.success('Extraction deleted');
    },
    onError: () => message.error('Failed to delete'),
  });

  const handleDelete = (id: string) => {
    Modal.confirm({
      title: 'Delete Extraction?',
      content: 'This will permanently delete this extraction and all its items.',
      okText: 'Delete',
      okType: 'danger',
      onOk: () => deleteMutation.mutateAsync(id),
    });
  };

  const handleUploadAndExtract = async () => {
    if (!selectedFile) return;
    try {
      setIsExtracting(true);
      const uploaded = await fileService.uploadFiles(
        [selectedFile],
        'insurance_extraction',
        `manual-insurance-extraction-${Date.now()}`,
        'insurance-pdf'
      );
      if (!uploaded.length) throw new Error('Upload failed');

      const extracted = await insuranceExtractionService.extractFromFile(uploaded[0].id);
      queryClient.invalidateQueries({ queryKey: ['insurance-extractions'] });
      message.success(`Extracted ${extracted.items.length} items`);
      setUploadModalOpen(false);
      setSelectedFile(null);
      navigate(`/insurance-extractions/${extracted.id}`);
    } catch {
      message.error('Extraction failed');
    } finally {
      setIsExtracting(false);
    }
  };

  const getEstimateLabel = (ext: InsuranceExtraction) => {
    const header = ext.parser_metadata?.header;
    if (header?.estimate_id) return String(header.estimate_id);
    if (header?.insured) return String(header.insured);
    return ext.id.slice(0, 8);
  };

  const getSummaryRcv = (ext: InsuranceExtraction) => {
    const summary = ext.parser_metadata?.summary;
    return summary?.rcv ?? summary?.net_claim ?? null;
  };

  // Desktop table columns
  const tableColumns = [
    {
      title: 'Estimate',
      key: 'estimate',
      render: (_: unknown, row: InsuranceExtraction) => (
        <Text strong style={{ cursor: 'pointer' }} onClick={() => navigate(`/insurance-extractions/${row.id}`)}>
          {getEstimateLabel(row)}
        </Text>
      ),
    },
    {
      title: 'Carrier',
      dataIndex: 'carrier',
      key: 'carrier',
      width: 120,
      render: (v: string) => v || 'generic',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v: string) => (
        <Tag color={v === 'completed' ? 'green' : v === 'failed' ? 'red' : 'blue'}>
          {v}
        </Tag>
      ),
    },
    {
      title: 'Items',
      key: 'items',
      width: 80,
      render: (_: unknown, row: InsuranceExtraction) => row.items.length,
    },
    {
      title: 'RCV',
      key: 'rcv',
      width: 130,
      render: (_: unknown, row: InsuranceExtraction) => fmt(getSummaryRcv(row)),
    },
    {
      title: 'Date',
      key: 'created_at',
      width: 120,
      render: (_: unknown, row: InsuranceExtraction) =>
        row.created_at ? dayjs(row.created_at).format('MM/DD/YYYY') : '—',
    },
    {
      title: '',
      key: 'actions',
      width: 90,
      render: (_: unknown, row: InsuranceExtraction) => (
        <Space size={4}>
          <Button
            type="text"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => navigate(`/insurance-extractions/${row.id}`)}
          />
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(row.id)}
          />
        </Space>
      ),
    },
  ];

  // Mobile card renderer
  const renderMobileItem = (ext: InsuranceExtraction) => (
    <List.Item
      style={{ padding: '12px 0', cursor: 'pointer' }}
      onClick={() => navigate(`/insurance-extractions/${ext.id}`)}
      actions={[
        <Button
          key="delete"
          type="text"
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            handleDelete(ext.id);
          }}
        />,
      ]}
    >
      <List.Item.Meta
        title={
          <Space size={[6, 4]} wrap>
            <Text strong>{getEstimateLabel(ext)}</Text>
            <Tag color={ext.status === 'completed' ? 'green' : ext.status === 'failed' ? 'red' : 'blue'}>
              {ext.status}
            </Tag>
          </Space>
        }
        description={
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <Space size={[8, 4]} wrap>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {ext.carrier || 'generic'}
              </Text>
              <Text style={{ fontSize: 12 }}>
                {ext.items.length} items
              </Text>
              {getSummaryRcv(ext) != null && (
                <Tag color="green" style={{ fontSize: 11 }}>
                  RCV: {fmt(getSummaryRcv(ext))}
                </Tag>
              )}
            </Space>
            {ext.created_at && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {dayjs(ext.created_at).format('MM/DD/YYYY h:mm A')}
              </Text>
            )}
          </Space>
        }
      />
    </List.Item>
  );

  return (
    <div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
        flexWrap: 'wrap',
        gap: 8,
      }}>
        <Title level={isMobile ? 4 : 3} style={{ margin: 0 }}>
          Insurance Extractions
        </Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setUploadModalOpen(true)}
          size={isMobile ? 'middle' : 'large'}
        >
          {isMobile ? 'New' : 'New Extraction'}
        </Button>
      </div>

      <Card
        size={isMobile ? 'small' : 'default'}
        styles={{ body: { padding: isMobile ? 8 : undefined } }}
      >
        {isMobile ? (
          <List
            loading={isLoading}
            dataSource={extractions}
            renderItem={renderMobileItem}
            locale={{ emptyText: 'No extractions yet. Upload a PDF to get started.' }}
          />
        ) : (
          <Table
            loading={isLoading}
            size="small"
            rowKey="id"
            dataSource={extractions}
            columns={tableColumns}
            pagination={{ pageSize: 15 }}
            locale={{ emptyText: 'No extractions yet. Upload a PDF to get started.' }}
          />
        )}
      </Card>

      <Modal
        title="New Insurance Extraction"
        open={uploadModalOpen}
        onCancel={() => {
          if (!isExtracting) {
            setUploadModalOpen(false);
            setSelectedFile(null);
          }
        }}
        footer={[
          <Button key="cancel" onClick={() => setUploadModalOpen(false)} disabled={isExtracting}>
            Cancel
          </Button>,
          <Button
            key="extract"
            type="primary"
            icon={<ScanOutlined />}
            loading={isExtracting}
            disabled={!selectedFile}
            onClick={handleUploadAndExtract}
          >
            Upload & Extract
          </Button>,
        ]}
      >
        <Upload
          maxCount={1}
          accept=".pdf,application/pdf"
          beforeUpload={(file) => {
            setSelectedFile(file);
            return false;
          }}
          onRemove={() => {
            setSelectedFile(null);
            return true;
          }}
        >
          <Button icon={<UploadOutlined />}>Select Insurance PDF</Button>
        </Upload>
      </Modal>
    </div>
  );
};

export default InsuranceExtractionList;
