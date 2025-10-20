import React, { useState } from 'react';
import { 
  Table, 
  Card, 
  Button, 
  Space, 
  Tag, 
  Input, 
  Select, 
  DatePicker, 
  Row, 
  Col,
  Dropdown,
  Modal,
  message,
  Typography,
} from 'antd';
import {
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  DownloadOutlined,
  MailOutlined,
  CopyOutlined,
  MoreOutlined,
  SearchOutlined,
  FilterOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { documentService } from '../services/documentService';
import { invoiceService, InvoiceResponse } from '../services/invoiceService';
import { estimateService } from '../services/estimateService';
import { Document, DocumentFilter, DocumentType, DocumentStatus, InvoiceStatus, EstimateStatus, EstimateType, EstimateTypeLabels } from '../types';
import dayjs from 'dayjs';

const { Title } = Typography;
const { RangePicker } = DatePicker;

// Type for table data source - ensures all optional fields have default values
interface TableDocument {
  id: string;
  document_number: string;
  type: DocumentType;
  company_id: string;
  client_name: string;
  client_address: string; // Required for table display
  client_city: string; // Required for table display
  total_amount: number;
  status: DocumentStatus;
  created_at: string;
  updated_at: string;
  estimate_type?: EstimateType; // For estimates
  estimate_number?: string; // For estimates
}

const DocumentList: React.FC = () => {
  const navigate = useNavigate();
  const { type } = useParams<{ type: string }>();
  const queryClient = useQueryClient();
  
  const [filter, setFilter] = useState<DocumentFilter>({
    type: type as DocumentType,
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Fetch documents - use specific service based on type
  const { data, isLoading } = useQuery<{ items: TableDocument[]; total: number }>({
    queryKey: ['documents', type, filter, currentPage, pageSize],
    queryFn: async (): Promise<{ items: TableDocument[]; total: number }> => {
      if (type === 'invoice') {
        // Use invoice service
        const invoices = await invoiceService.getInvoices({
          skip: (currentPage - 1) * pageSize,
          limit: pageSize,
          client_name: filter.search,
          status: filter.status,
        });
        
        // Transform to match expected format
        return {
          items: invoices.map((invoice: InvoiceResponse): TableDocument => ({
            id: invoice.id,
            document_number: invoice.invoice_number,
            type: 'invoice' as DocumentType,
            company_id: invoice.company_id || '',
            client_name: invoice.client_name,
            client_address: invoice.client_address || '',
            client_city: invoice.client_city || '',
            total_amount: invoice.total,
            status: invoice.status as DocumentStatus,
            created_at: invoice.created_at,
            updated_at: invoice.updated_at,
          })),
          total: invoices.length, // API doesn't return total count yet
        };
      } else if (type === 'estimate' || type === 'insurance_estimate') {
        // Determine the estimate_type to filter by
        let requestEstimateType: string | undefined = undefined;

        if (type === 'insurance_estimate') {
          // Insurance estimate page - always show only insurance estimates
          requestEstimateType = EstimateType.INSURANCE;
        } else if (type === 'estimate') {
          // General estimate page - use filter selection if provided, otherwise show all
          requestEstimateType = filter.estimate_type;
        }

        // Use estimate service for both estimate types
        const estimates = await estimateService.getEstimates({
          skip: (currentPage - 1) * pageSize,
          limit: pageSize,
          client_name: filter.search,
          status: filter.status,
          estimate_type: requestEstimateType, // undefined = show all types
        });
        
        // Backend handles all filtering now
        let filteredEstimates = estimates;
        
        // Transform to match expected format
        return {
          items: filteredEstimates.map((estimate: any): TableDocument => {
            // Always use estimate_type from API - do NOT infer from insurance fields
            // A standard estimate can have insurance info but still be standard type
            let estimateType = estimate.estimate_type || EstimateType.STANDARD;

            // Convert string to enum if needed
            if (typeof estimateType === 'string') {
              estimateType = estimateType === 'insurance' ? EstimateType.INSURANCE : EstimateType.STANDARD;
            }

            return {
              id: estimate.id,
              document_number: estimate.estimate_number,
              type: estimateType === EstimateType.INSURANCE ? 'insurance_estimate' as DocumentType : 'estimate' as DocumentType,
              estimate_type: estimateType, // Add estimate_type to record
              company_id: estimate.company_id || '',
              client_name: estimate.client_name,
              client_address: estimate.client_address || estimate.street_address || '',
              client_city: estimate.client_city || estimate.city || '',
              total_amount: estimate.total_amount,
              status: estimate.status as DocumentStatus,
              created_at: estimate.created_at,
              updated_at: estimate.updated_at,
              estimate_number: estimate.estimate_number,
            };
          }),
          total: filteredEstimates.length,
        };
      } else {
        // Use document service for other types
        const result = await documentService.getDocuments(filter, currentPage, pageSize);
        // Transform documents to ensure required fields
        return {
          ...result,
          items: result.items?.map((doc: Document): TableDocument => ({
            id: doc.id,
            document_number: doc.document_number,
            type: doc.type,
            company_id: doc.company_id,
            client_name: doc.client_name,
            client_address: doc.client_address || '',
            client_city: doc.client_city || '',
            total_amount: doc.total_amount,
            status: doc.status,
            created_at: doc.created_at,
            updated_at: doc.updated_at,
          })) || []
        };
      }
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => {
      if (type === 'invoice') {
        return invoiceService.deleteInvoice(id);
      } else if (type === 'estimate' || type === 'insurance_estimate') {
        return estimateService.deleteEstimate(id);
      } else {
        return documentService.deleteDocument(id);
      }
    },
    onSuccess: () => {
      message.success('Document has been deleted');
      queryClient.invalidateQueries({ 
        queryKey: ['documents', type] 
      });
    },
    onError: () => {
      message.error('An error occurred during deletion');
    },
  });

  // Duplicate mutation
  const duplicateMutation = useMutation({
    mutationFn: async (id: string): Promise<any> => {
      if (type === 'invoice') {
        return await invoiceService.duplicateInvoice(id);
      } else if (type === 'estimate' || type === 'insurance_estimate') {
        return await estimateService.duplicateEstimate(id);
      } else {
        return await documentService.duplicateDocument(id);
      }
    },
    onSuccess: () => {
      message.success('Document has been duplicated');
      queryClient.invalidateQueries({ 
        queryKey: ['documents', type] 
      });
    },
    onError: () => {
      message.error('An error occurred during duplication');
    },
  });

  const handleDelete = (id: string) => {
    Modal.confirm({
      title: 'Delete Document',
      content: 'Are you sure you want to delete this document?',
      okText: 'Delete',
      cancelText: 'Cancel',
      okButtonProps: { danger: true },
      onOk: () => deleteMutation.mutate(id),
    });
  };

  const handleDownloadPDF = async (id: string, record: any) => {
    try {
      let blob: Blob;
      let filename: string;
      
      if (type === 'invoice') {
        // Get invoice data and generate PDF
        const invoice = await invoiceService.getInvoice(id);
        
        // Prepare data for PDF generation
        const pdfData = {
          invoice_number: invoice.invoice_number,
          date: invoice.date,
          due_date: invoice.due_date,
          company: {
            name: invoice.company_name,
            address: invoice.company_address,
            city: invoice.company_city,
            state: invoice.company_state,
            zipcode: invoice.company_zipcode,
            phone: invoice.company_phone,
            email: invoice.company_email,
            logo: invoice.company_logo
          },
          client: {
            name: invoice.client_name,
            address: invoice.client_address || '',
            city: invoice.client_city || '',
            state: invoice.client_state,
            zipcode: invoice.client_zipcode,
            phone: invoice.client_phone,
            email: invoice.client_email
          },
          insurance: {
            company: invoice.insurance_company,
            policy_number: invoice.insurance_policy_number,
            claim_number: invoice.insurance_claim_number
          },
          items: invoice.items || [],
          subtotal: invoice.subtotal,
          tax_rate: invoice.tax_rate,
          tax_amount: invoice.tax_amount,
          discount: invoice.discount,
          shipping: invoice.shipping,
          total: invoice.total,
          paid_amount: invoice.paid_amount,
          payment_terms: invoice.payment_terms,
          notes: invoice.notes
        };
        
        blob = await invoiceService.previewPDF(pdfData);
        filename = `invoice_${invoice.invoice_number}.pdf`;
      } else if (type === 'estimate' || type === 'insurance_estimate') {
        // Use the new estimate PDF endpoint for saved estimates
        blob = await estimateService.generatePDF(id);
        filename = `estimate_${record.estimate_number || id}.pdf`;
      } else {
        blob = await documentService.generatePDF(id);
        filename = `document_${id}.pdf`;
      }
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('PDF download error:', error);
      message.error('An error occurred during PDF download');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      // Invoice statuses
      case 'pending': return 'processing';
      case 'paid': return 'success';
      case 'overdue': return 'error';
      case 'cancelled': return 'default';

      // Estimate statuses
      case 'draft': return 'default';
      case 'sent': return 'processing';
      case 'accepted': return 'success';
      case 'rejected': return 'error';
      case 'expired': return 'warning';

      default: return 'default';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      // Invoice statuses
      case 'pending': return 'Pending';
      case 'paid': return 'Paid';
      case 'overdue': return 'Overdue';
      case 'cancelled': return 'Cancelled';

      // Estimate statuses
      case 'draft': return 'Draft';
      case 'sent': return 'Sent';
      case 'accepted': return 'Accepted';
      case 'rejected': return 'Rejected';
      case 'expired': return 'Expired';

      default: return status;
    }
  };

  const columns = [
    {
      title: 'Document Number',
      dataIndex: 'document_number',
      key: 'document_number',
      width: 150,
      render: (text: string, record: TableDocument) => (
        <a
          onClick={() => {
            // Navigate to the appropriate edit page based on document type
            if (record.type === 'invoice') {
              navigate(`/invoices/${record.id}/edit`);
            } else if (record.type === 'estimate') {
              navigate(`/edit/estimate/${record.id}`);
            } else if (record.type === 'insurance_estimate') {
              navigate(`/insurance-estimate/${record.id}`);
            } else if (record.type === 'plumber_report') {
              navigate(`/plumber-reports/${record.id}/edit`);
            }
          }}
          style={{ cursor: 'pointer' }}
        >
          {text}
        </a>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      width: 150,
      render: (documentType: DocumentType, record: any) => {
        // For estimate pages, show estimate type instead of document type
        if (type === 'estimate' && record.estimate_type) {
          return (
            <Tag color={record.estimate_type === EstimateType.INSURANCE ? 'blue' : 'green'}>
              {EstimateTypeLabels[record.estimate_type as EstimateType]}
            </Tag>
          );
        }
        
        // For other document types, use original logic
        const typeMap: Record<DocumentType, string> = {
          estimate: 'Estimate',
          invoice: 'Invoice',
          insurance_estimate: 'Insurance Estimate',
          plumber_report: 'Plumber Report',
          work_order: 'Work Order',
        };
        return typeMap[documentType] || documentType;
      },
    },
    {
      title: 'Property Address',
      key: 'property_address',
      width: 250,
      render: (_: any, record: any) => {
        const address = record.client_address || record.street_address || '';
        const city = record.client_city || record.city || '';

        if (!address && !city) return '-';

        return (
          <div>
            {address && <div>{address}</div>}
            {city && <div style={{ color: '#666', fontSize: '12px' }}>{city}</div>}
          </div>
        );
      },
    },
    {
      title: 'Amount',
      dataIndex: 'total_amount',
      key: 'total_amount',
      width: 120,
      render: (amount: number) => `$${(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => (
        <Tag color={getStatusColor(status)}>
          {getStatusText(status)}
        </Tag>
      ),
    },
    {
      title: 'Created Date',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 120,
      render: (date: string) => {
        if (!date) return '-';
        const formattedDate = dayjs(date);
        return formattedDate.isValid() ? formattedDate.format('YYYY-MM-DD') : '-';
      },
    },
    {
      title: 'Updated Date',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 120,
      render: (date: string) => {
        if (!date) return '-';
        const formattedDate = dayjs(date);
        return formattedDate.isValid() ? formattedDate.format('YYYY-MM-DD') : '-';
      },
    },
    {
      title: 'Actions',
      key: 'action',
      width: 120,
      fixed: 'right' as const,
      render: (_: any, record: Document) => {
        const menuItems = [
          {
            key: 'edit',
            icon: <EditOutlined />,
            label: 'Edit',
            onClick: () => {
              // Navigate to the appropriate edit page based on document type
              if (record.type === 'invoice') {
                navigate(`/invoices/${record.id}/edit`);
              } else if (record.type === 'estimate') {
                navigate(`/edit/estimate/${record.id}`);
              } else if (record.type === 'insurance_estimate') {
                navigate(`/insurance-estimate/${record.id}`);
              } else if (record.type === 'plumber_report') {
                navigate(`/plumber-reports/${record.id}/edit`);
              }
            },
          },
          {
            key: 'download',
            icon: <DownloadOutlined />,
            label: 'Download PDF',
            onClick: () => handleDownloadPDF(record.id, record),
          },
          {
            key: 'send',
            icon: <MailOutlined />,
            label: 'Send Email',
            onClick: () => navigate(`/documents/${record.id}/send`),
          },
          {
            key: 'duplicate',
            icon: <CopyOutlined />,
            label: 'Duplicate',
            onClick: () => duplicateMutation.mutate(record.id),
          },
          {
            type: 'divider' as const,
          },
          {
            key: 'delete',
            icon: <DeleteOutlined />,
            label: 'Delete',
            danger: true,
            onClick: () => handleDelete(record.id),
          },
        ];

        return (
          <Dropdown menu={{ items: menuItems }} trigger={['click']}>
            <Button icon={<MoreOutlined />} />
          </Dropdown>
        );
      },
    },
  ];

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 24 }}>
        <Col>
          <Title level={2}>
            {type === 'estimate' && 'Estimate List'}
            {type === 'invoice' && 'Invoice List'}
            {type === 'insurance_estimate' && 'Insurance Estimate List'}
            {type === 'plumber_report' && 'Plumber Report List'}
            {!type && 'All Documents'}
          </Title>
        </Col>
        <Col>
          <Button type="primary" onClick={() => {
            let createPath: string;
            if (type === 'plumber_report') {
              createPath = '/create/plumber';
            } else if (type === 'insurance_estimate') {
              createPath = '/create/insurance-estimate';
            } else {
              createPath = `/create/${type || 'estimate'}`;
            }
            navigate(createPath);
          }}>
            Create New Document
          </Button>
        </Col>
      </Row>

      {/* Filters */}
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} md={6}>
            <Input
              placeholder="Enter search term"
              prefix={<SearchOutlined />}
              value={filter.search}
              onChange={(e) => setFilter({ ...filter, search: e.target.value })}
            />
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Select
              placeholder="Select status"
              style={{ width: '100%' }}
              allowClear
              value={filter.status}
              onChange={(value) => setFilter({ ...filter, status: value })}
            >
              <Select.Option value="draft">Draft</Select.Option>
              <Select.Option value="sent">Sent</Select.Option>
              <Select.Option value="paid">Paid</Select.Option>
              <Select.Option value="cancelled">Cancelled</Select.Option>
            </Select>
          </Col>
          {type === 'estimate' && (
            <Col xs={24} sm={12} md={6}>
              <Select
                placeholder="Select estimate type"
                style={{ width: '100%' }}
                allowClear
                value={filter.estimate_type}
                onChange={(value) => setFilter({ ...filter, estimate_type: value })}
              >
                <Select.Option value={EstimateType.STANDARD}>
                  {EstimateTypeLabels[EstimateType.STANDARD]}
                </Select.Option>
                <Select.Option value={EstimateType.INSURANCE}>
                  {EstimateTypeLabels[EstimateType.INSURANCE]}
                </Select.Option>
              </Select>
            </Col>
          )}
          <Col xs={24} sm={12} md={type === 'estimate' ? 6 : 8}>
            <RangePicker
              style={{ width: '100%' }}
              onChange={(dates) => {
                if (dates) {
                  setFilter({
                    ...filter,
                    date_from: dates[0]?.format('YYYY-MM-DD'),
                    date_to: dates[1]?.format('YYYY-MM-DD'),
                  });
                } else {
                  setFilter({
                    ...filter,
                    date_from: undefined,
                    date_to: undefined,
                  });
                }
              }}
            />
          </Col>
          <Col xs={24} sm={12} md={4}>
            <Space>
              <Button 
                icon={<FilterOutlined />}
                onClick={() => setCurrentPage(1)}
              >
                Apply Filter
              </Button>
              <Button 
                onClick={() => {
                  setFilter({ type: type as DocumentType });
                  setCurrentPage(1);
                }}
              >
                Reset
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* Table */}
      <Card>
        <Table
          columns={columns}
          dataSource={data?.items}  // Changed from data?.data to data?.items
          rowKey="id"
          loading={isLoading}
          pagination={{
            current: currentPage,
            pageSize: pageSize,
            total: data?.total,
            showSizeChanger: true,
            showTotal: (total) => `${total} total`,
            onChange: (page, size) => {
              setCurrentPage(page);
              setPageSize(size || 20);
            },
          }}
          scroll={{ x: 1000 }}
        />
      </Card>
    </div>
  );
};

export default DocumentList;