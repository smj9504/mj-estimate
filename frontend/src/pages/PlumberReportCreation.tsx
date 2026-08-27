import React, { useState, useEffect, useCallback } from 'react';
import {
  Form,
  Input,
  Button,
  DatePicker,
  InputNumber,
  Select,
  Card,
  Row,
  Col,
  Space,
  Table,
  Modal,
  message,
  Divider,
  Switch,
  Checkbox,
  Typography,
  Tooltip,
  Popconfirm,
  Spin,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  SaveOutlined,
  EyeOutlined,
  EditOutlined,
  HolderOutlined,
  FileTextOutlined,
  ClearOutlined,
  CopyOutlined,
  RobotOutlined,
  CalendarOutlined,
  SendOutlined,
  MailOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import {
  plumberReportService,
  PlumberReport,
  InvoiceItem,
  PaymentRecord,
  PhotoRecord,
  PAEmailInfo,
} from '../services/plumberReportService';
import AddressAutocomplete from '../components/common/AddressAutocomplete';
import { companyService } from '../services/companyService';
import { clientService, claimService } from '../services/clientService';
import { Company } from '../types';
import type { Client, ClientListItem, Claim } from '../types/client';
import RichTextEditor from '../components/editor/RichTextEditor';
import UnitSelect from '../components/common/UnitSelect';
import DraggableTable from '../components/common/DraggableTable';
import TemplateSelector from '../components/plumber-report/TemplateSelector';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { Option } = Select;

// Normalizes a free-text address State into MD/VA/DC, or null if it can't be
// resolved confidently. Used to derive AI-generation tax state from the
// existing client/property address instead of a separate (and easy to skip
// or silently default) input field.
const normalizeUsState = (raw?: string | null): 'MD' | 'VA' | 'DC' | null => {
  const s = (raw || '').trim().toUpperCase();
  if (s === 'MD' || s === 'MARYLAND') return 'MD';
  if (s === 'VA' || s === 'VIRGINIA') return 'VA';
  if (['DC', 'D.C.', 'WASHINGTON DC', 'WASHINGTON, DC', 'DISTRICT OF COLUMBIA'].includes(s)) return 'DC';
  return null;
};

const PlumberReportCreation: React.FC = () => {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const presetClient = (location.state as { presetClient?: Client } | null)?.presetClient;

  // Loading states - separate for different operations
  const [isDataLoading, setIsDataLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [invoiceItems, setInvoiceItems] = useState<InvoiceItem[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [showPaymentDates, setShowPaymentDates] = useState(true);
  const [templateType, setTemplateType] = useState('standard');
  
  // Prompt modal state
  const [promptModalVisible, setPromptModalVisible] = useState(false);
  const [jsonPasteModalVisible, setJsonPasteModalVisible] = useState(false);
  const [jsonPasteValue, setJsonPasteValue] = useState('');
  const [aiGenerateModalVisible, setAiGenerateModalVisible] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiStep, setAiStep] = useState<string>('');
  const [aiForm] = Form.useForm();

  // AI generation runs 15-25s+ in the background — closing/reloading the tab
  // mid-request strands the result with nowhere to land when it resolves.
  useEffect(() => {
    if (!aiGenerating) return;
    const warnBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [aiGenerating]);

  // Modal states
  const [itemModalVisible, setItemModalVisible] = useState(false);
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<InvoiceItem | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [itemForm] = Form.useForm();
  const [paymentForm] = Form.useForm();
  const [itemDescription, setItemDescription] = useState('');

  // Text input values
  const [siteFindings, setSiteFindings] = useState('');
  const [workPerformed, setWorkPerformed] = useState('');
  const [warrantyInfo, setWarrantyInfo] = useState('');
  const [termsConditions, setTermsConditions] = useState('');
  const [notes, setNotes] = useState('');

  // Client search
  const [clientSearch, setClientSearch] = useState('');
  const [clientSearchResults, setClientSearchResults] = useState<ClientListItem[]>([]);
  const [isClientSearching, setIsClientSearching] = useState(false);

  // Claim linking
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [clientClaims, setClientClaims] = useState<Claim[]>([]);
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);

  // Send to PA
  const [sendPAVisible, setSendPAVisible] = useState(false);
  const [sendPALoading, setSendPALoading] = useState(false);
  const [paEmailInfo, setPaEmailInfo] = useState<PAEmailInfo | null>(null);
  const [paForm] = Form.useForm();

  // Property same as client toggle
  const [propertyDifferent, setPropertyDifferent] = useState(false);

  // Derive AI-generation tax state from the client/property address already
  // on this form — reactive via useWatch so it updates as the user types.
  const watchedClientState = Form.useWatch('state', form);
  const watchedPropertyState = Form.useWatch('property_state', form);
  const resolvedAiState = normalizeUsState(
    propertyDifferent ? watchedPropertyState : watchedClientState
  );

  // Drag and drop states
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  // Template selection states
  const [selectedWarrantyTemplate, setSelectedWarrantyTemplate] = useState<any>(null);
  const [selectedTermsTemplate, setSelectedTermsTemplate] = useState<any>(null);
  const [selectedNotesTemplate, setSelectedNotesTemplate] = useState<any>(null);

  // Load companies only once on mount
  useEffect(() => {
    const loadCompanies = async () => {
      try {
        const data = await companyService.getCompanies();
        setCompanies(data);
        if (data.length > 0 && !id) {
          setSelectedCompany(data[0]);
          form.setFieldsValue({
            company_id: data[0].id,
          });

          // Generate report number for the first company
          try {
            const reportNumber = await plumberReportService.generateReportNumber(data[0].id);
            form.setFieldsValue({
              report_number: reportNumber
            });
          } catch (error) {
            console.error('Failed to generate report number:', error);
            // Fallback to manual generation
            const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
            form.setFieldsValue({
              report_number: `PLM-${timestamp}`
            });
          }
        }
      } catch (error) {
        console.error('Failed to load companies:', error);
      }
    };

    loadCompanies();
  }, []); // Empty dependency array - runs only once on mount

  // Client search with debounce
  useEffect(() => {
    if (clientSearch.length < 2) {
      setClientSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        setIsClientSearching(true);
        const result = await clientService.search(clientSearch, 20);
        setClientSearchResults(result.clients || []);
      } catch {
        setClientSearchResults([]);
      } finally {
        setIsClientSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [clientSearch]);

  const handleClientSelect = useCallback(async (clientId: string) => {
    const client = clientSearchResults.find((c) => c.id === clientId);
    if (client) {
      let street = client.address || '';
      let city = client.city || '';
      let state = client.state || '';
      let zipcode = client.zipcode || '';

      // Parse address string if city/state/zipcode are empty
      // Supports: "Street, City, State Zip" or "Street, City State Zip"
      if (street && !city && !state && !zipcode) {
        const parts = street.split(',').map((p) => p.trim());
        if (parts.length >= 3) {
          // "5213 Ashcroft Ct, Fairfax, VA 22032"
          street = parts[0];
          city = parts[1];
          const lastPart = parts[parts.length - 1];
          const stateZipMatch = lastPart.match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
          if (stateZipMatch) {
            state = stateZipMatch[1];
            zipcode = stateZipMatch[2];
          } else {
            state = lastPart;
          }
        } else if (parts.length === 2) {
          // "9512 Ash Hollow Pl, Gaithersburg MD 20886-1239"
          street = parts[0];
          const lastPart = parts[1];
          // Try "State Zip" first (e.g. "VA 22032")
          const stateZipOnly = lastPart.match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
          if (stateZipOnly) {
            state = stateZipOnly[1];
            zipcode = stateZipOnly[2];
          } else {
            // Try "City State Zip" (e.g. "Gaithersburg MD 20886-1239")
            const cityStateZip = lastPart.match(/^(.+?)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
            if (cityStateZip) {
              city = cityStateZip[1];
              state = cityStateZip[2];
              zipcode = cityStateZip[3];
            } else {
              city = lastPart;
            }
          }
        }
      }

      form.setFieldsValue({
        name: client.display_name,
        address: street,
        city,
        state,
        zipcode,
        phone: client.phone || '',
        email: client.email || '',
      });

      // Fetch claims for this client
      setSelectedClientId(clientId);
      setSelectedClaimId(null);
      setClientClaims([]);
      try {
        const result = await claimService.listByClient(clientId);
        const claims = result.claims || [];
        setClientClaims(claims);
        // Auto-select if only one claim
        if (claims.length === 1) {
          setSelectedClaimId(claims[0].id);
        }
      } catch {
        // Client may not have claims yet
      }
    }
  }, [clientSearchResults, form]);

  // Prefill client info when navigated here from a client's detail page
  useEffect(() => {
    if (id || !presetClient) return;

    const owner = presetClient.owners?.find((o) => o.is_primary) || presetClient.owners?.[0];
    form.setFieldsValue({
      name: presetClient.display_name,
      address: presetClient.address || '',
      city: presetClient.city || '',
      state: presetClient.state || '',
      zipcode: presetClient.zipcode || '',
      phone: presetClient.phone || owner?.phone || '',
      email: presetClient.email || owner?.email || '',
    });

    setSelectedClientId(presetClient.id);
    setClientSearchResults([presetClient as unknown as ClientListItem]);
    setSelectedClaimId(null);
    setClientClaims([]);
    claimService.listByClient(presetClient.id).then((result) => {
      const claims = result.claims || [];
      setClientClaims(claims);
      if (claims.length === 1) {
        setSelectedClaimId(claims[0].id);
      }
    }).catch(() => {
      // Client may not have claims yet
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, presetClient, form]);

  const [isDolLoading, setIsDolLoading] = useState(false);
  const handleFetchDateOfLoss = useCallback(async () => {
    const addr = form.getFieldValue('address') || '';
    const name = form.getFieldValue('name') || '';
    if (!addr && !name) {
      message.warning('Please enter client info first');
      return;
    }
    setIsDolLoading(true);
    try {
      // Search WM jobs by address or homeowner name
      const searchTerm = addr || name;
      const { data } = await (await import('../services/api')).default.get('/api/water-mitigation/jobs', {
        params: { search: searchTerm, page_size: 10 },
      });
      const jobs = data?.items || [];
      const jobsWithDol = jobs.filter((j: any) => j.date_of_loss);
      if (jobsWithDol.length > 0) {
        // Sort desc and pick latest
        jobsWithDol.sort((a: any, b: any) => new Date(b.date_of_loss).getTime() - new Date(a.date_of_loss).getTime());
        const parsed = dayjs(jobsWithDol[0].date_of_loss);
        if (parsed.isValid()) {
          form.setFieldsValue({ service_date: parsed });
          message.success(`Service Date set to ${parsed.format('MM/DD/YYYY')} (Date of Loss)`);
        }
      } else {
        message.info('No Water Mitigation date of loss found for this client');
      }
    } catch (err) {
      console.error('Failed to fetch date of loss:', err);
      message.error('Failed to fetch date of loss');
    } finally {
      setIsDolLoading(false);
    }
  }, [form]);

  // Load report when ID is available and companies are loaded
  useEffect(() => {
    if (!id || companies.length === 0) return;
    
    const loadReport = async () => {
      try {
        setIsDataLoading(true);
        const report = await plumberReportService.getReport(id);
        
        // Check if property is different from client
        const isDifferent = 
          report.property.address !== report.client.address ||
          report.property.city !== report.client.city ||
          report.property.state !== report.client.state ||
          report.property.zipcode !== report.client.zipcode;
        
        setPropertyDifferent(isDifferent);
        
        // Set form values
        form.setFieldsValue({
          report_number: report.report_number,
          template_type: report.template_type,
          company_id: report.company_id,
          service_date: report.service_date ? dayjs(report.service_date) : undefined,
          technician_name: report.technician_name,
          license_number: report.license_number,
          ...report.client,
          property_address: report.property.address,
          property_city: report.property.city,
          property_state: report.property.state,
          property_zipcode: report.property.zipcode,
          labor_cost: report.financial?.labor_cost,
          tax_amount: report.financial?.tax_amount,
          discount: report.financial?.discount,
        });

        // Set text content
        setSiteFindings(report.cause_of_damage || '');
        setWorkPerformed(report.work_performed || '');
        setWarrantyInfo(report.warranty_info || '');
        setTermsConditions(report.terms_conditions || '');
        setNotes(report.notes || '');

        // Set other states
        setInvoiceItems(report.invoice_items || []);
        setPayments(report.payments || []);
        setPhotos(report.photos || []);
        setShowPaymentDates(report.show_payment_dates ?? true);
        setTemplateType(report.template_type || 'standard');

        if (report.company_id) {
          const company = companies.find(c => c.id === report.company_id);
          if (company) {
            setSelectedCompany(company);
          }
        }

        // Restore claim link
        if (report.claim_id) {
          setSelectedClaimId(report.claim_id);
        }
      } catch (error) {
        message.error('Failed to load report');
        console.error(error);
      } finally {
        setIsDataLoading(false);
      }
    };

    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, companies.length]); // Only re-run when id changes or companies are loaded

  const handleCompanyChange = async (companyId: string) => {
    const company = companies.find(c => c.id === companyId);
    if (company) {
      setSelectedCompany(company);

      // Generate new report number when company is selected
      try {
        const reportNumber = await plumberReportService.generateReportNumber(companyId);
        form.setFieldsValue({
          report_number: reportNumber
        });
      } catch (error) {
        console.error('Failed to generate report number:', error);
        // Fallback to manual generation
        const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
        form.setFieldsValue({
          report_number: `PLM-${timestamp}`
        });
      }
    }
  };

  const handleAddItem = () => {
    itemForm.resetFields();
    setEditingItem(null);
    setEditingIndex(null);
    setItemDescription('');
    setItemModalVisible(true);
  };

  const handleEditItem = (item: InvoiceItem, index: number) => {
    setEditingItem(item);
    setEditingIndex(index);
    itemForm.setFieldsValue(item);
    setItemDescription(item.description || '');
    setItemModalVisible(true);
  };

  const handleItemSubmit = () => {
    itemForm.validateFields().then(values => {
      const newItem: InvoiceItem = {
        id: editingItem?.id || crypto.randomUUID(),
        ...values,
        description: itemDescription,
        total_cost: values.quantity * values.unit_cost,
      };

      if (editingIndex !== null) {
        const updated = [...invoiceItems];
        updated[editingIndex] = newItem;
        setInvoiceItems(updated);
      } else {
        setInvoiceItems([...invoiceItems, newItem]);
      }

      setItemModalVisible(false);
      itemForm.resetFields();
      setEditingItem(null);
      setEditingIndex(null);
      setItemDescription('');
    });
  };

  const handleDeleteItem = (index: number) => {
    const updated = invoiceItems.filter((_, i) => i !== index);
    setInvoiceItems(updated);
  };

  const handleAddPayment = () => {
    paymentForm.resetFields();
    paymentForm.setFieldsValue({
      date: dayjs().format('YYYY-MM-DD'),
    });
    setPaymentModalVisible(true);
  };

  const handlePaymentSubmit = () => {
    paymentForm.validateFields().then(values => {
      const newPayment: PaymentRecord = {
        ...values,
        date: values.date || dayjs().format('YYYY-MM-DD'),
      };
      setPayments([...payments, newPayment]);
      setPaymentModalVisible(false);
      paymentForm.resetFields();
    });
  };

  const handleDeletePayment = (index: number) => {
    const updated = payments.filter((_, i) => i !== index);
    setPayments(updated);
  };

  // Drag and drop sensors and handlers
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveItemId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      setActiveItemId(null);
      return;
    }

    const activeIndex = invoiceItems.findIndex((_, index) => `item-${index}` === active.id);
    const overIndex = invoiceItems.findIndex((_, index) => `item-${index}` === over.id);

    if (activeIndex !== -1 && overIndex !== -1) {
      const reorderedItems = arrayMove(invoiceItems, activeIndex, overIndex);
      setInvoiceItems(reorderedItems);
    }

    setActiveItemId(null);
  };

  // Strip HTML tags and check if content has actual text
  const cleanHtml = (html: string): string => {
    if (!html) return '';
    const text = html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    return text.length > 0 ? html : '';
  };

  const calculateTotals = () => {
    const subtotal = invoiceItems.reduce((sum, item) => sum + item.total_cost, 0);
    const taxAmount = form.getFieldValue('tax_amount') || 0;
    const discount = form.getFieldValue('discount') || 0;
    const total = subtotal + taxAmount - discount;
    const totalPaid = payments.reduce((sum, payment) => sum + payment.amount, 0);
    const balance_due = total - totalPaid;

    return {
      labor_cost: 0,
      materials_cost: 0,
      equipment_cost: 0,
      subtotal,
      tax_amount: taxAmount,
      discount,
      total_amount: total,
      balance_due,
    };
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      const values = await form.validateFields();

      const totals = calculateTotals();
      const reportData: PlumberReport = {
        report_number: values.report_number || plumberReportService.generateReportNumber(),
        template_type: templateType,
        status: 'final',
        company_id: values.company_id,
        claim_id: selectedClaimId || undefined,
        client: {
          name: values.name,
          address: values.address,
          city: values.city,
          state: values.state,
          zipcode: values.zipcode,
          phone: values.phone,
          email: values.email,
        },
        property: {
          address: values.property_address || values.address,
          city: values.property_city || values.city,
          state: values.property_state || values.state,
          zipcode: values.property_zipcode || values.zipcode,
        },
        service_date: values.service_date ? values.service_date.format('YYYY-MM-DDTHH:mm:ss') : dayjs().format('YYYY-MM-DDTHH:mm:ss'),
        technician_name: values.technician_name,
        license_number: values.license_number,
        cause_of_damage: cleanHtml(siteFindings),
        work_performed: cleanHtml(workPerformed),
        invoice_items: invoiceItems,
        financial: totals,
        payments,
        show_payment_dates: showPaymentDates,
        photos,
        warranty_info: cleanHtml(warrantyInfo),
        terms_conditions: cleanHtml(termsConditions),
        notes: cleanHtml(notes),
      };

      let response;
      if (id) {
        response = await plumberReportService.updateReport(id, reportData);
      } else {
        response = await plumberReportService.createReport(reportData);
      }

      message.success(`Report ${id ? 'updated' : 'created'} successfully!`);
      navigate(`/plumber-reports/${response.id}`);
    } catch (error) {
      message.error(`Failed to ${id ? 'update' : 'create'} report`);
      console.error(error);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePreviewPDF = async () => {
    try {
      setIsPreviewing(true);
      const values = await form.validateFields();
      const totals = calculateTotals();

      const reportData: PlumberReport = {
        report_number: values.report_number || plumberReportService.generateReportNumber(),
        template_type: templateType,
        company_data: selectedCompany,
        client: {
          name: values.name,
          address: values.address,
          city: values.city,
          state: values.state,
          zipcode: values.zipcode,
          phone: values.phone,
          email: values.email,
        },
        property: {
          address: values.property_address || values.address,
          city: values.property_city || values.city,
          state: values.property_state || values.state,
          zipcode: values.property_zipcode || values.zipcode,
        },
        service_date: values.service_date ? values.service_date.format('YYYY-MM-DDTHH:mm:ss') : dayjs().format('YYYY-MM-DDTHH:mm:ss'),
        technician_name: values.technician_name,
        license_number: values.license_number,
        cause_of_damage: cleanHtml(siteFindings),
        work_performed: cleanHtml(workPerformed),
        invoice_items: invoiceItems,
        financial: totals,
        payments,
        show_payment_dates: showPaymentDates,
        photos,
        warranty_info: cleanHtml(warrantyInfo),
        terms_conditions: cleanHtml(termsConditions),
        notes: cleanHtml(notes),
      };

      const htmlContent = await plumberReportService.previewHTML(reportData, {
        include_photos: true,
        include_financial: true,
      });

      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (error) {
      message.error('Failed to generate preview');
      console.error(error);
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleJsonImport = useCallback(() => {
    try {
      const data = JSON.parse(jsonPasteValue);

      // Site Findings & Assessment
      if (data.site_findings) setSiteFindings(data.site_findings);

      // Work Performed
      if (data.work_performed) setWorkPerformed(data.work_performed);

      // Technician
      if (data.technician_name) form.setFieldsValue({ technician_name: data.technician_name });
      if (data.license_number) form.setFieldsValue({ license_number: data.license_number });

      // Invoice items
      if (data.invoice_items && Array.isArray(data.invoice_items)) {
        const items: InvoiceItem[] = data.invoice_items.map((item: any) => ({
          id: crypto.randomUUID(),
          name: item.name || '',
          description: item.description || '',
          quantity: item.quantity || 1,
          unit: item.unit || 'EA',
          unit_cost: item.unit_cost || 0,
          total_cost: (item.quantity || 1) * (item.unit_cost || 0),
        }));
        setInvoiceItems(items);
      }

      // Financial
      if (data.tax_amount !== undefined) form.setFieldsValue({ tax_amount: data.tax_amount });
      if (data.discount !== undefined) form.setFieldsValue({ discount: data.discount });

      // Warranty / Terms / Notes
      if (data.warranty_info) setWarrantyInfo(data.warranty_info);
      if (data.terms_conditions) setTermsConditions(data.terms_conditions);
      if (data.notes) setNotes(data.notes);

      setJsonPasteModalVisible(false);
      setJsonPasteValue('');
      message.success('JSON data imported successfully');
    } catch {
      message.error('Invalid JSON format. Please check and try again.');
    }
  }, [jsonPasteValue, form]);

  // Persist AI Generate modal inputs so they survive generation, navigation, and page reloads
  const aiFormStorageKey = `plumberReportAiDraft_${id || 'new'}`;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(aiFormStorageKey);
      if (saved) {
        aiForm.setFieldsValue(JSON.parse(saved));
      }
    } catch (error) {
      console.error('Failed to restore AI form draft:', error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAiFormValuesChange = useCallback(() => {
    try {
      localStorage.setItem(aiFormStorageKey, JSON.stringify(aiForm.getFieldsValue()));
    } catch (error) {
      console.error('Failed to save AI form draft:', error);
    }
  }, [aiForm, aiFormStorageKey]);

  const handleClearAiForm = useCallback(() => {
    aiForm.resetFields();
    try {
      localStorage.removeItem(aiFormStorageKey);
    } catch (error) {
      console.error('Failed to clear AI form draft:', error);
    }
  }, [aiForm, aiFormStorageKey]);

  const handleAiGenerate = useCallback(async () => {
    try {
      const values = await aiForm.validateFields();

      if (!resolvedAiState) {
        message.error('Please enter a valid client/property State (MD, VA, or DC) before generating — it determines the materials tax calculation.');
        return;
      }

      setAiGenerating(true);
      setAiStep('Step 1/2: Analyzing scope & writing assessment...');

      const data = await plumberReportService.generateAI({
        incident_type: values.incident_type,
        location: values.location,
        wall_access_type: values.wall_access_type,
        pipe_material: values.pipe_material,
        state: resolvedAiState,
        detached_fixture: values.detached_fixture || '',
        fixture_reinstalled: values.fixture_reinstalled !== false,
      });

      // The backend runs both steps — update UI to reflect completion
      setAiStep('Applying results...');

      // Apply generated data to form
      if (data.site_findings) setSiteFindings(data.site_findings);
      if (data.work_performed) setWorkPerformed(data.work_performed);

      if (data.invoice_items && Array.isArray(data.invoice_items)) {
        const items: InvoiceItem[] = data.invoice_items.map((item: any) => ({
          id: crypto.randomUUID(),
          name: item.name || '',
          description: item.description || '',
          quantity: item.quantity || 1,
          unit: item.unit || 'EA',
          unit_cost: item.unit_cost || 0,
          total_cost: (item.quantity || 1) * (item.unit_cost || 0),
        }));
        setInvoiceItems(items);
      }

      if (data.tax_amount !== undefined) form.setFieldsValue({ tax_amount: data.tax_amount });
      if (data.warranty_info) setWarrantyInfo(data.warranty_info);
      if (data.notes) setNotes(data.notes);

      setAiGenerateModalVisible(false);
      message.success('AI report generated (2-step: scope → invoice)');
    } catch (error: any) {
      if (error?.errorFields) return; // form validation error
      console.error('[AI Generate] failed:', error);
      message.error(error?.response?.data?.detail || 'AI generation failed. Please try again.');
    } finally {
      setAiGenerating(false);
      setAiStep('');
    }
  }, [aiForm, form, resolvedAiState]);

  const totals = calculateTotals();

  // Show loading spinner when editing an existing report
  if (id && isDataLoading) {
    return (
      <div style={{ padding: '24px', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <Spin size="large" tip="Loading report..." />
      </div>
    );
  }

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={2} style={{ margin: 0 }}>{id ? 'Edit' : 'Create'} Plumber's Report</Title>
        <Space>
          <Tooltip title="Generate report content with AI">
            <Button
              icon={<RobotOutlined />}
              onClick={() => setAiGenerateModalVisible(true)}
              size="small"
              type="primary"
            >
              AI Generate
            </Button>
          </Tooltip>
          <Tooltip title="Import AI JSON Result">
            <Button
              icon={<FileTextOutlined />}
              onClick={() => setJsonPasteModalVisible(true)}
              size="small"
            >
              Import JSON
            </Button>
          </Tooltip>
          <Tooltip title="AI Prompt Template">
            <Button
              icon={<RobotOutlined />}
              onClick={() => setPromptModalVisible(true)}
              size="small"
              type="text"
            />
          </Tooltip>
        </Space>
      </div>
      
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          service_date: dayjs(),
          template_type: 'standard',
        }}
      >
        <Row gutter={24}>
          {/* Report Details */}
          <Col xs={24}>
            <Card title="Report Details" style={{ marginBottom: 24 }}>
              <Row gutter={16}>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="company_id"
                    label="Select Company"
                    rules={[{ required: true, message: 'Please select a company' }]}
                  >
                    <Select
                      placeholder="Select a company"
                      onChange={handleCompanyChange}
                    >
                      {companies.map(company => (
                        <Option key={company.id} value={company.id}>
                          {company.name}
                        </Option>
                      ))}
                    </Select>
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="report_number"
                    label="Report Number"
                    rules={[{ required: true }]}
                  >
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="service_date"
                    label={
                      <Space size={4}>
                        <span>Service Date</span>
                        <Tooltip title="Fill from WM Date of Loss">
                          <Button
                            type="link"
                            size="small"
                            icon={<CalendarOutlined />}
                            loading={isDolLoading}
                            onClick={handleFetchDateOfLoss}
                            style={{ padding: 0, height: 'auto', fontSize: 12 }}
                          >
                            DOL
                          </Button>
                        </Tooltip>
                      </Space>
                    }
                    rules={[{ required: true }]}
                  >
                    <DatePicker style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="technician_name"
                    label="Technician Name"
                  >
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="license_number"
                    label="License Number"
                  >
                    <Input />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Col>

          {/* Client Information */}
          <Col xs={24}>
            <Card title="Client Information" style={{ marginBottom: 24 }}>
              <Row gutter={16} style={{ marginBottom: 16 }}>
                <Col xs={24} md={12}>
                  <Form.Item label="Search Client (DB)" style={{ marginBottom: 0 }}>
                    <Select
                      showSearch
                      allowClear
                      placeholder="Type client name or address to search..."
                      filterOption={false}
                      loading={isClientSearching}
                      onSearch={(val) => setClientSearch(val)}
                      onSelect={(val: string) => handleClientSelect(val)}
                      onClear={() => setClientSearch('')}
                      notFoundContent={
                        clientSearch.length < 2
                          ? <Text type="secondary">Type 2+ characters to search</Text>
                          : isClientSearching
                            ? <Spin size="small" />
                            : <Text type="secondary">No clients found</Text>
                      }
                      options={clientSearchResults.map((c) => ({
                        label: `${c.display_name}${c.address ? ` — ${c.address}` : ''}`,
                        value: c.id,
                      }))}
                    />
                  </Form.Item>
                </Col>
                {clientClaims.length > 0 && (
                  <Col xs={24} md={12}>
                    <Form.Item label="Link to Claim (for PA email)" style={{ marginBottom: 0 }}>
                      <Select
                        allowClear
                        placeholder="Select claim to link..."
                        value={selectedClaimId || undefined}
                        onChange={(val) => setSelectedClaimId(val || null)}
                        options={clientClaims.map((c) => ({
                          label: `${c.claim_number} — ${c.insurance_company || 'N/A'}${c.date_of_loss ? ` (DOL: ${dayjs(c.date_of_loss).format('MM/DD/YYYY')})` : ''}`,
                          value: c.id,
                        }))}
                      />
                    </Form.Item>
                  </Col>
                )}
              </Row>
              <Row gutter={16}>
                {/* Client Name, Email, Phone in one row */}
                <Col xs={24} md={8}>
                  <Form.Item
                    name="name"
                    label="Client Name"
                  >
                    <Input placeholder="Enter client name" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="email" label="Email">
                    <Input type="email" placeholder="Enter email address" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="phone" label="Phone">
                    <Input placeholder="Enter phone number" />
                  </Form.Item>
                </Col>

                {/* Address, City, State, Zip in one row */}
                <Col xs={24} md={12}>
                  <Form.Item name="address" label="Address">
                    <AddressAutocomplete
                      placeholder="Enter street address"
                      onSelect={(addr) => form.setFieldsValue({
                        city: addr.city,
                        state: addr.state,
                        zipcode: addr.zip,
                      })}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={6}>
                  <Form.Item name="city" label="City">
                    <Input placeholder="Enter city" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={3}>
                  <Form.Item name="state" label="State">
                    <Input placeholder="Enter state" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={3}>
                  <Form.Item name="zipcode" label="ZIP Code">
                    <Input placeholder="Enter ZIP code" />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Col>

          {/* Property Information */}
          <Col xs={24}>
            <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
              <Checkbox
                checked={propertyDifferent}
                onChange={(e) => {
                  setPropertyDifferent(e.target.checked);
                  if (!e.target.checked) {
                    form.setFieldsValue({
                      property_address: undefined,
                      property_city: undefined,
                      property_state: undefined,
                      property_zipcode: undefined,
                    });
                  }
                }}
              >
                Property address different from client
              </Checkbox>
            </div>
            {propertyDifferent && (
              <Card size="small" style={{ marginBottom: 24 }}>
                <Row gutter={16}>
                  <Col xs={24} md={12}>
                    <Form.Item name="property_address" label="Property Address" style={{ marginBottom: 8 }}>
                      <AddressAutocomplete
                        placeholder="Enter property address"
                        onSelect={(addr) => form.setFieldsValue({
                          property_city: addr.city,
                          property_state: addr.state,
                          property_zipcode: addr.zip,
                        })}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={5}>
                    <Form.Item name="property_city" label="City" style={{ marginBottom: 8 }}>
                      <Input placeholder="City" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={4}>
                    <Form.Item name="property_state" label="State" style={{ marginBottom: 8 }}>
                      <Input placeholder="State" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={3}>
                    <Form.Item name="property_zipcode" label="ZIP" style={{ marginBottom: 8 }}>
                      <Input placeholder="ZIP" />
                    </Form.Item>
                  </Col>
                </Row>
              </Card>
            )}
          </Col>

          {/* Report Content */}
          <Col xs={24}>
            <Card title="Report Content" style={{ marginBottom: 24 }}>
              <Form.Item label="Site Findings & Assessment">
                <RichTextEditor
                  value={siteFindings}
                  onChange={setSiteFindings}
                  placeholder="Describe site findings and assessment (supports rich text formatting)..."
                  minHeight={150}
                />
              </Form.Item>

              <Form.Item label="Work Performed">
                <RichTextEditor
                  value={workPerformed}
                  onChange={setWorkPerformed}
                  placeholder="Describe the work performed (supports rich text formatting)..."
                  minHeight={150}
                />
              </Form.Item>
            </Card>
          </Col>

          {/* Invoice Items */}
          <Col xs={24}>
            <Card
              title="Invoice Items"
              style={{ marginBottom: 24 }}
              extra={
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={handleAddItem}
                >
                  Add Item
                </Button>
              }
            >
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                modifiers={[restrictToVerticalAxis]}
              >
                <SortableContext items={invoiceItems.map((_, index) => `item-${index}`)} strategy={verticalListSortingStrategy}>
                  <DraggableTable
                dataSource={invoiceItems.map((item, index) => ({ ...item, key: index }))}
                onReorder={() => {}} // Handled by drag handlers above
                showDragHandle={true}
                dragHandlePosition="start"
                dragColumnWidth={30}
                getRowId={(record, index) => `item-${index}`}
                disableDrag={false}
                activeId={activeItemId}
                scroll={{ x: 800 }}
                columns={[
                  {
                    title: '#',
                    key: 'index',
                    width: 50,
                    render: (_: any, __: any, index: number) => index + 1,
                  },
                  {
                    title: 'Item',
                    dataIndex: 'name',
                    key: 'name',
                    width: 150,
                    ellipsis: true,
                  },
                  {
                    title: 'Description',
                    dataIndex: 'description',
                    key: 'description',
                    ellipsis: true,
                  },
                  {
                    title: 'Qty',
                    dataIndex: 'quantity',
                    key: 'quantity',
                    width: 80,
                    align: 'center' as const,
                  },
                  {
                    title: 'Unit',
                    dataIndex: 'unit',
                    key: 'unit',
                    width: 80,
                  },
                  {
                    title: 'Unit Cost',
                    dataIndex: 'unit_cost',
                    key: 'unit_cost',
                    width: 100,
                    align: 'right' as const,
                    render: (value: number) => `$${value.toFixed(2)}`,
                  },
                  {
                    title: 'Total',
                    dataIndex: 'total_cost',
                    key: 'total_cost',
                    width: 120,
                    align: 'right' as const,
                    render: (value: number) => `$${value.toFixed(2)}`,
                  },
                  {
                    title: 'Actions',
                    key: 'actions',
                    width: 100,
                    render: (_: any, record: InvoiceItem, index: number) => (
                      <Space>
                        <Tooltip title="Edit">
                          <Button
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => handleEditItem(record, index)}
                          />
                        </Tooltip>
                        <Popconfirm
                          title="Delete this item?"
                          onConfirm={() => handleDeleteItem(index)}
                        >
                          <Button
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                          />
                        </Popconfirm>
                      </Space>
                    ),
                  },
                ]}
                pagination={false}
                summary={() => (
                  <Table.Summary>
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={6} align="right">
                        <strong>Subtotal:</strong>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={1} align="right">
                        <strong>${totals.subtotal.toFixed(2)}</strong>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={2} />
                    </Table.Summary.Row>
                  </Table.Summary>
                )}
              />
                </SortableContext>
                <DragOverlay>
                  {activeItemId ? (
                    <div
                      style={{
                        backgroundColor: 'white',
                        border: '1px solid #d9d9d9',
                        borderRadius: '6px',
                        padding: '8px 12px',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                        fontSize: '13px',
                        minWidth: '200px',
                        opacity: 0.95,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <HolderOutlined style={{ color: '#8c8c8c', fontSize: '12px' }} />
                      <span style={{ fontWeight: '500' }}>
                        {(() => {
                          const index = parseInt(activeItemId.split('-')[1]);
                          const item = invoiceItems[index];
                          return item ? item.name || 'Item' : 'Item';
                        })()}
                      </span>
                      <span style={{ color: '#1890ff', marginLeft: 'auto' }}>
                        ${(() => {
                          const index = parseInt(activeItemId.split('-')[1]);
                          const item = invoiceItems[index];
                          return item ? (item.total_cost || 0).toFixed(2) : '0.00';
                        })()}
                      </span>
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            </Card>
          </Col>

          {/* Financial Summary & Payments */}
          <Col xs={24} lg={12}>
            <Card title="Invoice Summary" style={{ marginBottom: 24 }}>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="tax_amount" label="Tax Amount">
                    <InputNumber
                      style={{ width: '100%' }}
                      min={0}
                      formatter={value => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                      parser={(value: any) => value!.replace(/\$\s?|(,*)/g, '') as any}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="discount" label="Discount">
                    <InputNumber
                      style={{ width: '100%' }}
                      min={0}
                      formatter={value => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                      parser={(value: any) => value!.replace(/\$\s?|(,*)/g, '') as any}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Divider />
              
              <div style={{ fontSize: '16px' }}>
                <Row justify="space-between" style={{ marginBottom: 8 }}>
                  <Col>Subtotal:</Col>
                  <Col>${totals.subtotal.toFixed(2)}</Col>
                </Row>
                {totals.tax_amount > 0 && (
                  <Row justify="space-between" style={{ marginBottom: 8 }}>
                    <Col>Tax:</Col>
                    <Col>${totals.tax_amount.toFixed(2)}</Col>
                  </Row>
                )}
                {totals.discount > 0 && (
                  <Row justify="space-between" style={{ marginBottom: 8 }}>
                    <Col>Discount:</Col>
                    <Col>-${totals.discount.toFixed(2)}</Col>
                  </Row>
                )}
                <Divider />
                <Row justify="space-between" style={{ fontWeight: 'bold', fontSize: '18px' }}>
                  <Col>Total:</Col>
                  <Col>${totals.total_amount.toFixed(2)}</Col>
                </Row>
              </div>
            </Card>
          </Col>

          <Col xs={24} lg={12}>
            <Card 
              title={
                <Space>
                  <span>Payment Records</span>
                  <Switch
                    size="small"
                    checked={showPaymentDates}
                    onChange={setShowPaymentDates}
                    checkedChildren="Show Dates"
                    unCheckedChildren="Hide Dates"
                  />
                </Space>
              }
              style={{ marginBottom: 24 }}
              extra={
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={handleAddPayment}
                >
                  Add Payment
                </Button>
              }
            >
              <Space direction="vertical" style={{ width: '100%' }}>
                {payments.map((payment, index) => (
                  <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px', background: '#f5f5f5', borderRadius: '4px' }}>
                    <Space>
                      {showPaymentDates && payment.date && (
                        <Text type="secondary">{payment.date}</Text>
                      )}
                      <Text strong>${payment.amount.toFixed(2)}</Text>
                      {payment.method && <Text>({payment.method})</Text>}
                      {payment.reference && <Text type="secondary">Ref: {payment.reference}</Text>}
                    </Space>
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => handleDeletePayment(index)}
                    />
                  </div>
                ))}
              </Space>

              <Divider />
              
              <div style={{ fontSize: '16px' }}>
                <Row justify="space-between" style={{ marginBottom: 8 }}>
                  <Col>Total Amount:</Col>
                  <Col>${totals.total_amount.toFixed(2)}</Col>
                </Row>
                <Row justify="space-between" style={{ marginBottom: 8 }}>
                  <Col>Total Paid:</Col>
                  <Col>${payments.reduce((sum, p) => sum + p.amount, 0).toFixed(2)}</Col>
                </Row>
                <Divider />
                <Row justify="space-between" style={{ fontWeight: 'bold', color: totals.balance_due > 0 ? '#ff4d4f' : '#52c41a' }}>
                  <Col>Balance Due:</Col>
                  <Col>${totals.balance_due.toFixed(2)}</Col>
                </Row>
              </div>
            </Card>
          </Col>

          {/* Additional Information */}
          <Col xs={24}>
            <Card title="Additional Information" style={{ marginBottom: 24 }}>
              <Row gutter={[16, 24]}>
                <Col xs={24}>
                  <Form.Item label="Warranty Information">
                    <TemplateSelector
                      companyId={form.getFieldValue('company_id') || selectedCompany?.id || ''}
                      templateType="warranty"
                      selectedTemplate={selectedWarrantyTemplate}
                      onTemplateSelect={(content, template) => {
                        setWarrantyInfo(content);
                        setSelectedWarrantyTemplate(template);
                      }}
                      onTemplateClear={() => {
                        setSelectedWarrantyTemplate(null);
                      }}
                      disabled={!selectedCompany}
                    />
                    <RichTextEditor
                      value={warrantyInfo}
                      onChange={setWarrantyInfo}
                      placeholder="Enter warranty details or select a template above..."
                      minHeight={120}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24}>
                  <Form.Item label="Terms & Conditions">
                    <TemplateSelector
                      companyId={form.getFieldValue('company_id') || selectedCompany?.id || ''}
                      templateType="terms"
                      selectedTemplate={selectedTermsTemplate}
                      onTemplateSelect={(content, template) => {
                        setTermsConditions(content);
                        setSelectedTermsTemplate(template);
                      }}
                      onTemplateClear={() => {
                        setSelectedTermsTemplate(null);
                      }}
                      disabled={!selectedCompany}
                    />
                    <RichTextEditor
                      value={termsConditions}
                      onChange={setTermsConditions}
                      placeholder="Enter terms and conditions or select a template above..."
                      minHeight={120}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24}>
                  <Form.Item label="Additional Notes">
                    <TemplateSelector
                      companyId={form.getFieldValue('company_id') || selectedCompany?.id || ''}
                      templateType="notes"
                      selectedTemplate={selectedNotesTemplate}
                      onTemplateSelect={(content, template) => {
                        setNotes(content);
                        setSelectedNotesTemplate(template);
                      }}
                      onTemplateClear={() => {
                        setSelectedNotesTemplate(null);
                      }}
                      disabled={!selectedCompany}
                    />
                    <RichTextEditor
                      value={notes}
                      onChange={setNotes}
                      placeholder="Any additional notes or select a template above..."
                      minHeight={120}
                    />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Col>
        </Row>

        {/* Action Buttons */}
        <Card>
          <Space size="middle">
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSave}
              loading={isSaving}
              disabled={isPreviewing || isDataLoading}
            >
              Save Report
            </Button>
            <Button
              icon={<EyeOutlined />}
              onClick={handlePreviewPDF}
              loading={isPreviewing}
              disabled={isSaving || isDataLoading}
            >
              Preview PDF
            </Button>
            {id && (
              <Button
                icon={<SendOutlined />}
                onClick={async () => {
                  try {
                    setSendPALoading(true);
                    const info = await plumberReportService.getPAEmailInfo(id);
                    setPaEmailInfo(info);
                    if (info.message && info.to.length === 0) {
                      message.warning(info.message);
                      return;
                    }
                    const address = form.getFieldValue('address') || '';
                    paForm.setFieldsValue({
                      to_addresses: info.to.map((t) => t.email),
                      cc_addresses: info.cc.map((c) => c.email),
                      subject: `Plumber's Report — ${address}`,
                      body_html:
                        `<p>Please find attached the Plumber's Report for ${address}.</p>` +
                        `<p>If you have any questions, please don't hesitate to reach out.</p>` +
                        `<p>Thank you.</p>`,
                      email_account_id: info.email_accounts?.[0]?.id || undefined,
                    });
                    setSendPAVisible(true);
                  } catch (err: any) {
                    message.error('Failed to load PA info');
                  } finally {
                    setSendPALoading(false);
                  }
                }}
                loading={sendPALoading}
                disabled={isSaving || isPreviewing}
              >
                Send to PA
              </Button>
            )}
            <Button
              onClick={() => navigate('/plumber-reports')}
              disabled={isSaving || isPreviewing}
            >
              Cancel
            </Button>
          </Space>
        </Card>
      </Form>

      {/* Item Modal */}
      <Modal
        title={editingItem ? 'Edit Item' : 'Add Item'}
        open={itemModalVisible}
        onOk={handleItemSubmit}
        onCancel={() => {
          setItemModalVisible(false);
          itemForm.resetFields();
          setItemDescription('');
        }}
        width={600}
      >
        <Form
          form={itemForm}
          layout="vertical"
          initialValues={{
            quantity: 1,
            unit: 'EA',
            unit_cost: 0,
          }}
        >
          <Form.Item
            name="name"
            label="Name"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item label="Description">
            <RichTextEditor
              value={itemDescription}
              onChange={setItemDescription}
              placeholder="Enter item description (supports rich text formatting)..."
              minHeight={100}
            />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="quantity"
                label="Quantity"
                rules={[{ required: true }]}
              >
                <InputNumber style={{ width: '100%' }} min={0} step={1} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="unit"
                label="Unit"
              >
                <UnitSelect />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="unit_cost"
                label="Unit Cost"
                rules={[{ required: true }]}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  step={0.01}
                  formatter={value => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={(value: any) => value!.replace(/\$\s?|(,*)/g, '') as any}
                />
              </Form.Item>
            </Col>
          </Row>
          {itemForm.getFieldValue('quantity') && itemForm.getFieldValue('unit_cost') ? (
            <div style={{ textAlign: 'right', fontSize: '16px', fontWeight: 'bold' }}>
              Total: ${(itemForm.getFieldValue('quantity') * itemForm.getFieldValue('unit_cost')).toFixed(2)}
            </div>
          ) : null}
        </Form>
      </Modal>

      {/* Payment Modal */}
      <Modal
        title="Add Payment"
        open={paymentModalVisible}
        onOk={handlePaymentSubmit}
        onCancel={() => {
          setPaymentModalVisible(false);
          paymentForm.resetFields();
        }}
        width={500}
      >
        <Form
          form={paymentForm}
          layout="vertical"
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="amount"
                label="Amount"
                rules={[{ required: true }]}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  step={0.01}
                  formatter={value => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={(value: any) => value!.replace(/\$\s?|(,*)/g, '') as any}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="date"
                label="Payment Date"
              >
                <Input type="date" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="method"
                label="Payment Method"
              >
                <Select placeholder="Select method">
                  <Option value="cash">Cash</Option>
                  <Option value="check">Check</Option>
                  <Option value="credit_card">Credit Card</Option>
                  <Option value="bank_transfer">Bank Transfer</Option>
                  <Option value="other">Other</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="reference"
                label="Reference/Check #"
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item
                name="notes"
                label="Notes"
              >
                <TextArea rows={2} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* AI Generate Modal */}
      <Modal
        title={
          <Space>
            <RobotOutlined />
            <span>AI Report Generator</span>
          </Space>
        }
        open={aiGenerateModalVisible}
        onCancel={() => {
          if (aiGenerating) return; // generation in flight — closing now would strand the result when it lands
          setAiGenerateModalVisible(false);
        }}
        closable={!aiGenerating}
        maskClosable={!aiGenerating}
        keyboard={!aiGenerating}
        width={500}
        footer={[
          <Button key="clear" onClick={handleClearAiForm} disabled={aiGenerating}>
            Clear Fields
          </Button>,
          <Button key="close" onClick={() => setAiGenerateModalVisible(false)} disabled={aiGenerating}>
            Cancel
          </Button>,
          <Button
            key="generate"
            type="primary"
            icon={<RobotOutlined />}
            loading={aiGenerating}
            disabled={!resolvedAiState}
            onClick={handleAiGenerate}
          >
            {aiGenerating ? 'Generating...' : 'Generate Report'}
          </Button>,
        ]}
      >
        {aiGenerating && aiStep && (
          <div style={{ marginBottom: 16, padding: '8px 12px', background: '#e6f4ff', borderRadius: 6, fontSize: 13 }}>
            <Spin size="small" style={{ marginRight: 8 }} />{aiStep}
            <div style={{ marginTop: 4, color: '#8c8c8c' }}>
              This can take up to 30 seconds — please keep this window open until it finishes.
            </div>
          </div>
        )}
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          Fill in the details below — AI will infer everything else (failed component, hours, materials, and a fully priced invoice, including a detach &amp; reset charge if a fixture was removed) in 2 steps: (1) assess scope &amp; write findings, then (2) build invoice from the work performed.
        </Typography.Text>
        <Typography.Text type={resolvedAiState ? 'secondary' : 'danger'} style={{ display: 'block', marginBottom: 16 }}>
          {resolvedAiState
            ? `Materials tax will be calculated for state: ${resolvedAiState} (from the client/property address above).`
            : 'No valid State (MD, VA, or DC) found on the client/property address — fill that in before generating, it determines the materials tax calculation.'}
        </Typography.Text>
        <Form form={aiForm} layout="vertical" onValuesChange={handleAiFormValuesChange}>
          <Form.Item
            name="incident_type"
            label="What Was the Problem?"
            rules={[{ required: true, message: 'Please describe the problem' }]}
          >
            <Input placeholder="e.g. burst supply line, failed mixing valve, cracked flex connector" />
          </Form.Item>
          <Form.Item
            name="pipe_material"
            label="Pipe Material"
            rules={[{ required: true, message: 'Please select the pipe material' }]}
          >
            <Select placeholder="Select pipe material">
              <Select.Option value="Type L copper">Type L Copper</Select.Option>
              <Select.Option value="CPVC">CPVC</Select.Option>
              <Select.Option value="PEX">PEX</Select.Option>
              <Select.Option value="PVC (DWV)">PVC (DWV)</Select.Option>
              <Select.Option value="Cast iron">Cast Iron</Select.Option>
              <Select.Option value="braided stainless">Braided Stainless</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item
            name="wall_access_type"
            label="What Part Was Opened / Torn Out?"
            rules={[{ required: true, message: 'Please describe what was opened to access the issue' }]}
          >
            <Input placeholder="e.g. drywall behind vanity, ceiling below bathroom, under-sink cabinet panel" />
          </Form.Item>
          <Form.Item
            name="location"
            label="Water Damage Source Location"
            rules={[{ required: true, message: 'Please enter the location' }]}
          >
            <Input placeholder="e.g. 2nd floor master bathroom shower, kitchen sink, basement" />
          </Form.Item>
          <Form.Item
            name="detached_fixture"
            label="Anything Detached to Access the Area? (optional)"
          >
            <Input placeholder="e.g. toilet, vanity, dishwasher — leave blank if nothing was detached" />
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) => prev.detached_fixture !== cur.detached_fixture}
          >
            {({ getFieldValue }) =>
              (getFieldValue('detached_fixture') || '').trim() ? (
                <Form.Item
                  name="fixture_reinstalled"
                  valuePropName="checked"
                  initialValue={true}
                >
                  <Checkbox>
                    Reinstalled by this technician (uncheck if it will be replaced or
                    reinstalled by someone else)
                  </Checkbox>
                </Form.Item>
              ) : null
            }
          </Form.Item>
        </Form>
      </Modal>

      {/* AI Prompt Template Modal */}
      <Modal
        title={
          <Space>
            <RobotOutlined />
            <span>AI Prompt Template</span>
          </Space>
        }
        open={promptModalVisible}
        onCancel={() => setPromptModalVisible(false)}
        width={700}
        footer={[
          <Button key="close" onClick={() => setPromptModalVisible(false)}>
            Close
          </Button>,
          <Button
            key="copy"
            type="primary"
            icon={<CopyOutlined />}
            onClick={() => {
              const el = document.getElementById('plumber-prompt-text');
              if (el) {
                navigator.clipboard.writeText(el.innerText).then(() => {
                  message.success('Prompt copied to clipboard');
                });
              }
            }}
          >
            Copy to Clipboard
          </Button>,
        ]}
      >
        <div
          id="plumber-prompt-text"
          style={{
            maxHeight: '60vh',
            overflowY: 'auto',
            background: '#f5f5f5',
            borderRadius: 8,
            padding: 16,
            fontSize: 13,
            lineHeight: 1.7,
            whiteSpace: 'pre-wrap',
            fontFamily: 'monospace',
          }}
        >{`You are an experienced licensed master plumber in the DMV area (DC, Maryland, Virginia).
Write a professional plumber's service report for an emergency repair call.
---
JOB DETAILS (fill in before sending):
- Incident type: [e.g. burst shower valve, broken supply line, etc.]
- Location in home: [e.g. master bathroom shower]
- State: [MD / VA / DC] (for tax rate)
- Total invoice amount: [$X,XXX]
- Work performed: Based on the incident type and location provided above,
  infer the most realistic and typical scope of work a licensed plumber
  would perform for this type of emergency repair in the DMV area.
- Materials used: Infer the most commonly used, code-compliant materials
  for this type of repair.
- Labor hours: Estimate realistic labor hours by phase based on the scope
  of work inferred above. Total hours should be consistent with the
  specified invoice amount.
---
REPORT REQUIREMENTS:
1. SITE FINDINGS & ASSESSMENT (→ site_findings)
   - Describe the failure as sudden and unexpected
   - State that no prior signs of leakage were reported by the homeowner
   - Use factual, field technician language — not legal or overly formal
   - Do NOT mention age of components, wear and tear, or maintenance history
   - Do NOT describe the water supply as "still pressurized," "still on,"
     or otherwise note how long water ran before shut-off — avoid any
     phrasing that implies the leak was left active or that shut-off was
     delayed. Focus only on what was observed (active discharge, location,
     affected area).
   - Do NOT estimate or describe how long the leak had been running, how
     much water escaped, or the duration of the event in any form
     ("ran for some time," "significant water had escaped," "had been
     leaking for a while," etc.). Describe only the condition observed
     at the moment of arrival.
   - Do NOT imply any fault, delay, or omission on the homeowner's part —
     no suggestion that the leak was noticed late, reported late, could
     have been caught earlier, or that the homeowner should have acted
     sooner. The homeowner's only stated role is that no prior signs of
     leakage were reported.
   - Use "sudden burst" or "sudden failure" once naturally — do not repeat excessively
2. WORK PERFORMED (→ work_performed)
   - Written as a narrative paragraph describing the full scope of work
   - Group related tasks together
   - Frame the water shut-off as an immediate action taken upon arrival
     (e.g. "technician immediately isolated and shut off the main supply
     to stop the active discharge") rather than a static condition found
   - Keep it concise but clear
   - Written as a field technician would describe it
3. INVOICE (→ invoice_items)
   - 5 line items maximum
   - Include: Emergency Dispatch Fee, Labor (broken into 2-3 phases), Materials (grouped)
   - tax_amount and total must match the specified invoice amount
4. WARRANTY & NOTES (→ warranty_info, notes)
   - warranty_info: 30-day labor warranty statement (1 sentence)
   - notes: Brief technician notes — 2-3 sentences max with follow-up advisory
TONE: Professional field report. Written as a licensed technician, not a lawyer.
Avoid: wear and tear, deterioration, age-related, neglect, deferred maintenance,
       excessive repetition of "sudden," overly legal or defensive phrasing,
       any note on water pressure state at arrival, any phrasing that
       suggests the leak ran unattended or that shut-off was delayed,
       any estimate of leak duration or volume of water escaped, and any
       language implying homeowner fault, late discovery, or delayed reporting.
---
OUTPUT FORMAT: Return ONLY a valid JSON object (no markdown, no code fences).
Use the exact structure below:
{
  "site_findings": "Upon arrival at the property, technician observed...",
  "work_performed": "Upon arrival, technician immediately isolated and shut off the main water supply to stop the active discharge...",
  "invoice_items": [
    {
      "name": "Emergency Dispatch Fee",
      "description": "After-hours emergency response and site assessment",
      "quantity": 1,
      "unit": "EA",
      "unit_cost": 250.00
    },
    {
      "name": "Labor — Demolition & Access",
      "description": "Removed damaged drywall section to expose failed supply line",
      "quantity": 3,
      "unit": "HR",
      "unit_cost": 185.00
    },
    {
      "name": "Labor — Repair & Reassembly",
      "description": "Replaced burst section with new copper pipe, soldered joints",
      "quantity": 4,
      "unit": "HR",
      "unit_cost": 185.00
    },
    {
      "name": "Materials",
      "description": "3/4in Type L copper pipe, couplings, flux, solder, pipe hangers",
      "quantity": 1,
      "unit": "LOT",
      "unit_cost": 385.00
    }
  ],
  "tax_amount": 0,
  "warranty_info": "All labor performed is covered under a 30-day workmanship warranty.",
  "notes": "Recommend allowing 48-72 hours drying time before any wall restoration. Tile and drywall restoration to be handled by separate trades."
}`}</div>
      </Modal>

      {/* JSON Import Modal */}
      <Modal
        title={
          <Space>
            <FileTextOutlined />
            <span>Import JSON from AI</span>
          </Space>
        }
        open={jsonPasteModalVisible}
        onCancel={() => {
          setJsonPasteModalVisible(false);
          setJsonPasteValue('');
        }}
        width={600}
        footer={[
          <Button key="close" onClick={() => {
            setJsonPasteModalVisible(false);
            setJsonPasteValue('');
          }}>
            Cancel
          </Button>,
          <Button
            key="import"
            type="primary"
            disabled={!jsonPasteValue.trim()}
            onClick={handleJsonImport}
          >
            Import
          </Button>,
        ]}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          Paste the JSON output from AI below. It will auto-fill Site Findings, Work Performed, Invoice Items, and other fields.
        </Text>
        <TextArea
          rows={14}
          value={jsonPasteValue}
          onChange={(e) => setJsonPasteValue(e.target.value)}
          placeholder='Paste JSON here... e.g. { "site_findings": "...", "work_performed": "...", ... }'
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
      </Modal>

      {/* Send to PA Modal */}
      <Modal
        title={
          <Space>
            <MailOutlined />
            <span>Send Plumber&apos;s Report to PA</span>
          </Space>
        }
        open={sendPAVisible}
        onCancel={() => setSendPAVisible(false)}
        width={700}
        okText="Send Email"
        okButtonProps={{ icon: <SendOutlined />, loading: sendPALoading }}
        onOk={async () => {
          try {
            const values = await paForm.validateFields();
            if (!values.to_addresses?.length) {
              message.error('At least one recipient is required');
              return;
            }
            setSendPALoading(true);
            await plumberReportService.sendToPA(id!, {
              to_addresses: values.to_addresses,
              cc_addresses: values.cc_addresses || [],
              subject: values.subject,
              body_html: values.body_html,
              email_account_id: values.email_account_id || undefined,
            });
            message.success('Plumber\'s Report sent to PA successfully!');
            setSendPAVisible(false);
          } catch (err: any) {
            message.error(err?.response?.data?.detail || 'Failed to send email');
          } finally {
            setSendPALoading(false);
          }
        }}
      >
        {paEmailInfo && (
          <Form form={paForm} layout="vertical">
            {paEmailInfo.pa_company && (
              <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                PA Company: <strong>{paEmailInfo.pa_company}</strong>
                {paEmailInfo.job && (
                  <> | Claim: <strong>{paEmailInfo.job.claim_number}</strong></>
                )}
              </Text>
            )}
            {paEmailInfo.email_accounts.length > 0 && (
              <Form.Item name="email_account_id" label="Send From">
                <Select
                  allowClear
                  placeholder="Select sender account"
                  options={paEmailInfo.email_accounts.map((a) => ({
                    label: a.display_name
                      ? `${a.display_name} (${a.email_address})`
                      : a.email_address,
                    value: a.id,
                  }))}
                />
              </Form.Item>
            )}
            <Form.Item
              name="to_addresses"
              label="To (PA)"
              rules={[{ required: true, message: 'At least one recipient' }]}
            >
              <Select
                mode="tags"
                placeholder="Recipient email(s)"
                tokenSeparators={[',', ';']}
              />
            </Form.Item>
            <Form.Item name="cc_addresses" label="CC (Same Company PAs)">
              <Select
                mode="tags"
                placeholder="CC email(s)"
                tokenSeparators={[',', ';']}
              />
            </Form.Item>
            <Form.Item
              name="subject"
              label="Subject"
              rules={[{ required: true }]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name="body_html"
              label="Message"
              rules={[{ required: true }]}
              getValueFromEvent={(val: string) => val}
              trigger="onChange"
              valuePropName="value"
            >
              <RichTextEditor minHeight={150} maxHeight={300} />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </div>
  );
};

export default PlumberReportCreation;
