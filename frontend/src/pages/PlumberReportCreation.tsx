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

  // Text input values
  const [causeOfDamage, setCauseOfDamage] = useState('');
  const [workPerformed, setWorkPerformed] = useState('');
  const [recommendations, setRecommendations] = useState('');
  const [materialsEquipment, setMaterialsEquipment] = useState('');
  
  // Property same as client toggle
  const [propertyDifferent, setPropertyDifferent] = useState(false);

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
          warranty_info: report.warranty_info,
          terms_conditions: report.terms_conditions,
          notes: report.notes,
        });

        // Set text content
        setCauseOfDamage(report.cause_of_damage || '');
        setWorkPerformed(report.work_performed || '');
        setRecommendations(report.recommendations || '');
        setMaterialsEquipment(report.materials_equipment_text || '');

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

  const handleCompanyChange = (companyId: string) => {
    const company = companies.find(c => c.id === companyId);
    if (company) {
      setSelectedCompany(company);
    }
  };

  const handleAddItem = () => {
    itemForm.resetFields();
    setEditingItem(null);
    setEditingIndex(null);
    setItemModalVisible(true);
  };

  const handleEditItem = (item: InvoiceItem, index: number) => {
    setEditingItem(item);
    setEditingIndex(index);
    itemForm.setFieldsValue(item);
    setItemModalVisible(true);
  };

  const handleItemSubmit = () => {
    itemForm.validateFields().then(values => {
      const newItem: InvoiceItem = {
        id: editingItem?.id || crypto.randomUUID(),
        ...values,
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
        warranty_info: values.warranty_info,
        terms_conditions: values.terms_conditions,
        notes: values.notes,
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
        warranty_info: values.warranty_info,
        terms_conditions: values.terms_conditions,
        notes: values.notes,
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
          report_number: plumberReportService.generateReportNumber(),
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
                  <Form.Item label="Select Company">
                    <Select
                      value={selectedCompany?.id}
                      onChange={handleCompanyChange}
                      placeholder="Select a company"
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

          {/* Client & Property Information */}
          <Col xs={24}>
            <Card title="Client & Property Information" style={{ marginBottom: 24 }}>
              <Divider orientation="left">Client Information</Divider>
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="name"
                    label="Client Name"
                    rules={[{ required: true }]}
                  >
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="email" label="Email">
                    <Input type="email" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="address" label="Address">
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="phone" label="Phone">
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="city" label="City">
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="state" label="State">
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="zipcode" label="ZIP">
                    <Input />
                  </Form.Item>
                </Col>
              </Row>

              <Divider orientation="left">
                <Space>
                  Property Information
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
                </Space>
              </Divider>
              {propertyDifferent && (
                <Row gutter={16}>
                  <Col xs={24} md={12}>
                    <Form.Item name="property_address" label="Property Address">
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={4}>
                    <Form.Item name="property_city" label="City">
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={4}>
                    <Form.Item name="property_state" label="State">
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={4}>
                    <Form.Item name="property_zipcode" label="ZIP">
                      <Input />
                    </Form.Item>
                  </Col>
                </Row>
              )}
            </Card>
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
              <Table
                dataSource={invoiceItems}
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
                rowKey={(record) => record.id}
                summary={() => (
                  <Table.Summary>
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={5} align="right">
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
              <Row gutter={16}>
                <Col xs={24} md={8}>
                  <Form.Item name="warranty_info" label="Warranty Information">
                    <TextArea rows={3} placeholder="Enter warranty details..." />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="terms_conditions" label="Terms & Conditions">
                    <TextArea rows={3} placeholder="Enter terms and conditions..." />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="notes" label="Additional Notes">
                    <TextArea rows={3} placeholder="Any additional notes..." />
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
        }}
        width={600}
      >
        <Form
          form={itemForm}
          layout="vertical"
          initialValues={{
            quantity: 1,
            unit: 'ea',
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
          <Form.Item
            name="description"
            label="Description"
          >
            <TextArea rows={2} />
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
