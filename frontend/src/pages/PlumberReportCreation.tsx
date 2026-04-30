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
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate, useParams } from 'react-router-dom';
import {
  plumberReportService,
  PlumberReport,
  InvoiceItem,
  PaymentRecord,
  PhotoRecord
} from '../services/plumberReportService';
import { companyService } from '../services/companyService';
import { clientService } from '../services/clientService';
import { Company } from '../types';
import type { ClientListItem } from '../types/client';
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

const PlumberReportCreation: React.FC = () => {
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
  
  // Prompt modal state
  const [promptModalVisible, setPromptModalVisible] = useState(false);
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
      // e.g. "5213 Ashcroft Ct, Fairfax, VA 22032"
      if (street && !city && !state && !zipcode) {
        const parts = street.split(',').map((p) => p.trim());
        if (parts.length >= 3) {
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
          street = parts[0];
          const lastPart = parts[1];
          const stateZipMatch = lastPart.match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
          if (stateZipMatch) {
            state = stateZipMatch[1];
            zipcode = stateZipMatch[2];
          } else {
            city = lastPart;
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

  const totals = calculateTotals();

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={2} style={{ margin: 0 }}>{id ? 'Edit' : 'Create'} Plumber's Report</Title>
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
                    <Input placeholder="Enter street address" />
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
                      <Input placeholder="Enter property address" />
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
   - Use "sudden burst" or "sudden failure" once naturally — do not repeat excessively

2. WORK PERFORMED (→ work_performed)
   - Written as a narrative paragraph describing the full scope of work
   - Group related tasks together
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
       excessive repetition of "sudden", overly legal or defensive phrasing.

---

OUTPUT FORMAT: Return ONLY a valid JSON object (no markdown, no code fences).
Use the exact structure below:

{
  "site_findings": "Upon arrival at the property, technician observed...",
  "work_performed": "Emergency shut-off of main water supply was performed...",
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
    </div>
  );
};

export default PlumberReportCreation;
