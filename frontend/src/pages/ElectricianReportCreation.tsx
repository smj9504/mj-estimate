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
  DownloadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate, useParams } from 'react-router-dom';
import {
  electricianReportService,
  ElectricianReport,
  InvoiceItem,
  PaymentRecord,
  PhotoRecord,
  PAEmailInfo,
  ChecklistSection,
  ChecklistItem,
  CircuitTestResult,
  RiskCode,
  RISK_CODE_LABELS,
  DEFAULT_INSPECTION_CHECKLIST,
} from '../services/electricianReportService';
import AddressAutocomplete from '../components/common/AddressAutocomplete';
import { companyService } from '../services/companyService';
import { clientService, claimService } from '../services/clientService';
import { Company } from '../types';
import type { ClientListItem, Claim } from '../types/client';
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

const ElectricianReportCreation: React.FC = () => {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

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
  
  // Preview modal state
  const [previewModalVisible, setPreviewModalVisible] = useState(false);
  const [previewHtmlUrl, setPreviewHtmlUrl] = useState<string | null>(null);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [previewReportData, setPreviewReportData] = useState<ElectricianReport | null>(null);

  // Prompt modal state
  const [promptModalVisible, setPromptModalVisible] = useState(false);
  const [promptInputs, setPromptInputs] = useState({
    affected_items: [{ area: '', items: '' }] as { area: string; items: string }[],
    water_source: '',
    state: 'MD',
    total_amount: '',
    smoke_detectors: '',
    drywall_cuts: '',
    photo_description: '',
    additional_context: '',
  });
  const [jsonPasteModalVisible, setJsonPasteModalVisible] = useState(false);
  const [jsonPasteValue, setJsonPasteValue] = useState('');

  // Modal states
  const [itemModalVisible, setItemModalVisible] = useState(false);
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<InvoiceItem | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [itemForm] = Form.useForm();
  const [paymentForm] = Form.useForm();
  const [itemDescription, setItemDescription] = useState('');

  // Inspection checklist
  const [inspectionChecklist, setInspectionChecklist] = useState<ChecklistSection[]>(
    () => JSON.parse(JSON.stringify(DEFAULT_INSPECTION_CHECKLIST))
  );

  // Overall assessment & scope (EICR standard)
  const [overallAssessment, setOverallAssessment] = useState<'satisfactory' | 'unsatisfactory' | 'pending'>('pending');
  const [extentAndLimitations, setExtentAndLimitations] = useState('');
  const [circuitTestResults, setCircuitTestResults] = useState<CircuitTestResult[]>([]);

  // Electrical-specific text fields
  const [electricalFindings, setElectricalFindings] = useState('');
  const [safetyConcerns, setSafetyConcerns] = useState('');
  const [codeViolations, setCodeViolations] = useState('');

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
            const reportNumber = await electricianReportService.generateReportNumber(data[0].id);
            form.setFieldsValue({
              report_number: reportNumber
            });
          } catch (error) {
            console.error('Failed to generate report number:', error);
            // Fallback to manual generation
            const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
            form.setFieldsValue({
              report_number: `ELC-${timestamp}`
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
        const report = await electricianReportService.getReport(id);
        
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
        setElectricalFindings(report.electrical_findings || '');
        setWorkPerformed(report.work_performed || '');
        setSafetyConcerns(report.safety_concerns || '');
        setCodeViolations(report.code_violations || '');
        setWarrantyInfo(report.warranty_info || '');
        setTermsConditions(report.terms_conditions || '');
        setNotes(report.notes || '');

        // Set inspection checklist
        if (report.inspection_checklist?.length) {
          setInspectionChecklist(report.inspection_checklist);
        }

        // Set new standard fields
        if (report.overall_assessment) setOverallAssessment(report.overall_assessment);
        if (report.extent_and_limitations) setExtentAndLimitations(report.extent_and_limitations);
        if (report.circuit_test_results?.length) setCircuitTestResults(report.circuit_test_results);

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
        const reportNumber = await electricianReportService.generateReportNumber(companyId);
        form.setFieldsValue({
          report_number: reportNumber
        });
      } catch (error) {
        console.error('Failed to generate report number:', error);
        // Fallback to manual generation
        const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
        form.setFieldsValue({
          report_number: `ELC-${timestamp}`
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

  // Compress image before storing as base64
  const compressImage = (file: File, maxWidth = 800, quality = 0.5): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement('canvas');
        let w = img.width;
        let h = img.height;
        if (w > maxWidth) {
          h = Math.round((h * maxWidth) / w);
          w = maxWidth;
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = url;
    });
  };

  const handlePhotoFiles = async (files: File[]) => {
    for (const file of files) {
      const dataUrl = await compressImage(file);
      const newPhoto: PhotoRecord = {
        id: `photo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        url: dataUrl,
        category: 'damage',
        caption: file.name.replace(/\.[^/.]+$/, ''),
      };
      setPhotos((prev) => [...prev, newPhoto]);
    }
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
      const reportData: ElectricianReport = {
        report_number: values.report_number || electricianReportService.generateReportNumber(),
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
        electrical_findings: cleanHtml(electricalFindings),
        work_performed: cleanHtml(workPerformed),
        safety_concerns: cleanHtml(safetyConcerns),
        code_violations: cleanHtml(codeViolations),
        panel_type: values.panel_type,
        panel_location: values.panel_location,
        panel_amperage: values.panel_amperage,
        system_voltage: values.system_voltage,
        meter_number: values.meter_number,
        building_type: values.building_type,
        earthing_type: values.earthing_type,
        purpose_of_report: values.purpose_of_report,
        extent_and_limitations: extentAndLimitations || undefined,
        overall_assessment: overallAssessment,
        next_inspection_date: values.next_inspection_date ? values.next_inspection_date.format('YYYY-MM-DD') : undefined,
        inspection_checklist: inspectionChecklist,
        circuit_test_results: circuitTestResults.length > 0 ? circuitTestResults : undefined,
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
        response = await electricianReportService.updateReport(id, reportData);
      } else {
        response = await electricianReportService.createReport(reportData);
      }

      message.success(`Report ${id ? 'updated' : 'created'} successfully!`);
      navigate(`/electrician-reports/${response.id}`);
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

      const reportData: ElectricianReport = {
        report_number: values.report_number || electricianReportService.generateReportNumber(),
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
        electrical_findings: cleanHtml(electricalFindings),
        work_performed: cleanHtml(workPerformed),
        safety_concerns: cleanHtml(safetyConcerns),
        code_violations: cleanHtml(codeViolations),
        panel_type: values.panel_type,
        panel_location: values.panel_location,
        panel_amperage: values.panel_amperage,
        system_voltage: values.system_voltage,
        meter_number: values.meter_number,
        building_type: values.building_type,
        earthing_type: values.earthing_type,
        purpose_of_report: values.purpose_of_report,
        extent_and_limitations: extentAndLimitations || undefined,
        overall_assessment: overallAssessment,
        next_inspection_date: values.next_inspection_date ? values.next_inspection_date.format('YYYY-MM-DD') : undefined,
        inspection_checklist: inspectionChecklist,
        circuit_test_results: circuitTestResults.length > 0 ? circuitTestResults : undefined,
        invoice_items: invoiceItems,
        financial: totals,
        payments,
        show_payment_dates: showPaymentDates,
        photos,
        warranty_info: cleanHtml(warrantyInfo),
        terms_conditions: cleanHtml(termsConditions),
        notes: cleanHtml(notes),
      };

      // Clean up previous blob URL
      if (previewHtmlUrl) {
        URL.revokeObjectURL(previewHtmlUrl);
        setPreviewHtmlUrl(null);
      }

      // Send report WITHOUT photos for fast preview
      const reportWithoutPhotos = { ...reportData, photos: [] };
      const htmlContent = await electricianReportService.previewHTML(reportWithoutPhotos, {
        include_photos: false,
        include_financial: true,
      });

      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      setPreviewHtmlUrl(url);
      setPreviewReportData(reportData);
      setPreviewModalVisible(true);
    } catch (error) {
      message.error('Failed to generate preview');
      console.error(error);
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleClosePreview = () => {
    setPreviewModalVisible(false);
    setTimeout(() => {
      if (previewHtmlUrl) {
        URL.revokeObjectURL(previewHtmlUrl);
        setPreviewHtmlUrl(null);
      }
      setPreviewReportData(null);
    }, 300);
  };

  const handleDownloadPdf = async () => {
    if (!previewReportData) return;
    try {
      setIsDownloadingPdf(true);
      message.loading({ content: 'Generating PDF...', key: 'pdf-download', duration: 0 });
      const pdfBlob = await electricianReportService.previewPDF(previewReportData, {
        include_photos: false,
        include_financial: true,
      });
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      const addr = form.getFieldValue('address') || 'report';
      const reportNum = form.getFieldValue('report_number') || '';
      a.download = `Electrical Report ${reportNum} - ${addr.split(',')[0].trim()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      message.success({ content: 'PDF downloaded!', key: 'pdf-download' });
    } catch (error) {
      message.error({ content: 'PDF generation failed. Try with fewer photos.', key: 'pdf-download' });
      console.error(error);
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const handleJsonImport = useCallback(() => {
    try {
      const data = JSON.parse(jsonPasteValue);

      // Convert \n to <br> for rich text fields
      const nl2br = (text: string) => text.replace(/\n/g, '<br>');

      // Cause of Damage / Site Findings
      if (data.site_findings) setSiteFindings(nl2br(data.site_findings));
      if (data.cause_of_damage) setSiteFindings(nl2br(data.cause_of_damage));

      // Electrical-specific fields
      if (data.electrical_findings) setElectricalFindings(nl2br(data.electrical_findings));
      if (data.safety_concerns) setSafetyConcerns(nl2br(data.safety_concerns));
      if (data.code_violations) setCodeViolations(nl2br(data.code_violations));
      if (data.recommendations) form.setFieldsValue({ recommendations: nl2br(data.recommendations) });

      // Work Performed
      if (data.work_performed) setWorkPerformed(nl2br(data.work_performed));

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

      // Inspection checklist
      if (data.inspection_checklist && Array.isArray(data.inspection_checklist)) {
        // AI returns checklist → merge with default (update status/note by matching label)
        const merged = JSON.parse(JSON.stringify(DEFAULT_INSPECTION_CHECKLIST)) as ChecklistSection[];
        for (const aiSection of data.inspection_checklist) {
          const matchedSection = merged.find(
            (s) => s.title.toLowerCase() === (aiSection.title || '').toLowerCase()
          );
          if (matchedSection && Array.isArray(aiSection.items)) {
            for (const aiItem of aiSection.items) {
              const matchedItem = matchedSection.items.find(
                (i) => i.label.toLowerCase() === (aiItem.label || '').toLowerCase()
              );
              if (matchedItem) {
                if (aiItem.status) {
                  // Map legacy/alt codes
                  const statusMap: Record<string, string> = {
                    'NOT_INSPECTED': 'N/A', 'C1': 'DEFICIENT', 'C2': 'DEFICIENT', 'C3': 'OK', 'FI': 'N/A',
                  };
                  matchedItem.status = (statusMap[aiItem.status] || aiItem.status) as RiskCode;
                }
                if (aiItem.note) matchedItem.note = aiItem.note;
              }
            }
          }
        }
        setInspectionChecklist(merged);
      }

      // Overall assessment & scope
      if (data.overall_assessment) setOverallAssessment(data.overall_assessment);
      if (data.extent_and_limitations) setExtentAndLimitations(data.extent_and_limitations);

      // Warranty / Terms / Notes
      if (data.warranty_info) setWarrantyInfo(nl2br(data.warranty_info));
      if (data.terms_conditions) setTermsConditions(nl2br(data.terms_conditions));
      if (data.notes) setNotes(nl2br(data.notes));

      setJsonPasteModalVisible(false);
      setJsonPasteValue('');
      message.success('JSON data imported successfully');
    } catch {
      message.error('Invalid JSON format. Please check and try again.');
    }
  }, [jsonPasteValue, form]);

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
        <Title level={2} style={{ margin: 0 }}>{id ? 'Edit' : 'Create'} Electrical Inspection Report</Title>
        <Space>
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

          {/* Electrical System Info */}
          <Col xs={24}>
            <Card title="Electrical System Information" style={{ marginBottom: 24 }}>
              <Row gutter={16}>
                <Col xs={24} md={8}>
                  <Form.Item name="building_type" label="Building Type" style={{ marginBottom: 8 }}>
                    <Select placeholder="Select type" allowClear>
                      <Option value="Residential">Residential</Option>
                      <Option value="Commercial">Commercial</Option>
                      <Option value="Multi-Family">Multi-Family</Option>
                      <Option value="Industrial">Industrial</Option>
                    </Select>
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="panel_type" label="Panel Type" style={{ marginBottom: 8 }}>
                    <Select placeholder="Select panel" allowClear>
                      <Option value="Main Panel">Main Panel</Option>
                      <Option value="Sub Panel">Sub Panel</Option>
                      <Option value="Fuse Box">Fuse Box</Option>
                      <Option value="Distribution Board">Distribution Board</Option>
                    </Select>
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="panel_location" label="Panel Location" style={{ marginBottom: 8 }}>
                    <Input placeholder="e.g. Garage, Basement, Utility Room" />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={16}>
                <Col xs={24} md={8}>
                  <Form.Item name="panel_amperage" label="Panel Amperage" style={{ marginBottom: 8 }}>
                    <Select placeholder="Select amperage" allowClear>
                      <Option value="100A">100A</Option>
                      <Option value="150A">150A</Option>
                      <Option value="200A">200A</Option>
                      <Option value="400A">400A</Option>
                    </Select>
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="system_voltage" label="System Voltage" style={{ marginBottom: 8 }}>
                    <Select placeholder="Select voltage" allowClear>
                      <Option value="120/240V">120/240V</Option>
                      <Option value="120/208V">120/208V</Option>
                      <Option value="277/480V">277/480V</Option>
                    </Select>
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="meter_number" label="Meter Number" style={{ marginBottom: 8 }}>
                    <Input placeholder="Meter #" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="earthing_type" label="Earthing System" style={{ marginBottom: 8 }}>
                    <Select placeholder="Select type" allowClear>
                      <Option value="TN-S">TN-S</Option>
                      <Option value="TN-C-S">TN-C-S</Option>
                      <Option value="TT">TT</Option>
                      <Option value="IT">IT</Option>
                    </Select>
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Col>

          {/* Overall Assessment & Scope */}
          <Col xs={24}>
            <Card title="Overall Assessment" style={{ marginBottom: 24 }}>
              <Row gutter={16}>
                <Col xs={24} md={8}>
                  <Form.Item label="Assessment Result">
                    <Select
                      value={overallAssessment}
                      onChange={(val) => setOverallAssessment(val)}
                    >
                      <Option value="pending"><span style={{ color: '#999' }}>Pending</span></Option>
                      <Option value="satisfactory"><span style={{ color: '#1a7a1a', fontWeight: 600 }}>Satisfactory</span></Option>
                      <Option value="unsatisfactory"><span style={{ color: '#c00', fontWeight: 600 }}>Unsatisfactory</span></Option>
                    </Select>
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="next_inspection_date" label="Next Inspection Recommended">
                    <DatePicker style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="purpose_of_report" label="Purpose of Report">
                    <Select placeholder="Select purpose" allowClear defaultValue="water_damage">
                      <Option value="water_damage">Water Damage Assessment</Option>
                      <Option value="periodic">Periodic Inspection</Option>
                      <Option value="insurance_claim">Insurance Claim</Option>
                      <Option value="pre_purchase">Pre-Purchase</Option>
                      <Option value="other">Other</Option>
                    </Select>
                  </Form.Item>
                </Col>
                <Col xs={24}>
                  <Form.Item label="Extent & Limitations of Inspection">
                    <TextArea
                      rows={2}
                      value={extentAndLimitations}
                      onChange={(e) => setExtentAndLimitations(e.target.value)}
                      placeholder="e.g. Inspection limited to water-affected areas of basement and first floor. Areas behind intact drywall not accessible without demolition."
                    />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Col>

          {/* Inspection Checklist */}
          <Col xs={24}>
            <Card
              title="Inspection Checklist"
              style={{ marginBottom: 24 }}
              extra={
                <Button
                  size="small"
                  icon={<ClearOutlined />}
                  onClick={() => setInspectionChecklist(
                    JSON.parse(JSON.stringify(DEFAULT_INSPECTION_CHECKLIST))
                  )}
                >
                  Reset
                </Button>
              }
            >
              {inspectionChecklist.map((section, sIdx) => (
                <div key={sIdx} style={{ marginBottom: 16 }}>
                  <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 6,
                    borderLeft: '3px solid #333', paddingLeft: 8, background: '#f5f5f5', padding: '4px 8px' }}>
                    {section.title}
                  </Text>
                  <Table
                    size="small"
                    pagination={false}
                    dataSource={section.items.map((item, iIdx) => ({ ...item, key: `${sIdx}-${iIdx}`, _sIdx: sIdx, _iIdx: iIdx }))}
                    columns={[
                      { title: 'Item', dataIndex: 'label', width: '40%' },
                      {
                        title: 'Status', dataIndex: 'status', width: '120px',
                        render: (_: any, record: any) => (
                          <Select
                            value={record.status}
                            size="small"
                            style={{ width: 115 }}
                            onChange={(val) => {
                              const updated = [...inspectionChecklist];
                              updated[record._sIdx].items[record._iIdx].status = val;
                              setInspectionChecklist(updated);
                            }}
                          >
                            <Option value="OK"><span style={{ color: '#1a7a1a', fontWeight: 600 }}>OK</span></Option>
                            <Option value="DEFICIENT"><span style={{ color: '#c00', fontWeight: 600 }}>Deficient</span></Option>
                            <Option value="N/A"><span style={{ color: '#666' }}>N/A</span></Option>
                          </Select>
                        ),
                      },
                      {
                        title: 'Notes', dataIndex: 'note', width: '35%',
                        render: (_: any, record: any) => (
                          <Input
                            size="small"
                            value={record.note || ''}
                            placeholder="Add note..."
                            onChange={(e) => {
                              const updated = [...inspectionChecklist];
                              updated[record._sIdx].items[record._iIdx].note = e.target.value;
                              setInspectionChecklist(updated);
                            }}
                          />
                        ),
                      },
                    ]}
                  />
                </div>
              ))}
              {/* Summary */}
              {(() => {
                const allItems = inspectionChecklist.flatMap(s => s.items);
                const okCount = allItems.filter(i => i.status === 'OK').length;
                const defCount = allItems.filter(i => i.status === 'DEFICIENT').length;
                const naCount = allItems.filter(i => i.status === 'N/A').length;
                return (
                  <div style={{ marginTop: 8, padding: '8px 12px', background: '#fafafa', borderRadius: 4 }}>
                    <Space size={24}>
                      <Text><span style={{ color: '#1a7a1a', fontWeight: 'bold' }}>{okCount}</span> OK</Text>
                      <Text><span style={{ color: '#c00', fontWeight: 'bold' }}>{defCount}</span> Deficient</Text>
                      <Text><span style={{ color: '#666' }}>{naCount}</span> N/A</Text>
                      <Text type="secondary">Total: {allItems.length}</Text>
                    </Space>
                  </div>
                );
              })()}
            </Card>
          </Col>

          {/* Circuit Test Results */}
          <Col xs={24}>
            <Card
              title="Schedule of Circuit Test Results"
              style={{ marginBottom: 24 }}
              extra={
                <Button
                  type="primary"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setCircuitTestResults([...circuitTestResults, {
                      circuit_id: String(circuitTestResults.length + 1),
                      circuit_description: '',
                      protective_device: '',
                      conductor_size: '14/2 NM-B',
                      insulation_resistance: '',
                      continuity: '',
                      gfci_test: 'N/A',
                      status: 'N/A',
                    }]);
                  }}
                >
                  Add Circuit
                </Button>
              }
            >
              {circuitTestResults.length === 0 ? (
                <Text type="secondary">No circuit test results added. Click "Add Circuit" to record test data for affected circuits.</Text>
              ) : (
                <Table
                  size="small"
                  pagination={false}
                  dataSource={circuitTestResults.map((r, i) => ({ ...r, key: i, _idx: i }))}
                  scroll={{ x: 900 }}
                  columns={[
                    { title: '#', dataIndex: 'circuit_id', width: 50,
                      render: (_: any, record: any) => (
                        <Input size="small" value={record.circuit_id} style={{ width: 40 }}
                          onChange={(e) => { const u = [...circuitTestResults]; u[record._idx].circuit_id = e.target.value; setCircuitTestResults(u); }} />
                      ),
                    },
                    { title: 'Circuit', width: 160,
                      render: (_: any, record: any) => (
                        <Input size="small" value={record.circuit_description} placeholder="e.g. Kitchen outlets"
                          onChange={(e) => { const u = [...circuitTestResults]; u[record._idx].circuit_description = e.target.value; setCircuitTestResults(u); }} />
                      ),
                    },
                    { title: 'Device', width: 100,
                      render: (_: any, record: any) => (
                        <Input size="small" value={record.protective_device} placeholder="e.g. 20A"
                          onChange={(e) => { const u = [...circuitTestResults]; u[record._idx].protective_device = e.target.value; setCircuitTestResults(u); }} />
                      ),
                    },
                    { title: 'Wire', width: 100,
                      render: (_: any, record: any) => (
                        <Input size="small" value={record.conductor_size} placeholder="14/2 NM-B"
                          onChange={(e) => { const u = [...circuitTestResults]; u[record._idx].conductor_size = e.target.value; setCircuitTestResults(u); }} />
                      ),
                    },
                    { title: 'Insulation (MΩ)', width: 100,
                      render: (_: any, record: any) => (
                        <Input size="small" value={record.insulation_resistance} placeholder="MΩ or PASS"
                          onChange={(e) => { const u = [...circuitTestResults]; u[record._idx].insulation_resistance = e.target.value; setCircuitTestResults(u); }} />
                      ),
                    },
                    { title: 'Continuity (Ω)', width: 100,
                      render: (_: any, record: any) => (
                        <Input size="small" value={record.continuity} placeholder="Ω or PASS"
                          onChange={(e) => { const u = [...circuitTestResults]; u[record._idx].continuity = e.target.value; setCircuitTestResults(u); }} />
                      ),
                    },
                    { title: 'GFCI', width: 80,
                      render: (_: any, record: any) => (
                        <Select size="small" value={record.gfci_test} style={{ width: 75 }}
                          onChange={(val) => { const u = [...circuitTestResults]; u[record._idx].gfci_test = val; setCircuitTestResults(u); }}>
                          <Option value="PASS">PASS</Option>
                          <Option value="FAIL">FAIL</Option>
                          <Option value="N/A">N/A</Option>
                        </Select>
                      ),
                    },
                    { title: 'Status', width: 100,
                      render: (_: any, record: any) => (
                        <Select size="small" value={record.status} style={{ width: 95 }}
                          onChange={(val) => { const u = [...circuitTestResults]; u[record._idx].status = val; setCircuitTestResults(u); }}>
                          <Option value="OK"><span style={{ color: '#1a7a1a', fontWeight: 600 }}>OK</span></Option>
                          <Option value="DEFICIENT"><span style={{ color: '#c00', fontWeight: 600 }}>Deficient</span></Option>
                          <Option value="N/A"><span style={{ color: '#666' }}>N/A</span></Option>
                        </Select>
                      ),
                    },
                    { title: '', width: 40,
                      render: (_: any, record: any) => (
                        <Button size="small" type="text" danger icon={<DeleteOutlined />}
                          onClick={() => setCircuitTestResults(circuitTestResults.filter((_, i) => i !== record._idx))} />
                      ),
                    },
                  ]}
                />
              )}
            </Card>
          </Col>

          {/* Report Content */}
          <Col xs={24}>
            <Card title="Findings & Assessment" style={{ marginBottom: 24 }}>
              <Form.Item label="Cause of Damage">
                <RichTextEditor
                  value={siteFindings}
                  onChange={setSiteFindings}
                  placeholder="Describe the cause of electrical damage..."
                  minHeight={120}
                />
              </Form.Item>

              <Form.Item label="Electrical Findings">
                <RichTextEditor
                  value={electricalFindings}
                  onChange={setElectricalFindings}
                  placeholder="Detailed inspection findings — panel condition, circuit status, visible damage..."
                  minHeight={150}
                />
              </Form.Item>

              <Form.Item label="Safety Concerns" style={{ marginBottom: 8 }}>
                <RichTextEditor
                  value={safetyConcerns}
                  onChange={setSafetyConcerns}
                  placeholder="Any safety issues found (fire hazards, shock risks, etc.)..."
                  minHeight={100}
                />
              </Form.Item>

              <Form.Item label="NEC Code Violations" style={{ marginBottom: 8 }}>
                <RichTextEditor
                  value={codeViolations}
                  onChange={setCodeViolations}
                  placeholder="Reference specific NEC code sections violated..."
                  minHeight={100}
                />
              </Form.Item>

              <Form.Item label="Work Performed">
                <RichTextEditor
                  value={workPerformed}
                  onChange={setWorkPerformed}
                  placeholder="Describe the electrical work performed..."
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
                      <HolderOutlined style={{ color: '#999', fontSize: '12px' }} />
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

          {/* Photo Documentation */}
          <Col xs={24}>
            <Card
              title={`Photo Documentation (${photos.length} photos)`}
              style={{ marginBottom: 24 }}
              extra={
                <Button
                  type="primary"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.multiple = true;
                    input.onchange = (e: any) => {
                      const files = Array.from(e.target.files || []) as File[];
                      if (files.length) handlePhotoFiles(files);
                    };
                    input.click();
                  }}
                >
                  Add Photos
                </Button>
              }
            >
              {photos.length === 0 ? (
                <div
                  style={{
                    border: '2px dashed #d9d9d9', borderRadius: 8, padding: '40px 20px',
                    textAlign: 'center', color: '#999', cursor: 'pointer',
                  }}
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.multiple = true;
                    input.onchange = (e: any) => {
                      const files = Array.from(e.target.files || []) as File[];
                      if (files.length) handlePhotoFiles(files);
                    };
                    input.click();
                  }}
                >
                  <PlusOutlined style={{ fontSize: 24, marginBottom: 8 }} />
                  <p>Click to add photos or drag files here</p>
                  <p style={{ fontSize: 12 }}>Supports multiple files. Recommended: 10+ photos for thorough documentation.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  {photos.map((photo, idx) => (
                    <div
                      key={photo.id}
                      style={{
                        width: 180, border: '1px solid #e8e8e8', borderRadius: 6,
                        overflow: 'hidden', background: '#fafafa',
                      }}
                    >
                      <div style={{ position: 'relative' }}>
                        <img
                          src={photo.url}
                          alt={photo.caption || 'Photo'}
                          style={{ width: '100%', height: 130, objectFit: 'cover' }}
                        />
                        <Popconfirm
                          title="Delete this photo?"
                          onConfirm={() => setPhotos((prev) => prev.filter((p) => p.id !== photo.id))}
                          okText="Delete"
                          cancelText="Cancel"
                        >
                          <Button
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            style={{
                              position: 'absolute', top: 4, right: 4,
                              background: 'rgba(255,255,255,0.85)', border: 'none',
                            }}
                          />
                        </Popconfirm>
                      </div>
                      <div style={{ padding: '6px 8px' }}>
                        <Select
                          size="small"
                          value={photo.category}
                          style={{ width: '100%', marginBottom: 4 }}
                          onChange={(val) => {
                            const updated = [...photos];
                            updated[idx] = { ...updated[idx], category: val };
                            setPhotos(updated);
                          }}
                        >
                          <Option value="damage">Water Damage</Option>
                          <Option value="panel">Electrical Panel</Option>
                          <Option value="fixture">Light Fixture</Option>
                          <Option value="wiring">Wiring / Junction</Option>
                          <Option value="outlet">Outlet / Switch</Option>
                          <Option value="moisture">Moisture / Staining</Option>
                          <Option value="before">Before</Option>
                          <Option value="after">After Repair</Option>
                          <Option value="other">Other</Option>
                        </Select>
                        <Input
                          size="small"
                          value={photo.caption || ''}
                          placeholder="Caption..."
                          onChange={(e) => {
                            const updated = [...photos];
                            updated[idx] = { ...updated[idx], caption: e.target.value };
                            setPhotos(updated);
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
                    const info = await electricianReportService.getPAEmailInfo(id);
                    setPaEmailInfo(info);
                    if (info.message && info.to.length === 0) {
                      message.warning(info.message);
                      return;
                    }
                    const address = form.getFieldValue('address') || '';
                    paForm.setFieldsValue({
                      to_addresses: info.to.map((t) => t.email),
                      cc_addresses: info.cc.map((c) => c.email),
                      subject: `Electrical Inspection Report — ${address}`,
                      body_html:
                        `<p>Please find attached the Electrical Inspection Report for ${address}.</p>` +
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
              onClick={() => navigate('/electrician-reports')}
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

      {/* AI Prompt Template Modal */}
      <Modal
        title={
          <Space>
            <RobotOutlined />
            <span>AI Prompt — Job Details</span>
          </Space>
        }
        open={promptModalVisible}
        onCancel={() => setPromptModalVisible(false)}
        width={720}
        footer={[
          <Button key="close" onClick={() => setPromptModalVisible(false)}>
            Close
          </Button>,
          <Button
            key="copy"
            type="primary"
            icon={<CopyOutlined />}
            disabled={!promptInputs.affected_items.some(i => i.area.trim())}
            onClick={() => {
              const p = promptInputs;
              const affectedList = p.affected_items
                .filter(i => i.area.trim())
                .map((i, idx) => {
                  const line = `  ${idx + 1}. ${i.area}`;
                  return i.items.trim() ? `${line} — ${i.items}` : line;
                })
                .join('\n');
              const jobDetails = [
                `- Affected areas & non-working items:\n${affectedList}`,
                `- Source of water: ${p.water_source || '(not specified)'}`,
                `- State: ${p.state || 'MD'}`,
                p.total_amount ? `- Total invoice amount: $${p.total_amount}` : '- Total invoice amount: (use your best judgment based on scope)',
                p.smoke_detectors ? `- Smoke detectors affected: ${p.smoke_detectors}` : '- Smoke detectors affected: NONE (do NOT add smoke detectors to report)',
                p.drywall_cuts ? `- Drywall cut & patch: ${p.drywall_cuts}` : '',
                p.photo_description ? `- Attached photos: ${p.photo_description}` : '',
                p.additional_context ? `- Additional context: ${p.additional_context}` : '',
              ].filter(Boolean).join('\n');

              const hasPhotos = p.photo_description.trim();
              const photoInstruction = hasPhotos
                ? `\nIMPORTANT: I am attaching photos of the damage. Analyze them carefully and incorporate what you see into the findings, checklist status, and recommendations. Reference specific photo observations in your report (e.g. "as shown in attached photos, corrosion is visible on...").\n`
                : '';

              const fullPrompt = `You are an experienced licensed master electrician in the DMV area (DC, Maryland, Virginia).
Write a professional electrical inspection report for a water-damage-related service call at a single-family home or townhouse.
---
SCENARIO:
The property experienced water damage (e.g. burst pipe, roof leak, flooding).
As a result, certain electrical components — primarily recessed lights (cans),
ceiling fixtures, switches, and/or outlets in the affected area — are no longer
operational. The homeowner or restoration company has called for an electrical
inspection to assess the damage and provide a repair estimate.
---
JOB DETAILS:
${jobDetails}
---${photoInstruction}
${document.getElementById('electrician-prompt-requirements')?.textContent || ''}`;

              navigator.clipboard.writeText(fullPrompt).then(() => {
                message.success('Complete prompt copied to clipboard!');
              });
            }}
          >
            Copy Complete Prompt
          </Button>,
        ]}
      >
        {/* Input Fields */}
        <div style={{ marginBottom: 16 }}>
          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            Fill in the job details below, then click "Copy Complete Prompt" to copy the full prompt with your inputs.
          </Text>
          <Row gutter={[12, 12]}>
            <Col xs={24}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Affected Areas & Non-working Items *</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {promptInputs.affected_items.map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Text type="secondary" style={{ fontSize: 12, minWidth: 20, textAlign: 'right' }}>{idx + 1}.</Text>
                    <Input
                      placeholder="Area (e.g. basement ceiling)"
                      value={item.area}
                      style={{ flex: 1 }}
                      onChange={(e) => {
                        const updated = [...promptInputs.affected_items];
                        updated[idx] = { ...updated[idx], area: e.target.value };
                        setPromptInputs(prev => ({ ...prev, affected_items: updated }));
                      }}
                    />
                    <Input
                      placeholder="Items (e.g. 3 recessed lights, 2 outlets)"
                      value={item.items}
                      style={{ flex: 1 }}
                      onChange={(e) => {
                        const updated = [...promptInputs.affected_items];
                        updated[idx] = { ...updated[idx], items: e.target.value };
                        setPromptInputs(prev => ({ ...prev, affected_items: updated }));
                      }}
                    />
                    {promptInputs.affected_items.length > 1 && (
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => {
                          const updated = promptInputs.affected_items.filter((_, i) => i !== idx);
                          setPromptInputs(prev => ({ ...prev, affected_items: updated }));
                        }}
                      />
                    )}
                  </div>
                ))}
              </div>
              <Button
                type="dashed"
                size="small"
                icon={<PlusOutlined />}
                style={{ marginTop: 6 }}
                onClick={() => setPromptInputs(prev => ({
                  ...prev,
                  affected_items: [...prev.affected_items, { area: '', items: '' }],
                }))}
              >
                Add Area
              </Button>
            </Col>
            <Col xs={24} md={12}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Source of Water</label>
              <Input
                placeholder="e.g. burst pipe above, roof leak, toilet overflow"
                value={promptInputs.water_source}
                onChange={(e) => setPromptInputs(prev => ({ ...prev, water_source: e.target.value }))}
              />
            </Col>
            <Col xs={24} md={6}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>State</label>
              <Select
                value={promptInputs.state}
                onChange={(val) => setPromptInputs(prev => ({ ...prev, state: val }))}
                style={{ width: '100%' }}
              >
                <Option value="MD">Maryland</Option>
                <Option value="VA">Virginia</Option>
                <Option value="DC">DC</Option>
              </Select>
            </Col>
            <Col xs={24} md={6}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Total Amount ($)</label>
              <Input
                placeholder="e.g. 3500"
                value={promptInputs.total_amount}
                onChange={(e) => setPromptInputs(prev => ({ ...prev, total_amount: e.target.value.replace(/[^0-9.,]/g, '') }))}
              />
            </Col>
            <Col xs={24} md={12}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Smoke Detectors Affected</label>
              <Input
                placeholder="e.g. 2 in basement, 1 in hallway (leave blank if none)"
                value={promptInputs.smoke_detectors}
                onChange={(e) => setPromptInputs(prev => ({ ...prev, smoke_detectors: e.target.value }))}
              />
              <Text type="secondary" style={{ fontSize: 11 }}>
                Leave blank = AI will NOT include smoke detectors in the report
              </Text>
            </Col>
            <Col xs={24} md={12}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Drywall Cut & Patch</label>
              <Input
                placeholder="e.g. 3 access holes in basement ceiling, 2 in hallway wall"
                value={promptInputs.drywall_cuts}
                onChange={(e) => setPromptInputs(prev => ({ ...prev, drywall_cuts: e.target.value }))}
              />
              <Text type="secondary" style={{ fontSize: 11 }}>
                Drywall cuts needed for wiring access — will add patch labor/materials to invoice
              </Text>
            </Col>
            <Col xs={24}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Attached Photos Description (optional)</label>
              <TextArea
                rows={2}
                placeholder="e.g. I'm attaching 12 photos showing: water-stained ceiling with exposed recessed light housings, corroded junction boxes, tripped breaker panel, damaged Romex wiring..."
                value={promptInputs.photo_description}
                onChange={(e) => setPromptInputs(prev => ({ ...prev, photo_description: e.target.value }))}
              />
              <Text type="secondary" style={{ fontSize: 11 }}>
                Describe the photos you'll attach to the AI chat. The AI will reference them in the report.
              </Text>
            </Col>
            <Col xs={24}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Additional Context (optional)</label>
              <TextArea
                rows={2}
                placeholder="e.g. Townhouse, finished basement, homeowner reported smell of burnt wire..."
                value={promptInputs.additional_context}
                onChange={(e) => setPromptInputs(prev => ({ ...prev, additional_context: e.target.value }))}
              />
            </Col>
          </Row>
        </div>

        <Divider style={{ margin: '12px 0' }} />

        {/* Prompt Preview (collapsible) */}
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: '#666', marginBottom: 8 }}>
            View full prompt template
          </summary>
          <div
            id="electrician-prompt-requirements"
            style={{
              maxHeight: '40vh',
              overflowY: 'auto',
              background: '#f5f5f5',
              borderRadius: 8,
              padding: 16,
              fontSize: 12,
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              fontFamily: 'monospace',
            }}
          >{`REPORT REQUIREMENTS:

1. CAUSE OF DAMAGE (→ site_findings)
   - Briefly describe the water event that caused the electrical issue
   - State that the water damage resulted in loss of power to specific
     fixtures/circuits in the affected area
   - Use factual, field technician language
   - Do NOT mention age of wiring, wear and tear, or maintenance history
   - Do NOT imply fault or omission on the homeowner's part

2. ELECTRICAL FINDINGS (→ electrical_findings)
   - Describe what was found during inspection:
     * Which recessed lights / fixtures are non-operational
     * Moisture or corrosion observed in junction boxes, wire connectors
     * Condition of Romex/NM cable in the affected area
     * Results of circuit testing (continuity, insulation resistance)
     * Breaker status (tripped, functional)
   - Reference specific areas/rooms
   - Mention if insulation or drywall removal was needed for access

3. SAFETY CONCERNS (→ safety_concerns)
   - Any immediate safety hazards found (short circuit risk, shock hazard)
   - Whether circuits were de-energized for safety
   - Smoke/CO detector status in affected area

4. WORK PERFORMED (→ work_performed)
   - Describe the inspection work done:
     * De-energized circuits, removed fixtures/trim for inspection
     * Tested circuits with meter/megger
     * Documented findings and photographed damage
   - If repairs were done on-site, describe them
   - Written as a field technician narrative

5. RECOMMENDATIONS (→ recommendations)
   - List specific repairs needed with quantities:
     * Replace X recessed light housings + trim
     * Replace X junction boxes and wire connectors
     * Re-pull X feet of Romex/NM cable
     * Replace X outlets/switches
     * Smoke detectors ONLY if specified in JOB DETAILS
     * Drywall cut & patch if specified in JOB DETAILS
   - If drywall cuts are specified, include patching in recommendations
   - Note: large drywall/insulation restoration by separate trade
   - Recommend re-inspection after drying period if applicable

6. INVOICE (→ invoice_items)
   - 5-10 line items typical for this scope:
     * Inspection / Service Call Fee
     * Labor — Fixture Removal & Circuit Testing
     * Labor — Recessed Light Replacement (X units)
     * Labor — Wiring Repair / Re-pull
     * Materials — Recessed light housings, trim kits
     * Materials — Wire, connectors, junction boxes
     * Materials — Outlets, switches, cover plates (if needed)
     * Labor — Drywall Cut & Patch (ONLY if specified in JOB DETAILS)
     * Materials — Drywall patch, joint compound, tape (ONLY if drywall specified)
     * Smoke detectors (ONLY if specified in JOB DETAILS)
   - Do NOT add smoke detector line items unless user specified them
   - Do NOT add drywall line items unless user specified them
   - tax_amount and total must match the specified invoice amount

7. INSPECTION CHECKLIST (→ inspection_checklist)
   - Fill in status for each item based on findings
   - Status values: "OK", "DEFICIENT", "N/A"
   - Add notes for DEFICIENT items explaining the issue
   - Sections & items (use EXACT labels):
     * "Affected Lighting — Recessed Lights & Fixtures":
       Recessed lights (cans) — operational test,
       Recessed light housings — moisture / corrosion,
       Recessed light wiring & connectors,
       Recessed light trim & lens condition,
       Surface-mount ceiling fixtures — operational,
       Pendant / chandelier fixtures,
       Ceiling fan / light combo units,
       Under-cabinet / vanity lighting
     * "Water Damage Assessment — Electrical":
       Ceiling junction boxes — moisture intrusion,
       Wall outlet boxes — water staining / corrosion,
       Switch boxes — moisture / corrosion,
       Wire insulation — discoloration / degradation,
       Wire connectors (wire nuts) — corrosion,
       Romex / NM cable in affected area — condition,
       Conduit / raceway — water accumulation
     * "Circuits & Breakers — Affected Area":
       Breaker(s) serving affected area — tripped / functional,
       Circuit continuity test — affected circuits,
       Insulation resistance (megger) test,
       Ground fault on affected circuits,
       AFCI breaker function (if applicable),
       GFCI outlets in wet areas — trip test
     * "Panel & Service (General Condition)":
       Main panel — signs of moisture / corrosion,
       Bus bars & breaker connections,
       Grounding / bonding system,
       Panel labeling / circuit directory
     * "Safety & Smoke / CO Detection":
       Smoke detectors in affected area — functional,
       CO detectors — functional,
       Exhaust fans (bath / kitchen) — operational,
       Arc / burn marks at any device or junction
   - Mark items as N/A if not present in the property
   - Only include sections/items that are relevant
   - Smoke detectors: mark as "N/A" unless user specified them in JOB DETAILS
   - Do NOT mark smoke detectors as DEFICIENT unless user explicitly said they're damaged

8. OVERALL ASSESSMENT (→ overall_assessment, extent_and_limitations)
   - overall_assessment: "satisfactory" or "unsatisfactory"
     * If ANY item is DEFICIENT → must be "unsatisfactory"
   - extent_and_limitations: 1-2 sentences about what was inspected and
     any limitations (e.g. "Inspection limited to water-affected areas.
     Areas behind intact drywall not accessible.")

9. WARRANTY & NOTES (→ warranty_info, notes)
   - warranty_info: 1-year labor warranty on all electrical work performed
   - notes: Follow-up advisory (e.g. "Allow affected areas to fully dry
     before ceiling/wall restoration. Re-inspection recommended if
     additional water-damaged wiring is discovered during drywall work.")

WRITING STYLE — CRITICAL:
Write like a real field electrician filling out a report on a tablet, NOT like an AI writing an essay.

DO:
- Use short, direct bullet points. One fact per line.
- Start sentences with the thing, not "Upon arrival" or "Inspection revealed"
- Use abbreviations naturally: "qty", "approx", "w/", "J-box", "NM-B"
- Be specific: room names, fixture counts, wire gauges, breaker numbers
- Write what you SAW, not what "was observed" or "was noted"
- Keep notes under 15 words per bullet
- Vary sentence structure — mix fragments with short sentences

DO NOT:
- Start with "Upon arrival at the property, technician was informed/advised..."
- Use "Inspection of the affected area revealed the following:"
- Write long flowing paragraphs — use \\n bullet lists
- Use passive voice ("was found", "was observed", "were noted")
- Repeat the same sentence pattern for every bullet
- Use filler: "as a direct result of", "consistent with", "at the time of inspection"
- Sound like a legal document or insurance report
- Use the word "technician" — just describe what was done
- FABRICATE items not mentioned in JOB DETAILS. Especially:
  * Do NOT add smoke detectors unless explicitly listed
  * Do NOT add drywall work unless explicitly listed
  * Do NOT invent extra fixtures or outlets beyond what was provided
  * Only report what the user actually described

GOOD EXAMPLE style:
  "Water from 2nd floor bathroom came down through ceiling into basement. Damaged wiring and fixtures in bar area, bedroom, hallway."
  NOT: "Upon arrival at the property, technician was advised by the homeowner and restoration company that a water event originating from a supply/drain failure at the second-floor bathroom had released water down through the wall and ceiling cavities into the lower levels of the home."

GOOD EXAMPLE bullet style:
  "- Bar area: 2 recessed cans dead, corrosion on sockets\\n- Bedroom: 2 cans out, 7 outlets no power\\n- Hallway: 1 can out, 1 outlet dead"
  NOT: "- 9 recessed light housings (4-inch and 6-inch cans) were non-operational: 1 above the bar, 2 near the bar, 1 above the pool table, 2 in the bedroom, 1 in the hallway, and 2 in the dining room. Housings showed moisture intrusion with corrosion on socket bases and at wire connections."

Avoid these words/phrases entirely:
- "upon arrival", "was advised", "was informed"
- "revealed the following", "as noted above"
- "consistent with", "at the time of inspection"
- "as a direct result of the water intrusion"
- "present a potential", "must remain"
- wear and tear, deterioration, age-related, neglect, deferred maintenance
- any language implying homeowner fault
---
OUTPUT FORMAT: Return ONLY a valid JSON object (no markdown, no code fences).
Use \\n for line breaks within fields. Keep each bullet SHORT.
{
  "site_findings": "Water from 2nd floor bathroom (supply line failure) came down through ceiling/walls into basement.\\nDamaged fixtures and wiring in bar area, bedroom, hallway, dining room, laundry, closet, bathroom.\\nMultiple lighting circuits and receptacle circuits lost power from water intrusion.",
  "electrical_findings": "- Bar area: 1 recessed can dead, corroded socket and wire nuts\\n- Near bar: 2 cans out, moisture in J-boxes\\n- Pool table area: 1 can out, water staining in housing\\n- Bedroom: 2 cans dead, 7 outlets no power — corrosion at terminals\\n- Hallway: 1 can out, 1 outlet dead\\n- Dining room: 2 cans out, corroded connections\\n- Laundry: wrap fixture dead, water in canopy\\n- Closet: surface-mount fixture out, moisture in box\\n- Bathroom: 4-light vanity dead, corrosion at mounting strap\\n- Bar area: 4 outlets no power, water staining in boxes\\n\\nWiring: 14/2 and 12/2 NM-B in affected ceiling/walls shows discolored insulation, moisture wicking into conductors.\\nJ-boxes: corroded wire nuts, green oxidation on copper throughout.\\nMegger test: insulation resistance below threshold on affected circuits.\\nHad to open some ceiling/wall sections to access J-boxes and trace cable runs.",
  "safety_concerns": "- Affected breakers found tripped (moisture-induced fault)\\n- All affected circuits locked out before inspection\\n- No arc marks or burn damage found",
  "work_performed": "- Locked out all affected circuits at main panel\\n- Pulled recessed trims/housings, fixture canopies, cover plates\\n- Opened ceiling/wall access points to trace NM cable\\n- Voltage, continuity, and megger testing on all affected circuits\\n- Photographed damage at each location\\n- Replaced worst corroded wire nuts, capped exposed conductors\\n- Left affected circuits de-energized until full repair + dry-out",
  "recommendations": "Repairs needed:\\n- 9 recessed housings (IC-rated) + LED trim kits\\n- 1 laundry wrap fixture, 1 closet ceiling fixture, 1 bathroom vanity (4-light)\\n- All corroded wire nuts and affected J-boxes in ceiling/wall cavities\\n- Re-pull approx 90ft of 14/2 and 12/2 NM-B\\n- 12 receptacles (7 bedroom, 1 hallway, 4 bar) + cover plates\\n- Cut and patch drywall at 5 access points (3 basement ceiling, 2 hallway wall)\\n- Final circuit test, megger, and re-energize\\n\\nLarge drywall/insulation/finish restoration by separate trade. Re-inspect any newly exposed wiring after demo.",
  "inspection_checklist": [
    {
      "title": "Affected Lighting — Recessed Lights & Fixtures",
      "items": [
        { "label": "Recessed lights (cans) — operational test", "status": "DEFICIENT", "note": "9 cans dead across bar, bedroom, hallway, dining" },
        { "label": "Recessed light housings — moisture / corrosion", "status": "DEFICIENT", "note": "Corroded sockets, moisture in housings" },
        { "label": "Recessed light wiring & connectors", "status": "DEFICIENT", "note": "Corroded wire nuts, oxidized copper — shock hazard" },
        { "label": "Recessed light trim & lens condition", "status": "OK", "note": "Water-stained trims, need replacement" },
        { "label": "Surface-mount ceiling fixtures — operational", "status": "DEFICIENT", "note": "Laundry wrap + closet fixture dead" },
        { "label": "Pendant / chandelier fixtures", "status": "N/A" },
        { "label": "Ceiling fan / light combo units", "status": "N/A" },
        { "label": "Under-cabinet / vanity lighting", "status": "DEFICIENT", "note": "Bathroom vanity (4-light) dead, corroded strap" }
      ]
    },
    {
      "title": "Water Damage Assessment — Electrical",
      "items": [
        { "label": "Ceiling junction boxes — moisture intrusion", "status": "DEFICIENT", "note": "Water residue + corroded wire nuts" },
        { "label": "Wall outlet boxes — water staining / corrosion", "status": "DEFICIENT", "note": "Bedroom/hallway/bar boxes water-stained" },
        { "label": "Switch boxes — moisture / corrosion", "status": "OK" },
        { "label": "Wire insulation — discoloration / degradation", "status": "DEFICIENT", "note": "NM-B insulation discolored, moisture wicking" },
        { "label": "Wire connectors (wire nuts) — corrosion", "status": "DEFICIENT", "note": "Corroded throughout affected J-boxes" },
        { "label": "Romex / NM cable in affected area — condition", "status": "DEFICIENT", "note": "14/2 + 12/2 degraded, needs re-pull" },
        { "label": "Conduit / raceway — water accumulation", "status": "N/A" }
      ]
    },
    {
      "title": "Circuits & Breakers — Affected Area",
      "items": [
        { "label": "Breaker(s) serving affected area — tripped / functional", "status": "DEFICIENT", "note": "Lighting + receptacle breakers tripped" },
        { "label": "Circuit continuity test — affected circuits", "status": "DEFICIENT", "note": "Open paths on affected circuits" },
        { "label": "Insulation resistance (megger) test", "status": "DEFICIENT", "note": "Below threshold on affected runs" },
        { "label": "Ground fault on affected circuits", "status": "DEFICIENT", "note": "Moisture-induced fault" },
        { "label": "AFCI breaker function (if applicable)", "status": "OK" },
        { "label": "GFCI outlets in wet areas — trip test", "status": "OK" }
      ]
    },
    {
      "title": "Panel & Service (General Condition)",
      "items": [
        { "label": "Main panel — signs of moisture / corrosion", "status": "OK" },
        { "label": "Bus bars & breaker connections", "status": "OK" },
        { "label": "Grounding / bonding system", "status": "OK" },
        { "label": "Panel labeling / circuit directory", "status": "OK" }
      ]
    },
    {
      "title": "Safety & Smoke / CO Detection",
      "items": [
        { "label": "Smoke detectors in affected area — functional", "status": "N/A" },
        { "label": "CO detectors — functional", "status": "N/A" },
        { "label": "Exhaust fans (bath / kitchen) — operational", "status": "N/A" },
        { "label": "Arc / burn marks at any device or junction", "status": "OK" }
      ]
    }
  ],
  "invoice_items": [
    {
      "name": "Electrical Inspection / Service Call",
      "description": "Inspect water-damaged electrical, circuit testing, megger, photo doc",
      "quantity": 1,
      "unit": "EA",
      "unit_cost": 285.00
    },
    {
      "name": "Labor — Fixture Removal & Testing",
      "description": "Pull trims/housings/covers, de-energize, test affected circuits",
      "quantity": 8,
      "unit": "HR",
      "unit_cost": 145.00
    },
    {
      "name": "Labor — Lighting Replacement",
      "description": "Install 9 recessed + laundry wrap + closet fixture + bathroom vanity",
      "quantity": 14,
      "unit": "HR",
      "unit_cost": 145.00
    },
    {
      "name": "Labor — Outlet Replacement & Wiring",
      "description": "Replace 12 receptacles, re-pull NM cable, replace J-boxes/connectors",
      "quantity": 10,
      "unit": "HR",
      "unit_cost": 145.00
    },
    {
      "name": "Materials — Lighting",
      "description": "9x IC-rated housings + LED trims, wrap fixture, ceiling fixture, vanity",
      "quantity": 1,
      "unit": "LOT",
      "unit_cost": 1420.00
    },
    {
      "name": "Materials — Wire & Boxes",
      "description": "14/2 + 12/2 NM-B (~90ft), wire nuts, J-boxes, staples",
      "quantity": 1,
      "unit": "LOT",
      "unit_cost": 865.00
    },
    {
      "name": "Materials — Devices",
      "description": "12x receptacles, switches, cover plates",
      "quantity": 1,
      "unit": "LOT",
      "unit_cost": 390.00
    },
    {
      "name": "Labor — Drywall Cut & Patch",
      "description": "Cut 5 access holes for wiring access, patch w/ drywall, tape, mud",
      "quantity": 6,
      "unit": "HR",
      "unit_cost": 95.00
    },
    {
      "name": "Materials — Drywall Patch",
      "description": "Drywall pieces, joint compound, mesh tape, screws",
      "quantity": 1,
      "unit": "LOT",
      "unit_cost": 120.00
    }
  ],
  "tax_amount": 0,
  "overall_assessment": "unsatisfactory",
  "extent_and_limitations": "Inspection limited to water-affected areas of basement and first floor. Areas behind intact drywall not accessible without demolition.",
  "warranty_info": "1-year workmanship warranty on all electrical work from date of completion.",
  "notes": "Let affected areas dry fully before ceiling/wall restoration. If more damaged wiring found during demo, supplemental estimate may be needed. Drywall/insulation/paint by separate trade."
}`}</div>
        </details>
      </Modal>

      {/* Report Preview Modal */}
      <Modal
        title="Report Preview"
        open={previewModalVisible}
        onCancel={handleClosePreview}
        footer={[
          <Button key="close" onClick={handleClosePreview}>Close</Button>,
          <Button
            key="print-no-photo"
            icon={<EyeOutlined />}
            onClick={() => {
              const iframe = document.getElementById('report-preview-iframe') as HTMLIFrameElement;
              if (iframe?.contentWindow) {
                iframe.contentWindow.print();
              }
            }}
          >
            Print (no photos)
          </Button>,
          <Button
            key="print-photos"
            type="primary"
            icon={<EyeOutlined />}
            loading={isDownloadingPdf}
            onClick={async () => {
              if (!previewReportData) return;
              setIsDownloadingPdf(true);
              try {
                // Compress photos for print (shrink base64 for fast browser rendering)
                const compressForPrint = (dataUrl: string): Promise<string> => {
                  return new Promise((resolve) => {
                    const img = new Image();
                    img.onload = () => {
                      const canvas = document.createElement('canvas');
                      let w = img.width, h = img.height;
                      const max = 600;
                      if (w > max || h > max) {
                        if (w > h) { h = Math.round((h * max) / w); w = max; }
                        else { w = Math.round((w * max) / h); h = max; }
                      }
                      canvas.width = w;
                      canvas.height = h;
                      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
                      resolve(canvas.toDataURL('image/jpeg', 0.45));
                    };
                    img.onerror = () => resolve(dataUrl);
                    img.src = dataUrl;
                  });
                };

                const compressedPhotos = await Promise.all(
                  (previewReportData.photos || []).map(async (p) => ({
                    ...p,
                    url: p.url.startsWith('data:') ? await compressForPrint(p.url) : p.url,
                  }))
                );

                // Get HTML without photos from server, inject compressed photos client-side
                const reportNoPhotos = { ...previewReportData, photos: [] };
                const htmlContent = await electricianReportService.previewHTML(reportNoPhotos, {
                  include_photos: false,
                  include_financial: true,
                });

                const photoHtml = `
                  <div style="margin-top:12px;border-bottom:1px solid #333;padding-bottom:4px;font-weight:bold;font-size:14px;">Photo Documentation</div>
                  <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:8px;">
                    ${compressedPhotos.map(p => `
                      <div style="width:48%;break-inside:avoid;margin-bottom:8px;">
                        <img src="${p.url}" style="width:100%;max-height:280px;object-fit:contain;background:#f5f5f5;border:1px solid #ddd;border-radius:3px;display:block;" />
                        <p style="font-size:11px;color:#555;margin-top:3px;text-align:center;"><strong>${({damage:'Water Damage',panel:'Electrical Panel',fixture:'Light Fixture',wiring:'Wiring / Junction Box',outlet:'Outlet / Switch',moisture:'Moisture / Staining',before:'Before',during:'During',after:'After Repair',other:'Other'} as Record<string,string>)[p.category || ''] || p.category || ''}</strong>${p.caption ? ': ' + p.caption : ''}</p>
                      </div>
                    `).join('')}
                  </div>`;

                let finalHtml = htmlContent.replace('</div>\n</body>', photoHtml + '</div>\n</body>');
                if (!finalHtml.includes('Photo Documentation')) {
                  finalHtml = htmlContent.replace('</body>', photoHtml + '</body>');
                }

                const blob = new Blob([finalHtml], { type: 'text/html' });
                const url = URL.createObjectURL(blob);
                window.open(url, '_blank');
              } catch {
                message.error('Failed to generate report with photos');
              } finally {
                setIsDownloadingPdf(false);
              }
            }}
          >
            Print with Photos
          </Button>,
        ]}
        width="90vw"
        style={{ top: 20 }}
        styles={{ body: { height: 'calc(90vh - 110px)', padding: 0 } }}
      >
        {previewHtmlUrl && (
          <iframe
            id="report-preview-iframe"
            src={previewHtmlUrl}
            style={{ width: '100%', height: '100%', border: 'none' }}
            title="Report Preview"
          />
        )}
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
            <span>Send Electrician Report to PA</span>
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
            await electricianReportService.sendToPA(id!, {
              to_addresses: values.to_addresses,
              cc_addresses: values.cc_addresses || [],
              subject: values.subject,
              body_html: values.body_html,
              email_account_id: values.email_account_id || undefined,
            });
            message.success('Electrician Report sent to PA successfully!');
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
                    label: a.display_name || a.email_address,
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
            >
              <TextArea rows={5} />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </div>
  );
};

export default ElectricianReportCreation;
