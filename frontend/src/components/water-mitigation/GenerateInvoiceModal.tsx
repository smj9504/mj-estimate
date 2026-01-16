/**
 * Generate Invoice Modal for Water Mitigation Scope of Work
 *
 * Allows generating an invoice from scope items using a selected template.
 */

import React, { useState, useEffect } from 'react';
import {
  Modal,
  Form,
  Select,
  DatePicker,
  Input,
  Button,
  message,
  Alert,
  Spin,
  Typography,
  Space,
  Divider,
  Checkbox,
  Tag,
} from 'antd';
import {
  FileTextOutlined,
  DollarOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import waterMitigationService from '../../services/waterMitigationService';
import lineItemService from '../../services/lineItemService';
import type {
  ScopeLocation,
  ScopeItem,
  GenerateInvoiceRequest,
  GenerateInvoiceResponse,
} from '../../types/waterMitigation';
import type { LineItemTemplate } from '../../types/lineItem';

const { TextArea } = Input;
const { Text, Title } = Typography;

interface GenerateInvoiceModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: (result: GenerateInvoiceResponse) => void;
  jobId: string;
  jobCompanyId?: string | null;
  locations: ScopeLocation[];
}

interface ScopeItemWithLocation extends ScopeItem {
  locationName: string;
}

