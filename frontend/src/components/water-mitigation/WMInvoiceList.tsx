/**
 * Water Mitigation Invoice List Component
 * Displays invoices generated from scope items for a WM job
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  List,
  Button,
  Popconfirm,
  message,
  Tag,
  Typography,
  Space,
  Empty,
  Statistic,
  Row,
  Col,
  Card,
  Spin
} from 'antd';
import {
  FileTextOutlined,
  DollarOutlined,
  DeleteOutlined,
  EyeOutlined,
  PrinterOutlined,
  CalendarOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import waterMitigationService from '../../services/waterMitigationService';
import type { WMScopeInvoiceResponse, JobInvoiceHistoryResponse } from '../../types/waterMitigation';

const { Text, Title } = Typography;

interface WMInvoiceListProps {
  jobId: string;
  onInvoiceDeleted?: () => void;
}

const WMInvoiceList = React.forwardRef<{ refresh: () => void }, WMInvoiceListProps>(
  ({ jobId, onInvoiceDeleted }, ref) => {
    const navigate = useNavigate();
    const [invoiceHistory, setInvoiceHistory] = useState<JobInvoiceHistoryResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);

    const fetchInvoiceHistory = useCallback(async () => {
      setLoading(true);
      try {
        const history = await waterMitigationService.scopeInvoice.getInvoiceHistory(jobId);
        setInvoiceHistory(history);
      } catch (error) {
        console.error('Failed to fetch invoice history:', error);
        // Don't show error message - just set empty state
        setInvoiceHistory({ invoices: [], total_invoiced: 0, invoice_count: 0 });
      } finally {
        setLoading(false);
      }
    }, [jobId]);

    useEffect(() => {
      fetchInvoiceHistory();
    }, [fetchInvoiceHistory]);

    // Expose refresh method via ref
    React.useImperativeHandle(ref, () => ({
      refresh: fetchInvoiceHistory
    }), [fetchInvoiceHistory]);

    const handleViewInvoice = (invoiceId: string) => {
      navigate(`/invoices/${invoiceId}/edit`);
    };

    const handlePrintInvoice = (invoiceId: string) => {
      // Open invoice in print mode
      window.open(`/invoices/${invoiceId}/edit?print=true`, '_blank');
    };

    const handleDeleteInvoice = async (invoiceId: string) => {
      setDeleting(invoiceId);
      try {
        await waterMitigationService.scopeInvoice.deleteInvoice(invoiceId);
        message.success('Invoice deleted and scope items reset');
        fetchInvoiceHistory();
        onInvoiceDeleted?.();
      } catch (error) {
        console.error('Failed to delete invoice:', error);
        message.error('Failed to delete invoice');
      } finally {
        setDeleting(null);
      }
    };

    const formatCurrency = (amount: number | undefined) => {
      if (amount === undefined || amount === null) return '$0.00';
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
      }).format(amount);
    };

    const formatDate = (dateString: string) => {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    };

    if (loading) {
      return (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin />
          <div style={{ marginTop: 8, color: '#8c8c8c', fontSize: 14 }}>Loading invoices...</div>
        </div>
      );
    }

    if (!invoiceHistory || invoiceHistory.invoices.length === 0) {
      return (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No invoices generated yet"
        >
          <Text type="secondary">
            Generate invoices from the Scope of Work tab
          </Text>
        </Empty>
      );
    }

    return (
      <div>
        {/* Summary Stats */}
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={12}>
            <Card size="small">
              <Statistic
                title="Total Invoices"
                value={invoiceHistory.invoice_count}
                prefix={<FileTextOutlined />}
              />
            </Card>
          </Col>
          <Col span={12}>
            <Card size="small">
              <Statistic
                title="Total Invoiced"
                value={invoiceHistory.total_invoiced}
                precision={2}
                prefix={<DollarOutlined />}
                valueStyle={{ color: '#52c41a' }}
              />
            </Card>
          </Col>
        </Row>

        {/* Invoice List */}
        <List
          dataSource={invoiceHistory.invoices}
          renderItem={(invoice: WMScopeInvoiceResponse) => (
            <List.Item
              actions={[
                <Button
                  key="view"
                  type="link"
                  icon={<EyeOutlined />}
                  onClick={() => handleViewInvoice(invoice.invoice_id)}
                >
                  View
                </Button>,
                <Button
                  key="print"
                  type="link"
                  icon={<PrinterOutlined />}
                  onClick={() => handlePrintInvoice(invoice.invoice_id)}
                >
                  Print
                </Button>,
                <Popconfirm
                  key="delete"
                  title="Delete Invoice"
                  description={
                    <div>
                      <p>Are you sure you want to delete this invoice?</p>
                      <p style={{ color: '#ff4d4f', fontSize: 12 }}>
                        This will also reset the scope items' invoiced status.
                      </p>
                    </div>
                  }
                  onConfirm={() => handleDeleteInvoice(invoice.invoice_id)}
                  okText="Delete"
                  cancelText="Cancel"
                  okButtonProps={{ danger: true }}
                >
                  <Button
                    type="link"
                    danger
                    icon={<DeleteOutlined />}
                    loading={deleting === invoice.invoice_id}
                  >
                    Delete
                  </Button>
                </Popconfirm>
              ]}
            >
              <List.Item.Meta
                avatar={
                  <div style={{
                    width: 48,
                    height: 48,
                    borderRadius: 8,
                    background: '#f6ffed',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <FileTextOutlined style={{ fontSize: 24, color: '#52c41a' }} />
                  </div>
                }
                title={
                  <Space>
                    <Text strong style={{ fontSize: 16 }}>
                      {invoice.invoice_number || 'Invoice'}
                    </Text>
                    <Tag color="green">
                      {formatCurrency(invoice.invoice_total)}
                    </Tag>
                    {invoice.item_links && invoice.item_links.length > 0 && (
                      <Tag color="blue">
                        {invoice.item_links.length} item{invoice.item_links.length !== 1 ? 's' : ''}
                      </Tag>
                    )}
                  </Space>
                }
                description={
                  <Space direction="vertical" size={0}>
                    <Text type="secondary">
                      <CalendarOutlined style={{ marginRight: 4 }} />
                      Generated: {formatDate(invoice.generated_at)}
                    </Text>
                    {invoice.notes && (
                      <Text type="secondary" ellipsis style={{ maxWidth: 400 }}>
                        {invoice.notes.replace(/<[^>]*>/g, '').substring(0, 100)}
                        {invoice.notes.length > 100 ? '...' : ''}
                      </Text>
                    )}
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </div>
    );
  }
);

WMInvoiceList.displayName = 'WMInvoiceList';

export default WMInvoiceList;
