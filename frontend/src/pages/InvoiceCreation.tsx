import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
import DraggableTable from '../components/common/DraggableTable';
import dayjs from 'dayjs';
import { useNavigate, useParams } from 'react-router-dom';
import { invoiceService } from '../services/invoiceService';
import { companyService } from '../services/companyService';
import { Company } from '../types';
import RichTextEditor from '../components/editor/RichTextEditor';
import UnitSelect from '../components/common/UnitSelect';
import { DEFAULT_UNIT } from '../constants/units';

const { Title } = Typography;
const { TextArea } = Input;

interface InvoiceItem {
  name: string;
  description?: string;
  quantity: number;
  unit: string;
  rate: number;
  amount?: number;
  taxable?: boolean;
}

interface PaymentRecord {
  amount: number;
  date: dayjs.Dayjs;
  method?: string;
  reference?: string;
}

const InvoiceCreation: React.FC = () => {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id;
  const [loading, setLoading] = useState(false);
  const [formMounted, setFormMounted] = useState(false);
  const [formFieldsChanged, setFormFieldsChanged] = useState(0);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [showInsurance, setShowInsurance] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [itemModalVisible, setItemModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<InvoiceItem | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [itemForm] = Form.useForm();
  const [taxMethod, setTaxMethod] = useState<'percentage' | 'specific'>('percentage');
  const [specificTaxAmount, setSpecificTaxAmount] = useState(0);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [showPaymentDates, setShowPaymentDates] = useState(true);
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [paymentForm] = Form.useForm();
  const [useCustomCompany, setUseCustomCompany] = useState(false);

  const loadCompanies = useCallback(async () => {
    try {
      const data = await companyService.getCompanies();
      setCompanies(data);
      // Don't auto-select any company - let user choose explicitly
    } catch (error) {
      console.error('Failed to load companies:', error);
    }
  }, [isEditMode]);

  const [invoiceData, setInvoiceData] = useState<any>(null);

  const loadInvoice = useCallback(async () => {
    if (!id) return;
    
    setLoading(true);
    try {
      console.log('Loading invoice with ID:', id);
      const invoice = await invoiceService.getInvoice(id);
      console.log('Invoice loaded:', invoice);
      console.log('Invoice items:', JSON.stringify(invoice.items, null, 2));
      
      const data = invoice as any;
      setInvoiceData(data);
      
      // Set items
      if (data.items && data.items.length > 0) {
        console.log('Processing loaded items:', JSON.stringify(data.items, null, 2));
        const processedItems = data.items.map((item: any) => ({
          name: item.name || item.description,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit || 'EA',
          rate: item.rate || item.unit_price,
          amount: item.amount || item.total,
          taxable: item.taxable !== false,
        }));
        console.log('Processed items:', processedItems);
        setItems(processedItems);
      }
      
      // Set form values immediately
      form.setFieldsValue({
        invoice_number: data.invoice_number,
        date: data.date ? dayjs(data.date) : dayjs(),
        due_date: data.due_date ? dayjs(data.due_date) : dayjs().add(30, 'day'),
        status: data.status || 'draft',
        client_name: data.client_name,
        client_address: data.client_address,
        client_city: data.client_city,
        client_state: data.client_state,
        client_zipcode: data.client_zipcode,
        client_phone: data.client_phone,
        client_email: data.client_email,
        notes: data.notes,
        payment_terms: data.payment_terms,
        tax_rate: data.tax_rate || 0,
        discount: data.discount || data.discount_amount || 0,
      });
      
      // Set tax method and amount
      if (data.tax_method) {
        setTaxMethod(data.tax_method);
      }
      if (data.tax_amount && data.tax_method === 'specific') {
        setSpecificTaxAmount(data.tax_amount);
      }
      
      // Set payments
      if (data.payments && data.payments.length > 0) {
        const processedPayments = data.payments.map((payment: any) => ({
          amount: payment.amount || 0,
          date: payment.date ? dayjs(payment.date) : dayjs(),
          method: payment.method || '',
          reference: payment.reference || ''
        }));
        setPayments(processedPayments);
      }
      
      // Set payment display option
      if (data.show_payment_dates !== undefined) {
        setShowPaymentDates(data.show_payment_dates);
      }
      
      // Set up company info - will be handled separately when companies load
      if (data.company_id && !data.company_name) {
        // Will set company when companies are loaded
      } else if (data.company_name) {
        setUseCustomCompany(true);
        // Set custom company form values
        form.setFieldsValue({
          company_name: data.company_name,
          company_address: data.company_address,
          company_city: data.company_city,
          company_state: data.company_state,
          company_zipcode: data.company_zipcode,
          company_phone: data.company_phone,
          company_email: data.company_email,
        });
      }
    } catch (error: any) {
      console.error('Failed to load invoice:', error);
      console.error('Error details:', error.response?.data || error.message);
      message.error(`Failed to load invoice: ${error.response?.data?.detail || error.message}`);
    } finally {
      setLoading(false);
    }
  }, [id, form]); // Remove companies dependency

  useEffect(() => {
    loadCompanies();
  }, [loadCompanies]);

  // Reset form when switching between edit/create modes
  useEffect(() => {
    // Reset all state when mode changes
    setInvoiceData(null);
    setItems([]);
    setSelectedCompany(null);
    setUseCustomCompany(false);
    setLoading(false);
    
    // Reset form
    form.resetFields();
    
    // Set default form values for create mode
    if (!isEditMode) {
      form.setFieldsValue({
        date: dayjs(),
        due_date: dayjs().add(30, 'day'),
        status: 'draft',
        tax_rate: 0,
        discount: 0,
        invoice_number: '', // Will be generated
      });
    }
  }, [isEditMode, id, form]); // Reset when isEditMode or id changes

  useEffect(() => {
    // Load invoice data when in edit mode
    if (isEditMode && id) {
      loadInvoice();
    }
  }, [isEditMode, id, loadInvoice]); // Keep loadInvoice but now it won't change due to companies

  // Set company after both invoice and companies are loaded
  useEffect(() => {
    if (isEditMode && invoiceData && companies.length > 0 && invoiceData.company_id) {
      const company = companies.find(c => c.id === invoiceData.company_id);
      if (company) {
        setSelectedCompany(company);
        // Update form with company data and selection
        form.setFieldsValue({
          company_selection: company.id,
          company_name: company.name,
          company_address: company.address,
          company_city: company.city,
          company_state: company.state,
          company_zipcode: company.zipcode,
          company_phone: company.phone,
          company_email: company.email,
        });
      }
    } else if (isEditMode && invoiceData && invoiceData.company_name && !invoiceData.company_id) {
      // Handle case where custom company data exists in edit mode
      setUseCustomCompany(true);
      form.setFieldValue('company_selection', 'custom');
    }
  }, [isEditMode, invoiceData, companies, form]);

  // Set default company form values after Form is rendered and companies are loaded
  useEffect(() => {
    if (companies.length > 0 && selectedCompany && !isEditMode && !useCustomCompany) {
      form.setFieldsValue({
        company_name: selectedCompany.name,
        company_address: selectedCompany.address,
        company_city: selectedCompany.city,
        company_state: selectedCompany.state,
        company_zipcode: selectedCompany.zipcode,
        company_phone: selectedCompany.phone,
        company_email: selectedCompany.email,
      });
    }
  }, [form, companies, selectedCompany, isEditMode, useCustomCompany]);

  // Set invoice form values after Form is rendered and invoice data is loaded
  useEffect(() => {
    if (invoiceData && isEditMode) {
      form.setFieldsValue({
        invoice_number: invoiceData.invoice_number,
        date: invoiceData.invoice_date ? dayjs(invoiceData.invoice_date) : invoiceData.date ? dayjs(invoiceData.date) : dayjs(),
        due_date: invoiceData.due_date ? dayjs(invoiceData.due_date) : undefined,
        status: invoiceData.status,
        company_id: invoiceData.company_id,
        company_name: invoiceData.company_name,
        company_address: invoiceData.company_address,
        company_city: invoiceData.company_city,
        company_state: invoiceData.company_state,
        company_zipcode: invoiceData.company_zipcode,
        company_phone: invoiceData.company_phone,
        company_email: invoiceData.company_email,
        client_name: invoiceData.client_name,
        client_address: invoiceData.client_address,
        client_city: invoiceData.client_city,
        client_state: invoiceData.client_state,
        client_zipcode: invoiceData.client_zipcode,
        client_phone: invoiceData.client_phone,
        client_email: invoiceData.client_email,
        tax_rate: invoiceData.tax_rate || 0,
        discount: invoiceData.discount_amount || invoiceData.discount || 0,
        notes: invoiceData.notes,
        terms: invoiceData.terms,
        payment_terms: invoiceData.payment_terms,
      });
    }
  }, [form, invoiceData, isEditMode]);

  // Set company form values when company selection changes
  useEffect(() => {
    if (selectedCompany && !useCustomCompany) {
      form.setFieldsValue({
        company_name: selectedCompany.name,
        company_address: selectedCompany.address,
        company_city: selectedCompany.city,
        company_state: selectedCompany.state,
        company_zipcode: selectedCompany.zipcode,
        company_phone: selectedCompany.phone,
        company_email: selectedCompany.email,
      });
    } else if (useCustomCompany) {
      form.setFieldsValue({
        company_name: '',
        company_address: '',
        company_city: '',
        company_state: '',
        company_zipcode: '',
        company_phone: '',
        company_email: '',
      });
    }
  }, [form, selectedCompany, useCustomCompany]);

  // Set formMounted to true after component mounts
  useEffect(() => {
    setFormMounted(true);
  }, []);

  const handleCompanyChange = (companyId: string) => {
    if (companyId === 'custom') {
      setUseCustomCompany(true);
      setSelectedCompany(null);
      // Set form value to indicate custom company is selected
      form.setFieldValue('company_selection', 'custom');
    } else {
      setUseCustomCompany(false);
      const company = companies.find(c => c.id === companyId);
      if (company) {
        setSelectedCompany(company);
        // Set form value to the selected company ID
        form.setFieldValue('company_selection', companyId);
      }
    }
  };

  const handleAddItem = () => {
    setEditingItem(null);
    setEditingIndex(null);
    setItemModalVisible(true);
  };

  const handleEditItem = (item: InvoiceItem, index: number) => {
    setEditingItem(item);
    setEditingIndex(index);
    setItemModalVisible(true);
  };

  const handleItemSubmit = () => {
    itemForm.validateFields().then(values => {
      // Comprehensive validation with user-friendly error messages
      
      // Validate item name/description
      if (!values.name || values.name.toString().trim() === '') {
        message.error('Please enter a valid item name');
        return;
      }

      // Validate quantity
      if (!values.quantity || values.quantity <= 0) {
        message.error('Please enter a valid quantity greater than 0');
        return;
      }

      // Validate unit
      if (!values.unit || values.unit.toString().trim() === '') {
        message.error('Please select a unit for the item');
        return;
      }

      // Validate rate
      if (values.rate === null || values.rate === undefined || values.rate <= 0) {
        message.error('Please enter a valid rate greater than $0');
        return;
      }

      // Additional validation for numeric values
      if (isNaN(values.quantity) || isNaN(values.rate)) {
        message.error('Quantity and rate must be valid numbers');
        return;
      }

      const newItem: InvoiceItem = {
        ...values,
        name: values.name.toString().trim(),
        description: values.description ? values.description.toString().trim() : '',
        quantity: Number(values.quantity),
        rate: Number(values.rate),
        amount: Number(values.quantity) * Number(values.rate),
        taxable: values.taxable !== false, // Default to taxable if not specified
      };

      if (editingIndex !== null) {
        const updatedItems = [...items];
        updatedItems[editingIndex] = newItem;
        setItems(updatedItems);
        message.success('Item updated successfully');
      } else {
        setItems([...items, newItem]);
        message.success('Item added successfully');
      }

      setItemModalVisible(false);
      itemForm.resetFields();
      setEditingItem(null);
      setEditingIndex(null);
    }).catch(error => {
      console.error('Item validation failed:', error);
      
      // Handle specific validation errors
      if (error.errorFields && error.errorFields.length > 0) {
        const firstError = error.errorFields[0];
        if (firstError.name && firstError.name.length > 0) {
          const fieldName = firstError.name[0];
          const errorMessages = firstError.errors || [];
          
          if (fieldName === 'name') {
            message.error('Please enter a valid item name');
          } else if (fieldName === 'quantity') {
            message.error('Please enter a valid quantity greater than 0');
          } else if (fieldName === 'unit') {
            message.error('Please select a unit for the item');
          } else if (fieldName === 'rate') {
            message.error('Please enter a valid rate greater than $0');
          } else if (errorMessages.length > 0) {
            message.error(errorMessages[0]);
          } else {
            message.error('Please fill in all required item information');
          }
        } else {
          message.error('Please fill in all required item information');
        }
      } else {
        message.error('Please fill in all required item information');
      }
    });
  };

  const handleDeleteItem = (index: number) => {
    const updatedItems = items.filter((_, i) => i !== index);
    setItems(updatedItems);
  };

  const handleItemReorder = (newItems: InvoiceItem[]) => {
    setItems(newItems);
    message.success('Items reordered');
  };

  const handleAddPayment = () => {
    setPaymentModalVisible(true);
  };

  const handlePaymentSubmit = () => {
    paymentForm.validateFields().then(values => {
      // Validate payment amount
      if (!values.amount || values.amount <= 0) {
        message.error('Please enter a valid payment amount greater than $0');
        return;
      }

      // Validate date
      if (!values.date) {
        message.error('Please select a payment date');
        return;
      }

      const newPayment: PaymentRecord = {
        amount: values.amount,
        date: values.date,
        method: values.method || '',
        reference: values.reference || '',
      };
      setPayments([...payments, newPayment]);
      setPaymentModalVisible(false);
      paymentForm.resetFields();
      message.success('Payment added successfully');
    }).catch(error => {
      console.error('Payment validation failed:', error);
      message.error('Please fill in all required payment information');
    });
  };

  const handleDeletePayment = (index: number) => {
    const updatedPayments = payments.filter((_, i) => i !== index);
    setPayments(updatedPayments);
  };

  const calculateTotals = useCallback(() => {
    const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.rate), 0);
    
    // Safely get form values, default to 0 if form not ready
    let discount = 0;
    let taxRate = 0;
    
    // Only get form values if form is mounted
    if (formMounted) {
      try {
        const formValues = form.getFieldsValue(['discount', 'tax_rate']);
        discount = formValues.discount || 0;
        if (taxMethod === 'percentage') {
          taxRate = formValues.tax_rate || 0;
        }
      } catch (error) {
        // Form not ready yet, use defaults
      }
    }
    
    let taxAmount = 0;
    if (taxMethod === 'percentage') {
      // If items have taxable property, only tax taxable items
      const taxableAmount = items.reduce((sum, item) => {
        if (item.taxable !== false) { // Default to taxable if not specified
          return sum + (item.quantity * item.rate);
        }
        return sum;
      }, 0);
      taxAmount = (taxableAmount - discount) * (taxRate / 100);
    } else {
      taxAmount = specificTaxAmount;
    }
    
    const total = subtotal - discount + taxAmount;
    const totalPaid = payments.reduce((sum, payment) => sum + payment.amount, 0);
    const balanceDue = total - totalPaid;

    return {
      subtotal,
      taxAmount,
      total,
      totalPaid,
      balanceDue,
    };
  }, [items, taxMethod, specificTaxAmount, payments, form, formMounted]);

  const handleSave = async (status: string = 'draft') => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      // Validate company information
      if (!selectedCompany && !useCustomCompany) {
        message.error('Please select a company or choose to enter custom company information');
        setLoading(false);
        return;
      }
      
      let companyName = values.company_name;
      if (!useCustomCompany && selectedCompany) {
        companyName = selectedCompany.name;
      }
      
      if (!companyName && useCustomCompany) {
        message.error('Please enter company name for custom company');
        setLoading(false);
        return;
      }

      const totals = calculateTotals();
      
      // Prepare invoice data based on company type
      const invoiceData: any = {
        invoice_number: values.invoice_number,
        date: values.date ? values.date.format('MM-DD-YYYY') : dayjs().format('MM-DD-YYYY'),
        due_date: values.due_date ? values.due_date.format('MM-DD-YYYY') : dayjs().add(30, 'days').format('MM-DD-YYYY'),
        status,
      };
      
      // Add company info based on type
      if (!useCustomCompany && selectedCompany) {
        // Using saved company - send company_id
        invoiceData.company_id = selectedCompany.id;
      } else {
        // Using custom company - send full company info
        invoiceData.company = {
          name: values.company_name || '',
          address: values.company_address || '',
          city: values.company_city || '',
          state: values.company_state || '',
          zipcode: values.company_zipcode || '',
          phone: values.company_phone || '',
          email: values.company_email || '',
          logo: '',
        };
      }
      
      // Add rest of the data
      invoiceData.client = {
        name: values.client_name,
        address: values.client_address,
        city: values.client_city,
        state: values.client_state,
        zipcode: values.client_zipcode,
        phone: values.client_phone,
        email: values.client_email,
      };
      
      invoiceData.insurance = showInsurance ? {
        company: values.insurance_company,
        policy_number: values.insurance_policy_number,
        claim_number: values.insurance_claim_number,
        deductible: values.insurance_deductible,
      } : null;
      
      console.log('Current items state:', JSON.stringify(items, null, 2));
      invoiceData.items = items;
      invoiceData.subtotal = totals.subtotal;
      invoiceData.tax_method = taxMethod;
      invoiceData.tax_rate = taxMethod === 'percentage' ? (values.tax_rate || 0) : 0;
      invoiceData.tax_amount = totals.taxAmount;
      invoiceData.discount = values.discount || 0;
      invoiceData.total = totals.total;
      invoiceData.payments = payments;
      invoiceData.show_payment_dates = showPaymentDates;
      invoiceData.balance_due = totals.balanceDue;
      invoiceData.payment_terms = values.payment_terms;
      invoiceData.notes = values.notes;

      console.log('Sending invoice data:', JSON.stringify(invoiceData, null, 2));
      
      let response;
      if (isEditMode && id) {
        // Update existing invoice
        response = await invoiceService.updateInvoice(id, invoiceData);
        message.success('Invoice updated successfully!');
      } else {
        // Create new invoice
        response = await invoiceService.createInvoice(invoiceData);
        message.success('Invoice saved successfully!');
      }
      
      navigate(`/documents/invoice`);
    } catch (error) {
      message.error('Failed to save invoice');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handlePreviewPDF = async () => {
    try {
      setLoading(true);
      const values = await form.validateFields();
      
      // Validate company information
      if (!selectedCompany && !useCustomCompany) {
        message.error('Please select a company or choose to enter custom company information');
        setLoading(false);
        return;
      }
      
      let companyName = values.company_name;
      if (!useCustomCompany && selectedCompany) {
        companyName = selectedCompany.name;
      }
      
      if (!companyName && useCustomCompany) {
        message.error('Please enter company name for custom company');
        setLoading(false);
        return;
      }

      const totals = calculateTotals();

      const pdfData = {
        invoice_number: values.invoice_number || `INV-${dayjs().format('YYYYMMDDHHmmss')}`,
        date: values.date ? values.date.format('MM-DD-YYYY') : dayjs().format('MM-DD-YYYY'),
        due_date: values.due_date ? values.due_date.format('MM-DD-YYYY') : dayjs().add(30, 'days').format('MM-DD-YYYY'),
        company: {
          name: companyName || '',
          address: values.company_address || selectedCompany?.address || '',
          city: values.company_city || selectedCompany?.city || '',
          state: values.company_state || selectedCompany?.state || '',
          zipcode: values.company_zipcode || selectedCompany?.zipcode || '',
          phone: values.company_phone || selectedCompany?.phone || '',
          email: values.company_email || selectedCompany?.email || '',
          logo: selectedCompany?.logo || '',
        },
        client: {
          name: values.client_name,
          address: values.client_address,
          city: values.client_city,
          state: values.client_state,
          zipcode: values.client_zipcode,
          phone: values.client_phone,
          email: values.client_email,
        },
        insurance: showInsurance ? {
          company: values.insurance_company,
          policy_number: values.insurance_policy_number,
          claim_number: values.insurance_claim_number,
          deductible: values.insurance_deductible,
        } : null,
        items,
        subtotal: totals.subtotal,
        tax_method: taxMethod,
        tax_rate: taxMethod === 'percentage' ? (values.tax_rate || 0) : 0,
        tax_amount: totals.taxAmount,
        discount: values.discount || 0,
        total: totals.total,
        payments: payments,
        show_payment_dates: showPaymentDates,
        balance_due: totals.balanceDue,
        payment_terms: values.payment_terms,
        notes: values.notes,
      };

      const blob = await invoiceService.previewPDF(pdfData);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (error) {
      message.error('Failed to generate PDF preview');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const columns = [
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
      align: 'center' as const,
    },
    {
      title: 'Rate',
      dataIndex: 'rate',
      key: 'rate',
      width: 100,
      align: 'right' as const,
      render: (value: number) => `$${value.toFixed(2)}`,
    },
    {
      title: 'Amount',
      key: 'amount',
      width: 120,
      align: 'right' as const,
      render: (_: any, record: InvoiceItem) => `$${(record.quantity * record.rate).toFixed(2)}`,
    },
    ...(taxMethod === 'percentage' ? [{
      title: 'Taxable',
      dataIndex: 'taxable',
      key: 'taxable',
      width: 80,
      align: 'center' as const,
      render: (value: boolean | undefined, record: InvoiceItem, index: number) => (
        <Switch
          size="small"
          checked={value !== false}
          onChange={(checked) => {
            const updatedItems = [...items];
            updatedItems[index] = { ...updatedItems[index], taxable: checked };
            setItems(updatedItems);
          }}
        />
      ),
    }] : []),
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
  ];

  const totals = useMemo(() => calculateTotals(), [calculateTotals]);
  
  // Safe form values for rendering
  const safeFormValues = useMemo(() => {
    if (!formMounted) {
      return { discount: 0, taxRate: 0 };
    }
    
    try {
      const values = form.getFieldsValue(['discount', 'tax_rate']);
      return {
        discount: values.discount || 0,
        taxRate: values.tax_rate || 0
      };
    } catch (error) {
      return { discount: 0, taxRate: 0 };
    }
  }, [form, formMounted, formFieldsChanged]);

  return (
    <div style={{ padding: '24px' }}>
      <Title level={2}>{isEditMode ? 'Edit Invoice' : 'Create Invoice'}</Title>
      
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          invoice_number: `INV-${dayjs().format('YYYYMMDDHHmmss')}`,
          date: dayjs(),
          due_date: dayjs().add(30, 'days'),
          tax_rate: 0,
          discount: 0,
        }}
        onFieldsChange={(changedFields) => {
          if (!formMounted) {
            setFormMounted(true);
          }
          // Track field changes for discount and tax_rate
          const affectedFields = changedFields.filter(field => 
            field.name?.[0] === 'discount' || field.name?.[0] === 'tax_rate'
          );
          if (affectedFields.length > 0) {
            setFormFieldsChanged(prev => prev + 1);
          }
        }}
      >
        <Row gutter={24}>
          {/* Invoice Details */}
          <Col xs={24}>
            <Card title="Invoice Details" style={{ marginBottom: 24 }}>
              <Form.Item 
                label="Select Company" 
                style={{ marginBottom: 16 }}
                name="company_selection"
                rules={[{ required: true, message: 'Please select a company or choose custom company' }]}
              >
                <Select
                  value={useCustomCompany ? 'custom' : selectedCompany?.id || undefined}
                  onChange={handleCompanyChange}
                  placeholder="Select company"
                  options={[
                    ...companies.map(company => ({
                      key: company.id,
                      value: company.id,
                      label: company.name
                    })),
                    {
                      value: 'custom',
                      label: (
                        <>
                          <Divider style={{ margin: '4px 0' }} />
                          <Space>
                            <EditOutlined />
                            <span>Enter Custom Company</span>
                          </Space>
                        </>
                      )
                    }
                  ]}
                />
              </Form.Item>
              
              <Row gutter={16}>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="invoice_number"
                    label="Invoice Number"
                    rules={[{ required: true }]}
                  >
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="date"
                    label="Invoice Date"
                    rules={[{ required: true }]}
                  >
                    <DatePicker style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="due_date"
                    label="Due Date"
                    rules={[{ required: true }]}
                  >
                    <DatePicker style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
              
              {useCustomCompany && (
                <>
                  <Divider orientation="left" style={{ margin: '16px 0' }}>Custom Company Information</Divider>
                  <Row gutter={16}>
                    <Col xs={24} md={12}>
                      <Form.Item name="company_name" label="Company Name" rules={[{ required: true }]}>
                        <Input placeholder="Enter company name" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="company_email" label="Company Email">
                        <Input type="email" placeholder="Enter email" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="company_phone" label="Company Phone">
                        <Input placeholder="Enter phone" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="company_address" label="Company Address">
                        <Input placeholder="Enter address" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="company_city" label="City">
                        <Input placeholder="City" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="company_state" label="State">
                        <Input placeholder="State" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="company_zipcode" label="ZIP">
                        <Input placeholder="ZIP" />
                      </Form.Item>
                    </Col>
                  </Row>
                </>
              )}
            </Card>
          </Col>


          {/* Client Information */}
          <Col xs={24}>
            <Card title="Client Information" style={{ marginBottom: 24 }}>
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="client_name"
                    label="Client Name"
                    rules={[{ required: true, message: 'Please enter client name' }]}
                  >
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="client_email" label="Email">
                    <Input type="email" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="client_address" label="Address">
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="client_phone" label="Phone">
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="client_city" label="City">
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="client_state" label="State">
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="client_zipcode" label="ZIP">
                    <Input />
                  </Form.Item>
                </Col>
              </Row>
              
              <Divider orientation="left" style={{ margin: '16px 0' }}>
                <Space>
                  <span>Insurance Information</span>
                  <Switch
                    size="small"
                    checked={showInsurance}
                    onChange={setShowInsurance}
                    checkedChildren="Yes"
                    unCheckedChildren="No"
                  />
                </Space>
              </Divider>

              {showInsurance && (
                <Row gutter={16}>
                  <Col xs={24} md={12}>
                    <Form.Item name="insurance_company" label="Insurance Company">
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="insurance_policy_number" label="Policy Number">
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="insurance_claim_number" label="Claim Number">
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="insurance_deductible" label="Deductible">
                      <InputNumber
                        style={{ width: '100%' }}
                        formatter={value => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                        parser={value => value!.replace(/\$\s?|(,*)/g, '')}
                      />
                    </Form.Item>
                  </Col>
                </Row>
              )}
            </Card>
          </Col>
        </Row>

        {/* Invoice Items */}
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
          <DraggableTable
            dataSource={items}
            columns={columns}
            pagination={false}
            onReorder={handleItemReorder}
            dragColumnTitle=""
            dragColumnWidth={40}
            getRowId={(_, index) => `item-${index}`}
            summary={() => (
              <Table.Summary>
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={7} align="right">
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

        {/* Totals and Additional Info */}
        <Row gutter={24}>
          <Col xs={24} lg={12}>
            <Card title="Additional Information" style={{ marginBottom: 24 }}>
              <Form.Item name="notes" label="Invoice Header Notes">
                <RichTextEditor
                  placeholder="Notes that will appear at the top of the invoice..."
                  minHeight={150}
                />
              </Form.Item>
              <Form.Item name="payment_terms" label="Invoice Footer Terms">
                <RichTextEditor
                  placeholder="Terms that will appear at the bottom of the invoice (e.g., Net 30 days, Due on receipt, etc.)"
                  minHeight={120}
                />
              </Form.Item>
            </Card>
          </Col>

          <Col xs={24} lg={12}>
            <Card title="Payment Summary" style={{ marginBottom: 24 }}>
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Item name="discount" label="Discount">
                    <InputNumber
                      style={{ width: '100%' }}
                      min={0}
                      formatter={value => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                      parser={value => value!.replace(/\$\s?|(,*)/g, '') as any}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Divider orientation="left">Tax Settings</Divider>
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Item label="Tax Method">
                    <Select 
                      value={taxMethod} 
                      onChange={setTaxMethod}
                      options={[
                        { value: 'percentage', label: 'Percentage of Subtotal' },
                        { value: 'specific', label: 'Specific Amount' }
                      ]}
                    />
                  </Form.Item>
                </Col>
                {taxMethod === 'percentage' ? (
                  <Col span={24}>
                    <Form.Item name="tax_rate" label="Tax Rate (%)">
                      <InputNumber
                        style={{ width: '100%' }}
                        min={0}
                        max={100}
                        formatter={value => `${value}%`}
                        parser={value => value!.replace('%', '') as any}
                      />
                    </Form.Item>
                  </Col>
                ) : (
                  <Col span={24}>
                    <Form.Item label="Tax Amount">
                      <InputNumber
                        style={{ width: '100%' }}
                        min={0}
                        value={specificTaxAmount}
                        onChange={value => setSpecificTaxAmount(value || 0)}
                        formatter={value => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                        parser={value => value!.replace(/\$\s?|(,*)/g, '') as any}
                      />
                    </Form.Item>
                  </Col>
                )}
              </Row>

              <Divider orientation="left">
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
              </Divider>
              
              <Space direction="vertical" style={{ width: '100%' }}>
                {payments.map((payment, index) => (
                  <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Space>
                      {showPaymentDates && (
                        <span style={{ color: '#666' }}>{payment.date.format('MM/DD/YYYY')}</span>
                      )}
                      <span>${payment.amount.toFixed(2)}</span>
                      {payment.method && <span>({payment.method})</span>}
                    </Space>
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => handleDeletePayment(index)}
                    />
                  </div>
                ))}
                <Button
                  type="dashed"
                  block
                  icon={<PlusOutlined />}
                  onClick={handleAddPayment}
                >
                  Add Payment
                </Button>
              </Space>

              <Divider />

              <div style={{ fontSize: '16px' }}>
                <Row justify="space-between" style={{ marginBottom: 8 }}>
                  <Col>Subtotal:</Col>
                  <Col>${totals.subtotal.toFixed(2)}</Col>
                </Row>
                {safeFormValues.discount > 0 && (
                  <Row justify="space-between" style={{ marginBottom: 8 }}>
                    <Col>Discount:</Col>
                    <Col>-${safeFormValues.discount.toFixed(2)}</Col>
                  </Row>
                )}
                {totals.taxAmount > 0 && (
                  <Row justify="space-between" style={{ marginBottom: 8 }}>
                    <Col>
                      Tax {taxMethod === 'percentage' ? `(${safeFormValues.taxRate}%)` : ''}:
                    </Col>
                    <Col>${totals.taxAmount.toFixed(2)}</Col>
                  </Row>
                )}
                <Divider />
                <Row justify="space-between" style={{ fontWeight: 'bold', fontSize: '18px' }}>
                  <Col>Total:</Col>
                  <Col>${totals.total.toFixed(2)}</Col>
                </Row>
                {totals.totalPaid > 0 && (
                  <>
                    <Row justify="space-between" style={{ marginTop: 8 }}>
                      <Col>Total Paid:</Col>
                      <Col>${totals.totalPaid.toFixed(2)}</Col>
                    </Row>
                    <Row justify="space-between" style={{ fontWeight: 'bold', color: totals.balanceDue > 0 ? '#ff4d4f' : '#52c41a' }}>
                      <Col>Balance Due:</Col>
                      <Col>${totals.balanceDue.toFixed(2)}</Col>
                    </Row>
                  </>
                )}
              </div>
            </Card>
          </Col>
        </Row>

        {/* Action Buttons */}
        <Card>
          <Space size="middle">
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={() => handleSave('sent')}
              loading={loading}
            >
              {isEditMode ? 'Update' : 'Save'}
            </Button>
            <Button
              icon={<EyeOutlined />}
              onClick={handlePreviewPDF}
              loading={loading}
            >
              Preview PDF
            </Button>
            <Button
              onClick={() => navigate('/invoices')}
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
        afterOpenChange={(open) => {
          if (open) {
            // Modal이 완전히 열린 후에 form 값 설정
            if (editingItem) {
              itemForm.setFieldsValue(editingItem);
            } else {
              itemForm.resetFields();
            }
          }
        }}
        width={600}
      >
        <Form
          form={itemForm}
          layout="vertical"
          initialValues={{
            quantity: 1,
            unit: DEFAULT_UNIT,
            rate: 0,
            taxable: false,
          }}
        >
          <Form.Item
            name="name"
            label="Item Name"
            rules={[
              { required: true, message: 'Please enter item name' },
              { whitespace: true, message: 'Item name cannot be empty or just whitespace' },
              { min: 1, message: 'Item name is required' }
            ]}
          >
            <Input placeholder="Enter item name" />
          </Form.Item>
          <Form.Item
            name="description"
            label="Description"
          >
            <RichTextEditor
              placeholder="Optional description"
              minHeight={120}
            />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="quantity"
                label="Quantity"
                rules={[
                  { required: true, message: 'Please enter quantity' },
                  { 
                    type: 'number',
                    min: 0.01,
                    message: 'Quantity must be greater than 0'
                  }
                ]}
              >
                <InputNumber 
                  style={{ width: '100%' }} 
                  min={0.01} 
                  step={1} 
                  precision={2}
                  placeholder="Enter quantity"
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="unit"
                label="Unit"
                rules={[
                  { required: true, message: 'Please select unit' }
                ]}
              >
                <UnitSelect />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="rate"
                label="Rate"
                rules={[
                  { required: true, message: 'Please enter rate' },
                  { 
                    type: 'number',
                    min: 0.01,
                    message: 'Rate must be greater than $0'
                  }
                ]}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={0.01}
                  step={0.01}
                  precision={2}
                  placeholder="Enter rate"
                  formatter={value => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={((value: any) => {
                    const parsed = parseFloat(value!.replace(/\$\s?|(,*)/g, ''));
                    return isNaN(parsed) ? undefined : parsed;
                  }) as any}
                />
              </Form.Item>
            </Col>
          </Row>
          {taxMethod === 'percentage' && (
            <Form.Item
              name="taxable"
              label="Taxable"
              valuePropName="checked"
            >
              <Switch checkedChildren="Yes" unCheckedChildren="No" />
            </Form.Item>
          )}
          <Form.Item dependencies={['quantity', 'rate']} noStyle>
            {({ getFieldValue }) => {
              const quantity = getFieldValue('quantity');
              const rate = getFieldValue('rate');
              return quantity && rate ? (
                <div style={{ textAlign: 'right', fontSize: '16px', fontWeight: 'bold' }}>
                  Total: ${(quantity * rate).toFixed(2)}
                </div>
              ) : null;
            }}
          </Form.Item>
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
        afterOpenChange={(open) => {
          if (open) {
            // Modal이 완전히 열린 후에 form 값 설정
            paymentForm.resetFields();
            paymentForm.setFieldsValue({
              amount: undefined,
              date: dayjs(),
              method: '',
              reference: '',
            });
          }
        }}
        width={500}
      >
        <Form
          form={paymentForm}
          layout="vertical"
          initialValues={{
            amount: undefined,
            date: dayjs(),
            method: '',
            reference: '',
          }}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="amount"
                label="Amount"
                rules={[
                  { required: true, message: 'Please enter payment amount' },
                  { 
                    type: 'number',
                    min: 0.01,
                    message: 'Payment amount must be greater than $0'
                  }
                ]}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={0.01}
                  step={0.01}
                  precision={2}
                  placeholder="Enter amount"
                  formatter={value => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={((value: any) => {
                    const parsed = parseFloat(value!.replace(/\$\s?|(,*)/g, ''));
                    return isNaN(parsed) ? undefined : parsed;
                  }) as any}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="date"
                label="Payment Date"
                rules={[{ required: true, message: 'Please select payment date' }]}
              >
                <DatePicker style={{ width: '100%' }} placeholder="Select date" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="method"
                label="Payment Method"
              >
                <Select 
                  placeholder="Select method (optional)" 
                  allowClear
                  options={[
                    { value: 'CA', label: 'Cash' },
                    { value: 'CK', label: 'Check' },
                    { value: 'CC', label: 'Credit Card' },
                    { value: 'DC', label: 'Debit Card' },
                    { value: 'BT', label: 'Bank Transfer' },
                    { value: 'PP', label: 'PayPal' },
                    { value: 'VM', label: 'Venmo' },
                    { value: 'ZL', label: 'Zelle' },
                    { value: 'OT', label: 'Other' }
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="reference"
                label="Reference/Check #"
              >
                <Input placeholder="Optional" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
};

export default InvoiceCreation;