const GenerateInvoiceModal: React.FC<GenerateInvoiceModalProps> = ({
  visible,
  onClose,
  onSuccess,
  jobId,
  jobCompanyId,
  locations,
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [templates, setTemplates] = useState<LineItemTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(true);

  // Flatten scope items with location info
  const allItems: ScopeItemWithLocation[] = locations.flatMap(loc =>
    loc.scope_items.map(item => ({
      ...item,
      locationName: loc.name,
    }))
  );

  // Filter to only uninvoiced items
  const uninvoicedItems = allItems.filter(item => !(item as any).invoiced);

  // Load templates on mount
  useEffect(() => {
    if (visible) {
      loadTemplates();
      // Initialize with all uninvoiced items selected
      setSelectedItems(uninvoicedItems.map(item => item.id));
      setSelectAll(true);
    }
  }, [visible]);

  const loadTemplates = async () => {
    setLoadingTemplates(true);
    try {
      const data = await lineItemService.getTemplates();
      setTemplates(data);

      // Auto-select "Water Mitigation" template if exists
      const wmTemplate = data.find((t: LineItemTemplate) =>
        t.name.toLowerCase().includes('water mitigation') ||
        t.name.toLowerCase().includes('wm')
      );
      if (wmTemplate) {
        form.setFieldValue('template_id', wmTemplate.id);
      }
    } catch (error) {
      message.error('Failed to load templates');
    } finally {
      setLoadingTemplates(false);
    }
  };

  const handleSelectAllChange = (checked: boolean) => {
    setSelectAll(checked);
    if (checked) {
      setSelectedItems(uninvoicedItems.map(item => item.id));
    } else {
      setSelectedItems([]);
    }
  };

  const handleItemSelect = (itemId: string, checked: boolean) => {
    if (checked) {
      setSelectedItems(prev => [...prev, itemId]);
    } else {
      setSelectedItems(prev => prev.filter(id => id !== itemId));
    }
    setSelectAll(false);
  };

  // Reset invoice status for all scope items
  const handleResetInvoiceStatus = async () => {
    Modal.confirm({
      title: 'Reset Invoice Status',
      content: 'This will mark all scope items as uninvoiced, allowing you to generate a new invoice. Are you sure?',
      okText: 'Yes, Reset',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: async () => {
        setResetting(true);
        try {
          const result = await waterMitigationService.scopeInvoice.resetInvoiceStatus(jobId);
          if (result.success) {
            message.success(`${result.items_reset} scope item(s) reset successfully`);
            onClose();
            // Trigger parent refresh with a dummy response
            onSuccess({
              success: true,
              message: 'Invoice status reset',
              items_invoiced: 0,
              warnings: []
            });
          } else {
            message.error(result.message || 'Failed to reset invoice status');
          }
        } catch (error: any) {
          message.error(error.message || 'Failed to reset invoice status');
        } finally {
          setResetting(false);
        }
      },
    });
  };

  const handleSubmit = async () => {
    if (selectedItems.length === 0) {
      message.warning('Please select at least one item to invoice');
      return;
    }

    try {
      const values = await form.validateFields();
      setLoading(true);

      const request: GenerateInvoiceRequest = {
        job_id: jobId,
        template_id: values.template_id,
        billing_company_id: values.billing_company_id || jobCompanyId || undefined,
        invoice_date: values.invoice_date?.toISOString(),
        scope_item_ids: selectAll ? undefined : selectedItems,
        notes: values.notes,
      };

      const result = await waterMitigationService.scopeInvoice.generateInvoice(
        jobId,
        request
      );

      if (result.success) {
        message.success(`Invoice ${result.invoice_number} generated successfully!`);
        onSuccess(result);
        onClose();
        form.resetFields();
      } else {
        message.error(result.message);
      }

      // Show warnings if any
      if (result.warnings && result.warnings.length > 0) {
        result.warnings.forEach(warning => {
          message.warning(warning);
        });
      }
    } catch (error: any) {
      message.error(error.message || 'Failed to generate invoice');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={
        <Space>
          <FileTextOutlined />
          <span>Generate Invoice from Scope</span>
        </Space>
      }
      open={visible}
      onCancel={onClose}
      width={700}
      footer={[
        <Button key="cancel" onClick={onClose}>
          Cancel
        </Button>,
        <Button
          key="submit"
          type="primary"
          icon={<DollarOutlined />}
          loading={loading}
          onClick={handleSubmit}
          disabled={selectedItems.length === 0}
        >
          Generate Invoice
        </Button>,
      ]}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          invoice_date: dayjs(),
          billing_company_id: jobCompanyId,
        }}
      >
        {/* Template Selection */}
        <Form.Item
          name="template_id"
          label="Pricing Template"
          rules={[{ required: true, message: 'Please select a template' }]}
          tooltip="Select the template that contains pricing for scope items"
        >
          <Select
            placeholder="Select a pricing template"
            loading={loadingTemplates}
            showSearch
            filterOption={(input, option) =>
              (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
            options={templates.map(t => ({
              value: t.id,
              label: t.name,
            }))}
          />
        </Form.Item>

        {/* Invoice Date */}
        <Form.Item
          name="invoice_date"
          label="Invoice Date"
        >
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>

        {/* Notes */}
        <Form.Item
          name="notes"
          label="Notes (Optional)"
        >
          <TextArea
            rows={2}
            placeholder="Add any notes for this invoice..."
          />
        </Form.Item>

        <Divider orientation="left">
          <Space>
            <span>Scope Items to Invoice</span>
            <Tag color="blue">{selectedItems.length} selected</Tag>
          </Space>
        </Divider>

        {/* Select All Checkbox */}
        <div style={{ marginBottom: 12 }}>
          <Checkbox
            checked={selectAll}
            indeterminate={selectedItems.length > 0 && selectedItems.length < uninvoicedItems.length}
            onChange={e => handleSelectAllChange(e.target.checked)}
          >
            Select All Uninvoiced Items ({uninvoicedItems.length})
          </Checkbox>
        </div>

        {/* Items List */}
        {uninvoicedItems.length === 0 ? (
          <Alert
            type="warning"
            icon={<WarningOutlined />}
            message="No uninvoiced items"
            description={
              <Space direction="vertical" size="small">
                <span>All scope items have already been invoiced.</span>
                <Button
                  type="link"
                  icon={<ReloadOutlined />}
                  loading={resetting}
                  onClick={handleResetInvoiceStatus}
                  style={{ padding: 0 }}
                >
                  Reset invoice status to re-invoice
                </Button>
              </Space>
            }
            showIcon
          />
        ) : (
          <div
            style={{
              maxHeight: 300,
              overflowY: 'auto',
              border: '1px solid #d9d9d9',
              borderRadius: 4,
              padding: 8,
            }}
          >
            {locations.map(location => {
              const locationItems = uninvoicedItems.filter(
                item => item.location_id === location.id
              );

              if (locationItems.length === 0) return null;

              return (
                <div key={location.id} style={{ marginBottom: 16 }}>
                  <Text strong style={{ color: '#1890ff' }}>
                    {location.name}
                  </Text>
                  <div style={{ marginLeft: 16, marginTop: 8 }}>
                    {locationItems.map(item => (
                      <div key={item.id} style={{ marginBottom: 4 }}>
                        <Checkbox
                          checked={selectedItems.includes(item.id)}
                          onChange={e => handleItemSelect(item.id, e.target.checked)}
                        >
                          <Space>
                            <span>{item.name}</span>
                            {item.quantity && (
                              <Tag color="default">
                                {item.quantity} {item.unit}
                              </Tag>
                            )}
                          </Space>
                        </Checkbox>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Summary */}
        {selectedItems.length > 0 && (
          <Alert
            type="info"
            icon={<CheckCircleOutlined />}
            message={`${selectedItems.length} item(s) will be added to the invoice`}
            style={{ marginTop: 16 }}
            showIcon
          />
        )}
      </Form>
    </Modal>
  );
};

export default GenerateInvoiceModal;
