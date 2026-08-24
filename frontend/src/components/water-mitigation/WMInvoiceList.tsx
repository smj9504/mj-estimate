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
  Spin,
  Dropdown,
  Grid,
  Modal,
} from 'antd';
import './WMDocumentInvoiceList.css';
import type { MenuProps } from 'antd';
import {
  FileTextOutlined,
  DollarOutlined,
  DeleteOutlined,
  EyeOutlined,
  DownloadOutlined,
  CalendarOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import waterMitigationService from '../../services/waterMitigationService';
import type { WMScopeInvoiceResponse, JobInvoiceHistoryResponse } from '../../types/waterMitigation';

const { Text, Title } = Typography;
const { useBreakpoint } = Grid;

interface WMInvoiceListProps {
  jobId: string;
  jobAddress?: string;
  onInvoiceDeleted?: () => void;
}

const WMInvoiceList = React.forwardRef<{ refresh: () => void }, WMInvoiceListProps>(
  ({ jobId, jobAddress, onInvoiceDeleted }, ref) => {
    const screens = useBreakpoint();
    const isMobile = !screens.md;
    const navigate = useNavigate();
    const [invoiceHistory, setInvoiceHistory] = useState<JobInvoiceHistoryResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [downloading, setDownloading] = useState<string | null>(null);
    const [previewing, setPreviewing] = useState<string | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewInvoice, setPreviewInvoice] = useState<WMScopeInvoiceResponse | null>(null);

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

    const handleDownloadPdf = async (invoice: WMScopeInvoiceResponse, templateVariant: string = 'a') => {
      setDownloading(invoice.invoice_id);
      try {
        const addr = (jobAddress || '').split(',')[0].trim();
        const invNum = invoice.invoice_number || 'unknown';
        const filename = `WM - ${addr} - ${invNum}.pdf`;
        await waterMitigationService.scopeInvoice.downloadPdf(jobId, invoice.invoice_id, filename, templateVariant);
        message.success('Invoice PDF downloaded');
      } catch (error) {
        console.error('Failed to download invoice PDF:', error);
        message.error('Failed to download invoice PDF');
      } finally {
        setDownloading(null);
      }
    };

    const handlePreviewInvoice = async (invoice: WMScopeInvoiceResponse) => {
      setPreviewing(invoice.invoice_id);
      try {
        const blob = await waterMitigationService.scopeInvoice.getPdfBlob(jobId, invoice.invoice_id, 'a');
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setPreviewInvoice(invoice);
      } catch (error) {
        console.error('Failed to preview invoice PDF:', error);
        message.error('Failed to preview invoice PDF');
      } finally {
        setPreviewing(null);
      }
    };

    const handleClosePreview = () => {
      setPreviewInvoice(null);
      setTimeout(() => {
        if (previewUrl) {
          URL.revokeObjectURL(previewUrl);
          setPreviewUrl(null);
        }
      }, 300);
    };

    const pdfVariantMenu = (invoice: WMScopeInvoiceResponse): MenuProps['items'] => [
      { key: 'a', label: 'Format A — Standard', onClick: () => handleDownloadPdf(invoice, 'a') },
      { key: 'b', label: 'Format B — Formal', onClick: () => handleDownloadPdf(invoice, 'b') },
      { key: 'c', label: 'Format C — Modern', onClick: () => handleDownloadPdf(invoice, 'c') },
    ];

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
          itemLayout={isMobile ? 'vertical' : 'horizontal'}
          renderItem={(invoice: WMScopeInvoiceResponse) => (
            <List.Item
              className="wm-list-item"
              actions={[
                <Button
                  key="preview"
                  type="link"
                  icon={<EyeOutlined />}
                  loading={previewing === invoice.invoice_id}
                  onClick={() => handlePreviewInvoice(invoice)}
                >
                  Preview
                </Button>,
                <Button
                  key="view"
                  type="link"
                  onClick={() => handleViewInvoice(invoice.invoice_id)}
                >
                  Edit
                </Button>,
                <Dropdown
                  key="download"
                  menu={{ items: pdfVariantMenu(invoice) }}
                  trigger={['click']}
                >
                  <Button
                    type="link"
                    icon={<DownloadOutlined />}
                    loading={downloading === invoice.invoice_id}
                  >
                    PDF ▾
                  </Button>
                </Dropdown>,
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
                style={{ minWidth: 0 }}
                avatar={
                  <div style={{
                    width: 48,
                    height: 48,
                    borderRadius: 8,
                    background: '#f6ffed',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <FileTextOutlined style={{ fontSize: 24, color: '#52c41a' }} />
                  </div>
                }
                title={
                  <Space wrap size={[8, 4]} style={{ minWidth: 0 }}>
                    <Text strong style={{ fontSize: 16, wordBreak: 'break-word', overflowWrap: 'break-word' }}>
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
                  <Space direction="vertical" size={0} style={{ width: '100%', minWidth: 0 }}>
                    <Text type="secondary">
                      <CalendarOutlined style={{ marginRight: 4 }} />
                      Generated: {formatDate(invoice.generated_at)}
                    </Text>
                    {invoice.notes && (
                      <Text type="secondary" ellipsis style={{ maxWidth: '100%' }}>
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

        <Modal
          title={previewInvoice ? `Invoice Preview — ${previewInvoice.invoice_number || 'Invoice'}` : 'Invoice Preview'}
          open={!!previewInvoice}
          onCancel={handleClosePreview}
          footer={[
            <Button key="close" onClick={handleClosePreview}>
              Close
            </Button>,
            <Button
              key="download"
              type="primary"
              icon={<DownloadOutlined />}
              loading={previewInvoice ? downloading === previewInvoice.invoice_id : false}
              onClick={() => previewInvoice && handleDownloadPdf(previewInvoice, 'a')}
            >
              Download PDF
            </Button>,
          ]}
          width="90vw"
          style={{ top: 20 }}
          styles={{ body: { height: 'calc(90vh - 110px)', padding: 0 } }}
        >
          {previewUrl && (
            <iframe
              src={previewUrl}
              style={{ width: '100%', height: '100%', border: 'none' }}
              title="Invoice Preview"
            />
          )}
        </Modal>
      </div>
    );
  }
);

WMInvoiceList.displayName = 'WMInvoiceList';

export default WMInvoiceList;
