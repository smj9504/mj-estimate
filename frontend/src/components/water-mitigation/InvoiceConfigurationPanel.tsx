/**
 * Invoice Configuration Panel
 * Manages invoice item configurations for Water Mitigation scope items
 * - Map scope items to line items
 * - Configure quantity calculation (fixed, per_day, per_day_capped)
 * - Set default notes for line items
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Select,
  InputNumber,
  Input,
  Switch,
  Checkbox,
  message,
  Tooltip,
  Typography,
  Tag,
  Alert,
  Spin,
  Empty,
  Modal,
  Divider,
  Row,
  Col,
  Statistic,
  Dropdown,
  Collapse,
  Grid
} from 'antd';
import type { MenuProps } from 'antd';
import {
  SettingOutlined,
  SyncOutlined,
  DollarOutlined,
  CalendarOutlined,
  EditOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  FileTextOutlined,
  ReloadOutlined,
  DownOutlined,
  UndoOutlined,
  GiftOutlined
} from '@ant-design/icons';
import waterMitigationService from '../../services/waterMitigationService';
import lineItemService from '../../services/lineItemService';
import type {
  InvoiceItemConfig,
  InvoiceItemConfigUpdate,
  InvoicePreviewResponse,
  AutoGenerateConfigResult,
  GenerateInvoiceResponse
} from '../../types/waterMitigation';
import type { LineItem, EmbeddedItemData } from '../../types/lineItem';
import {
  QuantityCalcType,
  QUANTITY_CALC_TYPE_OPTIONS
} from '../../types/waterMitigation';

// Line item option for dropdown (standalone interface to avoid type conflicts)
interface LineItemOption {
  id: string;
  description: string;
  item?: string;
  unit?: string;
  untaxed_unit_price?: number;
  type?: string;
  is_active?: boolean;
  cat?: string;
  _isEmbedded?: boolean;
  _isFromTemplate?: boolean;
  _embeddedData?: EmbeddedItemData;
}

const { Text, Title } = Typography;
const { TextArea } = Input;
const { useBreakpoint } = Grid;

interface InvoiceConfigurationPanelProps {
  jobId: string;
  jobCompanyId?: string | null;
  mitigationDays?: number;
  scopeItemCount?: number;  // Number of scope items in the job
  onConfigChange?: () => void;
  onInvoiceGenerated?: (result: GenerateInvoiceResponse) => void;
}

const InvoiceConfigurationPanel: React.FC<InvoiceConfigurationPanelProps> = ({
  jobId,
  jobCompanyId,
  mitigationDays: mitigationDaysProp = 1,
  scopeItemCount = 0,
  onConfigChange,
  onInvoiceGenerated
}) => {
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  // State
  const [loading, setLoading] = useState(false);
  const [configs, setConfigs] = useState<InvoiceItemConfig[]>([]);
  const [lineItems, setLineItems] = useState<LineItemOption[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [loadingLineItems, setLoadingLineItems] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewData, setPreviewData] = useState<InvoicePreviewResponse | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [generatingInvoice, setGeneratingInvoice] = useState(false);
  const [resettingInvoice, setResettingInvoice] = useState(false);

  // Actual mitigation days (fetched from job or calculated)
  const [actualMitigationDays, setActualMitigationDays] = useState<number>(mitigationDaysProp);

  // Editing state
  const [editingCell, setEditingCell] = useState<{
    configId: string;
    field: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  // Track if auto-generate has been attempted this session
  const [autoGenerateAttempted, setAutoGenerateAttempted] = useState(false);

  // Holiday Premium state
  const [holidayPremium, setHolidayPremium] = useState(false);

  // Load configurations
  const loadConfigs = useCallback(async () => {
    try {
      setLoading(true);
      const response = await waterMitigationService.invoiceConfig.list(jobId, true);
      setConfigs(response.items);
      return response.items;
    } catch (error) {
      console.error('Failed to load invoice configs:', error);
      message.error('Failed to load invoice configurations');
      return [];
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  // Auto-select the best WM template (no user selection needed)
  const loadTemplates = useCallback(async () => {
    try {
      setLoadingLineItems(true);

      const allTemplates = await lineItemService.getTemplates();

      const wmTemplates = allTemplates.filter(
        (t) => t.name.toLowerCase().includes('water') ||
               t.name.toLowerCase().includes('wm') ||
               t.name.toLowerCase().includes('mitigation') ||
               t.name.toLowerCase().includes('essentials')
      );

      // Auto-select: WM Essentials (exact) → WM Essentials (partial) → any WM template → first template
      const bestTemplate =
        allTemplates.find(t => t.name === 'WM Essentials') ||
        allTemplates.find(t => t.name.toLowerCase().includes('wm essentials')) ||
        wmTemplates[0] ||
        allTemplates[0];

      if (bestTemplate) {
        setSelectedTemplateId(bestTemplate.id);
      }
    } catch (error) {
      console.error('[InvoiceConfig] Failed to load templates:', error);
      message.error('Failed to load templates. Please refresh the page.');
    } finally {
      setLoadingLineItems(false);
    }
  }, []);

  // Initial data loading
  useEffect(() => {
    const initializePanel = async () => {
      // Load templates first (line items will be loaded via useEffect when template is selected)
      await loadTemplates();
      // Then load configs
      const loadedConfigs = await loadConfigs();

      // If no configs exist and we haven't attempted auto-generate yet,
      // auto-generate when template is available
      if (loadedConfigs.length === 0 && !autoGenerateAttempted) {
        setAutoGenerateAttempted(true);
      }
    };

    initializePanel();
  }, [jobId]); // Only depend on jobId to avoid infinite loops

  // Fetch job data to get actual mitigation days
  useEffect(() => {
    const fetchJobData = async () => {
      try {
        const job = await waterMitigationService.getJob(jobId);
        if (job.mitigation_start_date && job.mitigation_end_date) {
          // Calculate days difference (inclusive)
          const startDate = new Date(job.mitigation_start_date);
          const endDate = new Date(job.mitigation_end_date);
          const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 for inclusive
          setActualMitigationDays(diffDays);
        } else if (job.mitigation_start_date) {
          // Only start date, count from start to today
          const startDate = new Date(job.mitigation_start_date);
          const today = new Date();
          const diffTime = Math.abs(today.getTime() - startDate.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
          setActualMitigationDays(diffDays);
        }
      } catch (error) {
        console.error('Failed to fetch job data for mitigation days:', error);
        // Keep using the prop value
      }
    };

    fetchJobData();
  }, [jobId]);

  // Reload line items when template changes
  useEffect(() => {
    const reloadLineItemsForTemplate = async () => {
      if (!selectedTemplateId) return;

      try {
        setLoadingLineItems(true);
        console.log('[InvoiceConfig] Loading template:', selectedTemplateId);
        const templateDetail = await lineItemService.getTemplate(selectedTemplateId);
        console.log('[InvoiceConfig] Template detail:', templateDetail);
        console.log('[InvoiceConfig] Template items:', templateDetail.template_items);

        const templateLineItems: LineItemOption[] = [];

        if (templateDetail.template_items) {
          for (const tli of templateDetail.template_items) {
            console.log('[InvoiceConfig] Processing TLI:', tli);
            if (tli.line_item) {
              // Reference mode: real line item from database
              console.log('[InvoiceConfig] Using line_item reference:', tli.line_item);
              templateLineItems.push({
                ...tli.line_item,
                _isEmbedded: false,
                _isFromTemplate: true, // Mark as from template for grouping
              } as LineItemOption);
            } else if (tli.embedded_data) {
              // Embedded mode: item data stored directly in template
              console.log('[InvoiceConfig] Using embedded_data:', tli.embedded_data);
              templateLineItems.push({
                id: tli.id, // This is template_line_item.id, NOT line_item.id
                description: tli.embedded_data.description || 'Unknown',
                item: tli.embedded_data.item_code || '',
                unit: tli.embedded_data.unit || 'EA',
                untaxed_unit_price: tli.embedded_data.rate || 0,
                type: 'CUSTOM',
                is_active: true,
                _isEmbedded: true, // Flag to identify embedded items
                _isFromTemplate: true, // Mark as from template for grouping
                _embeddedData: tli.embedded_data, // Store original embedded data
              } as LineItemOption);
            } else {
              console.log('[InvoiceConfig] TLI has neither line_item nor embedded_data');
            }
          }
        } else {
          console.log('[InvoiceConfig] No template_items found in template');
        }

        // Also load all line items from the library for full selection
        console.log('[InvoiceConfig] Loading all line items from library...');
        const allLineItems = await lineItemService.getLineItems({
          page: 1,
          is_active: true,
          page_size: 1000, // Get all active line items
        });
        console.log('[InvoiceConfig] All line items from library:', allLineItems.items?.length || 0);

        // Create a set of template item IDs to avoid duplicates
        const templateItemIds = new Set(templateLineItems.map(item => item.id));

        // Add library items that are not already in template
        const libraryItems: LineItemOption[] = (allLineItems.items || [])
          .filter(item => !templateItemIds.has(item.id))
          .map(item => ({
            ...item,
            _isEmbedded: false,
            _isFromTemplate: false,
          } as LineItemOption));

        // Combine: template items first, then library items
        const combinedLineItems = [...templateLineItems, ...libraryItems];
        console.log('[InvoiceConfig] Combined line items:', combinedLineItems.length,
          `(${templateLineItems.length} from template, ${libraryItems.length} from library)`);

        setLineItems(combinedLineItems);
      } catch (error) {
        console.error('[InvoiceConfig] Failed to reload line items for template:', error);
      } finally {
        setLoadingLineItems(false);
      }
    };

    reloadLineItemsForTemplate();
  }, [selectedTemplateId, jobCompanyId]);

  // Auto-generate when template is selected and configs are empty
  useEffect(() => {
    const tryAutoGenerate = async () => {
      if (
        autoGenerateAttempted &&
        selectedTemplateId &&
        configs.length === 0 &&
        !generating &&
        !loading
      ) {
        // Reset the flag so we don't try again unless user reloads
        setAutoGenerateAttempted(false);
        await handleAutoGenerateInternal(false);
      }
    };

    tryAutoGenerate();
  }, [autoGenerateAttempted, selectedTemplateId, configs.length, generating, loading]);

  // Internal auto-generate function (no validation, for automatic calls)
  const handleAutoGenerateInternal = async (
    overwrite: boolean = false,
    showMessages: boolean = true
  ) => {
    if (!selectedTemplateId) return;

    try {
      setGenerating(true);
      const result: AutoGenerateConfigResult =
        await waterMitigationService.invoiceConfig.autoGenerate(
          jobId,
          selectedTemplateId,
          overwrite
        );

      if (result.success) {
        if (showMessages) {
          // Build success message including GC items
          let successMsg = `Created ${result.created_count} configurations ` +
            `(${result.matched_count} matched to line items)`;

          if (result.general_conditions_created && result.general_conditions_created > 0) {
            successMsg += ` + ${result.general_conditions_created} General Conditions items`;
          }

          message.success(successMsg);

          if (result.unmatched_items.length > 0) {
            message.warning(
              `${result.unmatched_items.length} items could not be matched: ` +
              result.unmatched_items.slice(0, 3).join(', ') +
              (result.unmatched_items.length > 3 ? '...' : '')
            );
          }

          // Warn if no GC items were created and this might be due to empty template
          if (!result.general_conditions_created || result.general_conditions_created === 0) {
            console.log('[InvoiceConfig] No General Conditions items created. Template may need seeding.');
          }
        }

        await loadConfigs();
        onConfigChange?.();
      }
    } catch (error: any) {
      if (showMessages) {
        message.error(
          error.response?.data?.detail || 'Failed to auto-generate configurations'
        );
      }
      console.error('Auto-generate failed:', error);
    } finally {
      setGenerating(false);
    }
  };

  // Auto-generate configurations (user-triggered with validation)
  const handleAutoGenerate = async (overwrite: boolean = false) => {
    if (!selectedTemplateId) {
      message.warning('Please select a template first');
      return;
    }

    await handleAutoGenerateInternal(overwrite, true);
  };

  // Update configuration
  const handleUpdateConfig = async (
    configId: string,
    updates: InvoiceItemConfigUpdate
  ) => {
    try {
      setSaving(true);
      await waterMitigationService.invoiceConfig.update(configId, updates);
      message.success('Configuration updated');
      loadConfigs();
      onConfigChange?.();
    } catch (error) {
      message.error('Failed to update configuration');
    } finally {
      setSaving(false);
      setEditingCell(null);
    }
  };

  // Delete configuration
  const handleDeleteConfig = async (configId: string) => {
    try {
      await waterMitigationService.invoiceConfig.delete(configId);
      message.success('Configuration deleted');
      loadConfigs();
      onConfigChange?.();
    } catch (error) {
      message.error('Failed to delete configuration');
    }
  };

  // Preview invoice
  const handlePreview = async () => {
    if (!selectedTemplateId) {
      message.warning('Please select a template first');
      return;
    }

    try {
      setPreviewing(true);
      const preview = await waterMitigationService.invoiceConfig.previewInvoice(
        jobId,
        selectedTemplateId
      );
      setPreviewData(preview);
      setShowPreview(true);
    } catch (error) {
      message.error('Failed to generate preview');
    } finally {
      setPreviewing(false);
    }
  };

  // Generate invoice directly from configuration
  const handleGenerateInvoice = async () => {
    if (!selectedTemplateId) {
      message.warning('Please select a template first');
      return;
    }

    if (configs.filter(c => c.is_enabled).length === 0) {
      message.warning('No enabled items to invoice');
      return;
    }

    try {
      setGeneratingInvoice(true);
      const result = await waterMitigationService.scopeInvoice.generateInvoice(
        jobId,
        {
          job_id: jobId,
          template_id: selectedTemplateId,
          billing_company_id: jobCompanyId || undefined,
          holiday_premium: holidayPremium,
        }
      );

      if (result.success) {
        const premiumMsg = holidayPremium ? ' (with Holiday Premium)' : '';
        message.success(`Invoice ${result.invoice_number} generated successfully${premiumMsg}!`);
        setShowPreview(false);
        onInvoiceGenerated?.(result);
        onConfigChange?.();
      } else {
        message.error(result.message || 'Failed to generate invoice');
      }

      // Show warnings if any
      if (result.warnings && result.warnings.length > 0) {
        result.warnings.forEach(warning => {
          message.warning(warning);
        });
      }
    } catch (error: any) {
      message.error(error.response?.data?.detail || 'Failed to generate invoice');
    } finally {
      setGeneratingInvoice(false);
    }
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
        setResettingInvoice(true);
        try {
          const result = await waterMitigationService.scopeInvoice.resetInvoiceStatus(jobId);
          if (result.success) {
            message.success(`${result.items_reset} scope item(s) reset successfully`);
            onConfigChange?.();
          } else {
            message.error(result.message || 'Failed to reset invoice status');
          }
        } catch (error: any) {
          message.error(error.response?.data?.detail || 'Failed to reset invoice status');
        } finally {
          setResettingInvoice(false);
        }
      },
    });
  };

  // Table columns
  const columns = [
    {
      title: 'Scope Item',
      dataIndex: 'scope_item_name',
      key: 'scope_item_name',
      width: 180,
      render: (name: string, record: InvoiceItemConfig) => (
        <Text strong>{name || record.custom_name || 'Unknown'}</Text>
      )
    },
    {
      title: 'Line Item',
      dataIndex: 'line_item_description',
      key: 'line_item_description',
      width: 200,
      render: (desc: string, record: InvoiceItemConfig) => {
        const isEditing =
          editingCell?.configId === record.id &&
          editingCell?.field === 'line_item_id';

        if (isEditing) {
          return (
            <Select
              style={{ width: '100%' }}
              defaultValue={record.line_item_id}
              onChange={(value) => {
                // Find the selected item to check if it's embedded
                const selectedItem = lineItems.find(item => item.id === value);

                if (!value) {
                  // User cleared the selection - use null to explicitly clear
                  handleUpdateConfig(record.id, {
                    line_item_id: null,
                    custom_name: null,
                    custom_rate: null,
                    custom_unit: null,
                  });
                } else if (selectedItem?._isEmbedded) {
                  // Embedded item: use custom fields instead of line_item_id
                  console.log('[InvoiceConfig] Selected embedded item:', selectedItem);
                  handleUpdateConfig(record.id, {
                    line_item_id: null, // Clear line_item_id to avoid FK violation
                    custom_name: selectedItem.description,
                    custom_rate: Number(selectedItem.untaxed_unit_price) || 0,
                    custom_unit: selectedItem.unit || 'EA',
                  });
                } else {
                  // Reference item: use line_item_id
                  console.log('[InvoiceConfig] Selected reference item:', selectedItem);
                  handleUpdateConfig(record.id, {
                    line_item_id: value,
                    custom_name: null, // Clear custom fields
                    custom_rate: null,
                    custom_unit: null,
                  });
                }
              }}
              onBlur={() => setEditingCell(null)}
              autoFocus
              showSearch
              filterOption={(input, option) => {
                const item = lineItems.find(li => li.id === option?.value);
                const searchText = input.toLowerCase();
                return (
                  item?.description?.toLowerCase().includes(searchText) ||
                  item?.item?.toLowerCase().includes(searchText)
                ) ?? false;
              }}
              allowClear
              placeholder="Select line item..."
            >
              {lineItems.map(item => (
                <Select.Option key={item.id} value={item.id}>
                  {item.description}
                </Select.Option>
              ))}
            </Select>
          );
        }

        return (
          <Tooltip title="Click to change">
            <div
              onClick={() => setEditingCell({ configId: record.id, field: 'line_item_id' })}
              style={{ cursor: 'pointer', minHeight: 22 }}
            >
              {desc || record.custom_name ? (
                <Space>
                  <Text>{desc || record.custom_name}</Text>
                  {!record.line_item_id && (
                    <Tag color="orange" style={{ fontSize: 10 }}>Custom</Tag>
                  )}
                </Space>
              ) : (
                <Text type="secondary" italic>Click to select...</Text>
              )}
            </div>
          </Tooltip>
        );
      }
    },
    {
      title: 'Qty Type',
      dataIndex: 'quantity_calc_type',
      key: 'quantity_calc_type',
      width: 140,
      render: (calcType: string, record: InvoiceItemConfig) => {
        const isEditing =
          editingCell?.configId === record.id &&
          editingCell?.field === 'quantity_calc_type';

        if (isEditing) {
          return (
            <Select
              style={{ width: '100%' }}
              defaultValue={calcType}
              onChange={(value) => {
                handleUpdateConfig(record.id, { quantity_calc_type: value });
              }}
              onBlur={() => setEditingCell(null)}
              autoFocus
            >
              {QUANTITY_CALC_TYPE_OPTIONS.map(opt => (
                <Select.Option key={opt.value} value={opt.value}>
                  <Tooltip title={opt.description}>
                    {opt.label}
                  </Tooltip>
                </Select.Option>
              ))}
            </Select>
          );
        }

        const option = QUANTITY_CALC_TYPE_OPTIONS.find(o => o.value === calcType);
        const tagColor =
          calcType === 'per_day' ? 'blue' :
          calcType === 'per_day_capped' ? 'purple' : 'default';

        return (
          <Tooltip title={`Click to change. ${option?.description || ''}`}>
            <Tag
              color={tagColor}
              onClick={() => setEditingCell({ configId: record.id, field: 'quantity_calc_type' })}
              style={{ cursor: 'pointer' }}
            >
              {calcType === 'per_day' && <CalendarOutlined style={{ marginRight: 4 }} />}
              {option?.label || calcType}
            </Tag>
          </Tooltip>
        );
      }
    },
    {
      title: 'Quantity',
      key: 'quantity',
      width: 80,
      render: (_: any, record: InvoiceItemConfig) => (
        <Text>
          {record.calculated_quantity?.toFixed(2) || record.scope_item_quantity || 0}
          {' '}{record.scope_item_unit}
        </Text>
      )
    },
    {
      title: 'Rate',
      dataIndex: 'effective_rate',
      key: 'effective_rate',
      width: 80,
      render: (rate: number) => (
        <Text>${(rate || 0).toFixed(2)}</Text>
      )
    },
    {
      title: 'Amount',
      dataIndex: 'calculated_amount',
      key: 'calculated_amount',
      width: 100,
      render: (amount: number) => (
        <Text strong>${(amount || 0).toFixed(2)}</Text>
      )
    },
    {
      title: 'Note',
      dataIndex: 'default_note',
      key: 'default_note',
      width: 150,
      ellipsis: true,
      render: (note: string, record: InvoiceItemConfig) => {
        const isEditing =
          editingCell?.configId === record.id &&
          editingCell?.field === 'default_note';

        // Get the line item name to compare
        const lineItemName = record.line_item_description || record.custom_name || '';

        // Check if note is redundant (same as line item name or contains it with prefix like "General Conditions:")
        const isRedundantNote = (() => {
          if (!note || !lineItemName) return false;
          const noteLower = note.trim().toLowerCase();
          const nameLower = lineItemName.trim().toLowerCase();
          // Exact match
          if (noteLower === nameLower) return true;
          // Note contains line item name (e.g., "General Conditions: Emergency service call")
          if (noteLower.includes(nameLower)) return true;
          // Line item name contains note
          if (nameLower.includes(noteLower)) return true;
          return false;
        })();

        // Display note (hide if redundant)
        const displayNote = isRedundantNote ? null : note;

        if (isEditing) {
          return (
            <Input.TextArea
              style={{ width: '100%' }}
              defaultValue={note}
              rows={2}
              onBlur={(e) => {
                handleUpdateConfig(record.id, { default_note: e.target.value });
              }}
              onPressEnter={(e) => {
                e.preventDefault();
                handleUpdateConfig(record.id, {
                  default_note: (e.target as HTMLTextAreaElement).value
                });
              }}
              autoFocus
            />
          );
        }

        return (
          <Tooltip title={displayNote || 'Click to add note'}>
            <div
              onClick={() => setEditingCell({ configId: record.id, field: 'default_note' })}
              style={{ cursor: 'pointer', minHeight: 22 }}
            >
              {displayNote ? (
                <Text ellipsis style={{ maxWidth: 140 }}>{displayNote}</Text>
              ) : (
                <Text type="secondary" italic>Add note...</Text>
              )}
            </div>
          </Tooltip>
        );
      }
    },
    {
      title: 'Enabled',
      dataIndex: 'is_enabled',
      key: 'is_enabled',
      width: 80,
      render: (enabled: boolean, record: InvoiceItemConfig) => (
        <Switch
          checked={enabled}
          onChange={(checked) => {
            handleUpdateConfig(record.id, { is_enabled: checked });
          }}
          size="small"
        />
      )
    },
    {
      title: '',
      key: 'actions',
      width: 50,
      render: (_: any, record: InvoiceItemConfig) => (
        <Tooltip title="Delete configuration">
          <Button
            type="text"
            danger
            size="small"
            icon={<DeleteOutlined />}
            onClick={() => handleDeleteConfig(record.id)}
          />
        </Tooltip>
      )
    }
  ];

  // Calculate totals
  const totalAmount = configs
    .filter(c => c.is_enabled)
    .reduce((sum, c) => sum + (c.calculated_amount || 0), 0);

  const enabledCount = configs.filter(c => c.is_enabled).length;
  const unmatchedCount = configs.filter(c => !c.line_item_id && !c.custom_name).length;

  return (
    <Collapse
      defaultActiveKey={['invoice-config']}
      style={{ marginBottom: 16 }}
      className="invoice-config-collapse"
      items={[
        {
          key: 'invoice-config',
          label: (
            <Space size={4} wrap>
              <SettingOutlined />
              <Text strong style={{ whiteSpace: 'nowrap' }}>Invoice Configuration</Text>
              <Tag>{enabledCount}/{configs.length} items</Tag>
              <Text type="secondary" style={{ whiteSpace: 'nowrap' }}>${totalAmount.toFixed(2)}</Text>
            </Space>
          ),
          extra: isMobile ? (
            <Space size={4} onClick={(e) => e.stopPropagation()}>
              <Dropdown
                menu={{
                  items: [
                    {
                      key: 'regenerate',
                      label: 'Regenerate All',
                      icon: <ReloadOutlined />,
                      onClick: () => handleAutoGenerate(true)
                    },
                    {
                      key: 'generate-new',
                      label: 'Generate Missing Only',
                      icon: <SyncOutlined />,
                      onClick: () => handleAutoGenerate(false)
                    },
                    { type: 'divider' },
                    {
                      key: 'preview',
                      label: 'Preview Invoice',
                      icon: <FileTextOutlined />,
                      onClick: handlePreview,
                      disabled: !selectedTemplateId || configs.length === 0
                    },
                    {
                      key: 'holiday',
                      label: holidayPremium ? 'Holiday Premium ON' : 'Holiday Premium OFF',
                      icon: <GiftOutlined style={{ color: holidayPremium ? '#ff4d4f' : undefined }} />,
                      onClick: () => setHolidayPremium(!holidayPremium)
                    },
                    { type: 'divider' },
                    {
                      key: 'reset-invoice',
                      label: 'Reset Invoice Status',
                      icon: <UndoOutlined />,
                      danger: true,
                      onClick: handleResetInvoiceStatus
                    }
                  ]
                }}
              >
                <Button size="small" icon={<SettingOutlined />} loading={generating} />
              </Dropdown>
              <Button
                size="small"
                type="primary"
                icon={<DollarOutlined />}
                onClick={handleGenerateInvoice}
                loading={generatingInvoice}
                disabled={!selectedTemplateId || enabledCount === 0}
              >
                Invoice
              </Button>
            </Space>
          ) : (
            <Space wrap size={[8, 4]} onClick={(e) => e.stopPropagation()}>
              <Dropdown.Button
                size="small"
                icon={<DownOutlined />}
                menu={{
                  items: [
                    {
                      key: 'regenerate',
                      label: 'Regenerate All',
                      icon: <ReloadOutlined />,
                      onClick: () => handleAutoGenerate(true)
                    },
                    {
                      key: 'generate-new',
                      label: 'Generate Missing Only',
                      icon: <SyncOutlined />,
                      onClick: () => handleAutoGenerate(false)
                    },
                    {
                      type: 'divider'
                    },
                    {
                      key: 'reset-invoice',
                      label: 'Reset Invoice Status',
                      icon: <UndoOutlined />,
                      danger: true,
                      onClick: handleResetInvoiceStatus
                    }
                  ]
                }}
                onClick={() => handleAutoGenerate(true)}
                loading={generating}
                disabled={!selectedTemplateId}
              >
                <SyncOutlined spin={generating} /> Auto
              </Dropdown.Button>
              <Tooltip title="Preview">
                <Button
                  size="small"
                  icon={<FileTextOutlined />}
                  onClick={handlePreview}
                  loading={previewing}
                  disabled={!selectedTemplateId || configs.length === 0}
                />
              </Tooltip>
              <Divider type="vertical" />
              <Tooltip title="Apply 30% Holiday Premium surcharge">
                <Checkbox
                  checked={holidayPremium}
                  onChange={(e) => setHolidayPremium(e.target.checked)}
                >
                  <Space size={4}>
                    <GiftOutlined style={{ color: holidayPremium ? '#ff4d4f' : undefined }} />
                    <span style={{ fontSize: 12 }}>Holiday</span>
                  </Space>
                </Checkbox>
              </Tooltip>
              <Tooltip title="Generate Invoice">
                <Button
                  size="small"
                  type="primary"
                  icon={<DollarOutlined />}
                  onClick={handleGenerateInvoice}
                  loading={generatingInvoice}
                  disabled={!selectedTemplateId || enabledCount === 0}
                >
                  Generate
                </Button>
              </Tooltip>
            </Space>
          ),
          children: (
            <>
      {/* Summary Stats */}
      <Row gutter={[16, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Statistic
            title="Total Items"
            value={configs.length}
            suffix={`/ ${enabledCount} enabled`}
          />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic
            title="Estimated Total"
            value={totalAmount}
            precision={2}
            prefix="$"
          />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic
            title="Mitigation Days"
            value={actualMitigationDays}
            suffix="days"
          />
        </Col>
        <Col xs={12} sm={6}>
          {unmatchedCount > 0 ? (
            <Statistic
              title="Unmatched Items"
              value={unmatchedCount}
              valueStyle={{ color: '#faad14' }}
              prefix={<WarningOutlined />}
            />
          ) : (
            <Statistic
              title="Status"
              value="All Matched"
              valueStyle={{ color: '#52c41a', fontSize: isMobile ? 18 : undefined }}
              prefix={<CheckCircleOutlined />}
            />
          )}
        </Col>
      </Row>

      {/* Warnings for mitigation days and General Conditions */}
      {actualMitigationDays === 1 && configs.length > 0 && (
        <Alert
          message="Mitigation Period Not Set"
          description={
            <>
              Equipment quantities (Air Mover, Dehumidifier, Air Scrubber) are calculated based on mitigation days.
              Currently set to <strong>1 day</strong>. Please set the mitigation start and end dates in the Job Details
              for accurate per-day calculations.
            </>
          }
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      {/* Check if there are no General Conditions items */}
      {configs.length > 0 && configs.filter(c => c.location_name === 'General Conditions').length === 0 && (
        <Alert
          message="No General Conditions Items"
          description={
            <>
              General Conditions items (Emergency Service Call, Equipment Monitoring, etc.) are not configured.
              Try clicking <strong>Regenerate All</strong> or contact support if items still don't appear.
            </>
          }
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      {/* Configuration Table - Grouped by Location */}
      {loading || generating ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin />
          <div style={{ marginTop: 8, color: '#8c8c8c', fontSize: 14 }}>{generating ? 'Generating configurations...' : 'Loading...'}</div>
        </div>
      ) : configs.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            scopeItemCount === 0 ? (
              <span>
                No scope items found.
                <br />
                Please add scope items first in the Locations section above.
              </span>
            ) : !selectedTemplateId ? (
              <span>
                Please select a pricing template above.
                <br />
                This will enable auto-generation of configurations.
              </span>
            ) : (
              <span>
                No configurations yet.
                <br />
                <Button
                  type="link"
                  onClick={() => handleAutoGenerate(false)}
                  disabled={!selectedTemplateId}
                >
                  Click here to auto-generate from scope items
                </Button>
              </span>
            )
          }
        />
      ) : (
        (() => {
          // Group configs by location
          const groups = new Map<string, InvoiceItemConfig[]>();
          configs.forEach(c => {
            const key = c.location_name || 'General';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(c);
          });
          const groupKeys = Array.from(groups.keys());

          return (
            <Collapse
              defaultActiveKey={groupKeys}
              size="small"
              style={{ background: 'transparent' }}
              items={Array.from(groups.entries()).map(([location, items], index) => {
                const sectionTotal = items.reduce((sum, i) => sum + (i.calculated_amount || 0), 0);
                const enabledItems = items.filter(i => i.is_enabled).length;

                return {
                  key: location,
                  label: (
                    <Space>
                      <Text strong>{location}</Text>
                      <Tag>{enabledItems}/{items.length} items</Tag>
                      <Text type="secondary">${sectionTotal.toFixed(2)}</Text>
                    </Space>
                  ),
                  children: (
                    <Table
                      dataSource={items}
                      columns={columns}
                      rowKey="id"
                      size="small"
                      pagination={false}
                      scroll={{ x: 1000 }}
                      showHeader={index === 0}
                    />
                  )
                };
              })}
            />
          );
        })()
      )}

      {/* Preview Modal */}
      <Modal
        title="Invoice Preview"
        open={showPreview}
        onCancel={() => setShowPreview(false)}
        width={isMobile ? '95vw' : 800}
        footer={[
          <Button key="close" onClick={() => setShowPreview(false)}>
            Close
          </Button>,
          <Button
            key="generate"
            type="primary"
            icon={<DollarOutlined />}
            loading={generatingInvoice}
            onClick={handleGenerateInvoice}
          >
            Generate Invoice
          </Button>
        ]}
      >
        {previewData && (
          <>
            <Row gutter={[16, 12]} style={{ marginBottom: 16 }}>
              <Col xs={12} sm={8}>
                <Statistic
                  title="Subtotal"
                  value={previewData.subtotal}
                  precision={2}
                  prefix="$"
                />
              </Col>
              <Col xs={12} sm={8}>
                <Statistic
                  title="Total"
                  value={previewData.total}
                  precision={2}
                  prefix="$"
                  valueStyle={{ color: '#1890ff' }}
                />
              </Col>
              <Col xs={12} sm={8}>
                <Statistic
                  title="Mitigation Days"
                  value={previewData.mitigation_days}
                />
              </Col>
            </Row>

            {previewData.unmapped_items.length > 0 && (
              <Alert
                message="Unmapped Items"
                description={previewData.unmapped_items.join(', ')}
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
              />
            )}

            <Table
              dataSource={previewData.items}
              columns={[
                {
                  title: 'Item',
                  dataIndex: 'line_item_description',
                  key: 'line_item_description'
                },
                {
                  title: 'Location',
                  dataIndex: 'location_name',
                  key: 'location_name'
                },
                {
                  title: 'Calculation',
                  dataIndex: 'calculation_note',
                  key: 'calculation_note'
                },
                {
                  title: 'Rate',
                  dataIndex: 'rate',
                  key: 'rate',
                  render: (v: number) => `$${v.toFixed(2)}`
                },
                {
                  title: 'Amount',
                  dataIndex: 'amount',
                  key: 'amount',
                  render: (v: number) => `$${v.toFixed(2)}`
                }
              ]}
              rowKey={(_, index) => `preview-${index}`}
              size="small"
              pagination={false}
              scroll={isMobile ? { x: 600 } : undefined}
            />
          </>
        )}
      </Modal>
            </>
          )
        }
      ]}
    />
  );
};

export default InvoiceConfigurationPanel;
