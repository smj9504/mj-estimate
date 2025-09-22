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
import { Company } from '../types';
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
  const [loading, setLoading] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [invoiceItems, setInvoiceItems] = useState<InvoiceItem[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [showPaymentDates, setShowPaymentDates] = useState(true);
  const [templateType, setTemplateType] = useState('standard');
  
  // Modal states
  const [itemModalVisible, setItemModalVisible] = useState(false);
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<InvoiceItem | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [itemForm] = Form.useForm();
  const [paymentForm] = Form.useForm();
  const [itemDescription, setItemDescription] = useState('');

  // Text input values
  const [causeOfDamage, setCauseOfDamage] = useState('');
  const [workPerformed, setWorkPerformed] = useState('');
  const [recommendations, setRecommendations] = useState('');
  const [materialsEquipment, setMaterialsEquipment] = useState('');
  const [warrantyInfo, setWarrantyInfo] = useState('');
  const [termsConditions, setTermsConditions] = useState('');
  const [notes, setNotes] = useState('');

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

  // Load report when ID is available and companies are loaded
  useEffect(() => {
    if (!id || companies.length === 0) return;
    
    const loadReport = async () => {
      try {
        setLoading(true);
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
        setCauseOfDamage(report.cause_of_damage || '');
        setWorkPerformed(report.work_performed || '');
        setRecommendations(report.recommendations || '');
        setMaterialsEquipment(report.materials_equipment_text || '');
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
        setLoading(false);
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
      const values = await form.validateFields();
      setLoading(true);

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
        service_date: values.service_date ? values.service_date.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
        technician_name: values.technician_name,
        license_number: values.license_number,
        cause_of_damage: causeOfDamage,
        work_performed: workPerformed,
        materials_equipment_text: materialsEquipment,
        recommendations,
        invoice_items: invoiceItems,
        financial: totals,
        payments,
        show_payment_dates: showPaymentDates,
        photos,
        warranty_info: warrantyInfo,
        terms_conditions: termsConditions,
        notes: notes,
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
      setLoading(false);
    }
  };

  const handlePreviewPDF = async () => {
    try {
      setLoading(true);
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
        service_date: values.service_date ? values.service_date.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
        technician_name: values.technician_name,
        license_number: values.license_number,
        cause_of_damage: causeOfDamage,
        work_performed: workPerformed,
        materials_equipment_text: materialsEquipment,
        recommendations,
        invoice_items: invoiceItems,
        financial: totals,
        payments,
        show_payment_dates: showPaymentDates,
        photos,
        warranty_info: warrantyInfo,
        terms_conditions: termsConditions,
        notes: notes,
      };

      const blob = await plumberReportService.previewPDF(reportData, {
        include_photos: true,
        include_financial: true,
      });
      
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (error) {
      message.error('Failed to generate PDF preview');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const totals = calculateTotals();

  return (
    <div style={{ padding: '24px' }}>
      <Title level={2}>{id ? 'Edit' : 'Create'} Plumber's Report</Title>
      
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
                    label="Service Date"
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
              <Row gutter={16}>
                {/* Client Name, Email, Phone in one row */}
                <Col xs={24} md={8}>
                  <Form.Item
                    name="name"
                    label="Client Name"
                    rules={[{ required: true }]}
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
            {propertyDifferent ? (
              <Card
                title="Property Information"
                style={{ marginBottom: 24 }}
                extra={
                  <Checkbox
                    checked={propertyDifferent}
                    onChange={(e) => {
                      setPropertyDifferent(e.target.checked);
                      if (!e.target.checked) {
                        // Clear property fields when same as client
                        form.setFieldsValue({
                          property_address: undefined,
                          property_city: undefined,
                          property_state: undefined,
                          property_zipcode: undefined,
                        });
                      }
                    }}
                  >
                    Different from Client Address
                  </Checkbox>
                }
              >
                <Row gutter={16}>
                  <Col xs={24} md={12}>
                    <Form.Item name="property_address" label="Property Address">
                      <Input placeholder="Enter property address" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item name="property_city" label="City">
                      <Input placeholder="Enter city" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item name="property_state" label="State">
                      <Input placeholder="Enter state" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item name="property_zipcode" label="ZIP Code">
                      <Input placeholder="Enter ZIP code" />
                    </Form.Item>
                  </Col>
                </Row>
              </Card>
            ) : (
              <div
                style={{
                  border: '1px solid #d9d9d9',
                  borderRadius: '6px',
                  marginBottom: 24,
                  backgroundColor: '#fafafa',
                }}
              >
                <div
                  style={{
                    padding: '16px 24px',
                    borderBottom: 'none',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontWeight: 500,
                    fontSize: '16px',
                  }}
                >
                  <span>Property Information</span>
                  <Checkbox
                    checked={propertyDifferent}
                    onChange={(e) => {
                      setPropertyDifferent(e.target.checked);
                      if (!e.target.checked) {
                        // Clear property fields when same as client
                        form.setFieldsValue({
                          property_address: undefined,
                          property_city: undefined,
                          property_state: undefined,
                          property_zipcode: undefined,
                        });
                      }
                    }}
                  >
                    Different from Client Address
                  </Checkbox>
                </div>
                <div style={{
                  padding: '20px 24px',
                  textAlign: 'center',
                  color: '#999',
                  backgroundColor: '#f9f9f9',
                  borderBottomLeftRadius: '6px',
                  borderBottomRightRadius: '6px'
                }}>
                  <Text type="secondary">
                    Property address is same as client address
                  </Text>
                  <br />
                  <Text type="secondary" style={{ fontSize: '12px' }}>
                    Check "Different from Client Address" above to enter a different property address
                  </Text>
                </div>
              </div>
            )}
          </Col>

          {/* Report Content */}
          <Col xs={24}>
            <Card title="Report Content" style={{ marginBottom: 24 }}>
              <Form.Item label="Cause of Damage">
                <RichTextEditor
                  value={causeOfDamage}
                  onChange={setCauseOfDamage}
                  placeholder="Describe the cause of damage (supports rich text formatting)..."
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

              <Form.Item label="Materials & Equipment Utilized">
                <RichTextEditor
                  value={materialsEquipment}
                  onChange={setMaterialsEquipment}
                  placeholder="List all materials and equipment used (supports rich text formatting)..."
                  minHeight={150}
                />
              </Form.Item>

              <Form.Item label="Recommendations">
                <RichTextEditor
                  value={recommendations}
                  onChange={setRecommendations}
                  placeholder="Enter recommendations (supports rich text formatting)..."
                  minHeight={100}
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
              loading={loading}
            >
              Save Report
            </Button>
            <Button
              icon={<EyeOutlined />}
              onClick={handlePreviewPDF}
              loading={loading}
            >
              Preview PDF
            </Button>
            <Button
              onClick={() => navigate('/plumber-reports')}
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
    </div>
  );
};

export default PlumberReportCreation;
