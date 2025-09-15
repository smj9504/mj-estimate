import React, { useState, useEffect, useCallback } from 'react';
import {
  Form,
  Input,
  Button,
  Select,
  Card,
  Row,
  Col,
  Space,
  message,
  Typography,
  Divider,
  Spin
} from 'antd';
import {
  SaveOutlined,
  SendOutlined,
  EyeOutlined,
  FileTextOutlined,
  UserOutlined,
  ToolOutlined,
  DollarOutlined
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { companyService } from '../services/companyService';
import { workOrderService } from '../services/workOrderService';
import documentTypeService from '../services/documentTypeService';
import CompanySelector from '../components/work-order/CompanySelector';
import CostCalculationPanel from '../components/work-order/CostCalculationPanel';
import AdditionalCosts from '../components/work-order/AdditionalCosts';
import RichTextEditor from '../components/editor/RichTextEditor';
import { useStore } from '../store/useStore';
import { Company, WorkOrderFormData, Credit } from '../types';
import { AdditionalCost } from '../components/work-order/AdditionalCosts';

const { Title } = Typography;
const { TextArea } = Input;
const { Option } = Select;

const WorkOrderCreation: React.FC = () => {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const isEditMode = Boolean(id);
  const [finalCost, setFinalCost] = useState(0);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [availableCredits, setAvailableCredits] = useState<Credit[]>([]);
  const [workDescription, setWorkDescription] = useState('');
  const [selectedDocumentType, setSelectedDocumentType] = useState<string>('');
  const [selectedTrades, setSelectedTrades] = useState<string[]>([]);
  const [additionalCosts, setAdditionalCosts] = useState<AdditionalCost[]>([]);
  const [additionalCostsTotal, setAdditionalCostsTotal] = useState(0);
  const [applyTax, setApplyTax] = useState(false);
  const [taxRate, setTaxRate] = useState(0);
  
  const {
    companies,
    setCompanies,
    loading,
    setLoading,
    setError
  } = useStore();

  // Load companies
  const { data: companiesData, isLoading: companiesLoading, error: companiesError } = useQuery({
    queryKey: ['companies'],
    queryFn: () => companyService.getCompanies(),
  });

  // Load available trades from backend
  const { data: trades = [] } = useQuery({
    queryKey: ['trades'],
    queryFn: () => documentTypeService.getTrades(),
  });

  // Load document types from backend
  const { data: documentTypes = [] } = useQuery({
    queryKey: ['documentTypes'],
    queryFn: () => documentTypeService.getDocumentTypes(),
  });

  // Load work order data when in edit mode
  const { data: workOrderData, isLoading: workOrderLoading, error: workOrderError } = useQuery({
    queryKey: ['workOrder', id],
    queryFn: () => workOrderService.getWorkOrder(id!),
    enabled: isEditMode,
  });

  // Handle companies data
  useEffect(() => {
    if (companiesData) {
      setCompanies(companiesData);
    }
  }, [companiesData, setCompanies]);

  // Handle companies error
  useEffect(() => {
    if (companiesError) {
      console.error('Failed to load companies:', companiesError);
      message.error('Failed to load companies');
    }
  }, [companiesError]);

  // Handle work order error
  useEffect(() => {
    if (workOrderError) {
      console.error('Failed to load work order:', workOrderError);
      message.error('Failed to load work order');
    }
  }, [workOrderError]);

  // Calculate additional costs total whenever additional costs change
  useEffect(() => {
    const total = additionalCosts.reduce((sum, cost) => sum + (cost.amount || 0), 0);
    setAdditionalCostsTotal(total);
  }, [additionalCosts]);

  // Populate form when work order data is loaded (edit mode)
  useEffect(() => {
    if (workOrderData && companiesData && documentTypes && documentTypes.length > 0 && !workOrderLoading) {
      // Find the company
      const company = companiesData.find(c => c.id === workOrderData.company_id);
      if (company) {
        setSelectedCompany(company);
      }

      // Find the document type ID by matching the code
      const documentType = documentTypes.find(dt => {
        // Match by code (case-insensitive)
        return dt.code && dt.code.toUpperCase() === workOrderData.document_type?.toUpperCase();
      });

      // Set form values
      const formValues = {
        document_type: documentType?.id || '',
        client_name: workOrderData.client_name,
        client_phone: workOrderData.client_phone || '',
        client_email: workOrderData.client_email || '',
        client_address: workOrderData.client_address || '',
        client_city: workOrderData.client_city || '',
        client_state: workOrderData.client_state || '',
        client_zipcode: workOrderData.client_zipcode || '',
        trades: workOrderData.trades || [],
        consultation_notes: workOrderData.consultation_notes || '',
        cost_override: workOrderData.cost_override || undefined,
      };

      form.setFieldsValue(formValues);
      
      // Set other state
      setWorkDescription(workOrderData.work_description || '');
      setSelectedDocumentType(documentType?.id || '');
      setSelectedTrades(workOrderData.trades || []);
      setFinalCost(workOrderData.final_cost || 0);
      
      // Set tax settings
      setApplyTax(workOrderData.apply_tax || false);
      if (workOrderData.tax_rate) {
        const rate = typeof workOrderData.tax_rate === 'string' 
          ? parseFloat(workOrderData.tax_rate) * 100  // Convert from decimal to percentage
          : workOrderData.tax_rate * 100;
        setTaxRate(rate);
      }
      
      // Set additional costs if they exist
      if (workOrderData.additional_costs && Array.isArray(workOrderData.additional_costs)) {
        setAdditionalCosts(workOrderData.additional_costs.map((cost: any, index: number) => ({
          id: cost.id || `loaded_${index}`,
          name: cost.name || '',
          amount: cost.amount || 0,
          description: cost.description || '',
          type: cost.type || 'custom',
          isTemplate: false
        })));
      }
    }
  }, [workOrderData, companiesData, documentTypes, workOrderLoading, form]);

  // Create work order mutation with cache invalidation
  const createWorkOrderMutation = useMutation({
    mutationFn: (data: WorkOrderFormData) => workOrderService.createWorkOrder(data),
    onSuccess: (response) => {
      message.success('Work order created successfully!');
      // Invalidate list query to show new work order
      queryClient.invalidateQueries({ queryKey: ['work-orders'] });
      // Prefetch the new work order data for smooth transition
      queryClient.setQueryData(['work-order', response.id], response);
      navigate(`/work-orders/${response.id}`);
    },
    onError: (error: any) => {
      console.error('Failed to create work order:', error);
      message.error(error.response?.data?.message || 'Failed to create work order');
    }
  });

  // Update work order mutation with optimistic update
  const updateWorkOrderMutation = useMutation({
    mutationFn: (data: Partial<WorkOrderFormData>) => workOrderService.updateWorkOrder(id!, data),
    onMutate: async (newData) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['work-order', id] });
      
      // Snapshot the previous value
      const previousWorkOrder = queryClient.getQueryData(['work-order', id]);
      
      // Optimistically update
      queryClient.setQueryData(['work-order', id], (old: any) => {
        if (!old) return old;
        return { ...old, ...newData };
      });
      
      return { previousWorkOrder };
    },
    onError: (error: any, variables, context) => {
      // Rollback on error
      if (context?.previousWorkOrder) {
        queryClient.setQueryData(['work-order', id], context.previousWorkOrder);
      }
      console.error('Failed to update work order:', error);
      message.error(error.response?.data?.message || 'Failed to update work order');
    },
    onSuccess: (response) => {
      message.success('Work order updated successfully!');
      // Invalidate queries to sync
      queryClient.invalidateQueries({ queryKey: ['work-order', id] });
      queryClient.invalidateQueries({ queryKey: ['work-orders'] });
      navigate(`/work-orders/${response.id}`);
    }
  });

  // Load credits when company is selected
  useEffect(() => {
    if (selectedCompany?.id) {
      // TODO: Load real credits from backend when credit API is implemented
      setAvailableCredits([]);
    } else {
      setAvailableCredits([]);
    }
  }, [selectedCompany]);

  const handleCompanySelect = (companyId: string) => {
    const company = companies.find(c => c.id === companyId);
    setSelectedCompany(company || null);
  };

  const handleDocumentTypeChange = (value: string) => {
    setSelectedDocumentType(value);
  };

  const handleTradesChange = (values: string[]) => {
    setSelectedTrades(values);
  };

  const handleSave = async (status: 'draft' | 'pending' = 'draft') => {
    try {
      const values = await form.validateFields();
      
      if (!selectedCompany) {
        message.error('Please select a company');
        return;
      }

      // Find selected document type to get code
      const selectedDocType = documentTypes.find(dt => dt.id === values.document_type);
      if (!selectedDocType) {
        message.error('Please select a valid document type');
        return;
      }

      const workOrderFormData: any = {
        company_id: selectedCompany.id,
        document_type: selectedDocType.code,  // Use the actual code from Document Types Management
        client_name: values.client_name,
        client_phone: values.client_phone,
        client_email: values.client_email,
        client_address: values.client_address,
        client_city: values.client_city,
        client_state: values.client_state,
        client_zipcode: values.client_zipcode,
        trades: values.trades || [],
        work_description: workDescription,
        consultation_notes: values.consultation_notes,
        cost_override: values.cost_override,
        additional_costs: additionalCosts,
        apply_tax: applyTax,
        tax_rate: taxRate.toString(),
        // In edit mode, preserve current status unless explicitly changing to pending
        // In create mode, use the status parameter (draft or pending)
        status: isEditMode 
          ? (status === 'pending' ? 'pending' : (workOrderData?.status || 'draft'))
          : status
        // work_order_number and created_by_staff_id will be auto-generated by backend
      };

      if (isEditMode) {
        updateWorkOrderMutation.mutate(workOrderFormData);
      } else {
        createWorkOrderMutation.mutate(workOrderFormData);
      }
    } catch (error) {
      console.error('Validation failed:', error);
      message.error('Please fill in all required fields');
    }
  };

  const handlePreview = () => {
    // TODO: Implement PDF preview
    message.info('PDF preview functionality will be implemented');
  };

  // Show loading spinner when in edit mode and loading work order data
  if (isEditMode && (workOrderLoading || !workOrderData)) {
    return (
      <div style={{ padding: '24px', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <Spin size="large" tip="Loading work order..." />
      </div>
    );
  }

  return (
    <div style={{ padding: '24px' }}>
      <Title level={2}>
        <FileTextOutlined style={{ marginRight: 8 }} />
        {isEditMode ? 'Edit Work Order' : 'Create Work Order'}
      </Title>

      <Form
        form={form}
        layout="vertical"
        onFinish={() => handleSave('pending')}
      >
        <Row gutter={24}>
          {/* Company Selection */}
          <Col xs={24}>
            <Card
              title={
                <Space>
                  <UserOutlined />
                  <span>Company Information</span>
                </Space>
              }
              style={{ marginBottom: 24 }}
            >
              <CompanySelector
                companies={companies}
                selectedCompany={selectedCompany}
                onCompanySelect={handleCompanySelect}
                loading={companiesLoading}
                showCompanyInfo={true}
              />
            </Card>
          </Col>

          {/* Document Type and Basic Info */}
          <Col xs={24} lg={12}>
            <Card
              title={
                <Space>
                  <FileTextOutlined />
                  <span>Work Order Details</span>
                </Space>
              }
              style={{ marginBottom: 24 }}
            >
              <Form.Item
                name="document_type"
                label="Document Type"
                rules={[{ required: true, message: 'Please select a document type' }]}
              >
                <Select 
                  placeholder="Select document type" 
                  size="large"
                  showSearch
                  filterOption={(input, option) =>
                    option?.children?.toString().toLowerCase().includes(input.toLowerCase()) || false
                  }
                  onChange={handleDocumentTypeChange}
                >
                  {documentTypes.map(type => (
                    <Option key={type.id} value={type.id}>
                      {type.name} - ${parseFloat(type.base_price).toFixed(2)}
                      {type.description && (
                        <span style={{ color: '#666', fontSize: '11px' }}>
                          {' '}({type.description})
                        </span>
                      )}
                    </Option>
                  ))}
                </Select>
              </Form.Item>

              <Form.Item
                name="trades"
                label="Trades Required"
                rules={[{ required: true, message: 'Please select at least one trade' }]}
              >
                <Select
                  mode="multiple"
                  placeholder="Select trades..."
                  size="large"
                  showSearch
                  filterOption={(input, option) =>
                    option?.children?.toString().toLowerCase().includes(input.toLowerCase()) || false
                  }
                  optionLabelProp="label"
                  onChange={handleTradesChange}
                >
                  {trades
                    .filter(trade => trade.is_active)
                    .sort((a, b) => a.display_order - b.display_order)
                    .map(trade => (
                      <Option 
                        key={trade.id} 
                        value={trade.id}
                        label={trade.name}
                      >
                        <Space>
                          <ToolOutlined />
                          <span>{trade.name}</span>
                          {trade.category && (
                            <span style={{ color: '#666', fontSize: '11px' }}>
                              ({trade.category})
                            </span>
                          )}
                          {trade.code && (
                            <span style={{ color: '#999', fontSize: '10px' }}>
                              [{trade.code}]
                            </span>
                          )}
                        </Space>
                      </Option>
                    ))}
                </Select>
              </Form.Item>

              {/* Additional Costs Section - moved inside Work Order Details */}
              <Divider style={{ margin: '16px 0' }} />
              <AdditionalCosts
                costs={additionalCosts}
                onChange={setAdditionalCosts}
              />
            </Card>
          </Col>

          {/* Cost Calculation */}
          <Col xs={24} lg={12}>
            <CostCalculationPanel
              documentType={selectedDocumentType}
              selectedTrades={selectedTrades}
              availableCredits={availableCredits}
              companyId={selectedCompany?.id || ''}
              additionalCostsTotal={additionalCostsTotal}
              onCostChange={setFinalCost}
              onTaxSettingsChange={(applyTax, taxRate) => {
                setApplyTax(applyTax);
                setTaxRate(taxRate);
              }}
              initialApplyTax={applyTax}
              initialTaxRate={taxRate}
            />
          </Col>


          {/* Client Information */}
          <Col xs={24}>
            <Card
              title={
                <Space>
                  <UserOutlined />
                  <span>Client Information</span>
                </Space>
              }
              style={{ marginBottom: 24 }}
            >
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="client_name"
                    label="Client Name"
                    rules={[{ required: true, message: 'Please enter client name' }]}
                  >
                    <Input placeholder="Enter client name" size="large" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="client_phone" label="Phone">
                    <Input placeholder="Enter phone number" size="large" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="client_email" label="Email">
                    <Input type="email" placeholder="Enter email address" size="large" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="client_address" label="Address">
                    <Input placeholder="Enter address" size="large" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="client_city" label="City">
                    <Input placeholder="City" size="large" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="client_state" label="State">
                    <Input placeholder="State" size="large" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="client_zipcode" label="ZIP Code">
                    <Input placeholder="ZIP" size="large" />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Col>

          {/* Work Description */}
          <Col xs={24}>
            <Card
              title={
                <Space>
                  <ToolOutlined />
                  <span>Work Description</span>
                </Space>
              }
              style={{ marginBottom: 24 }}
            >
              <Form.Item label="Detailed Work Description">
                <div style={{ border: '1px solid #d9d9d9', borderRadius: '6px' }}>
                  <RichTextEditor
                    value={workDescription}
                    onChange={setWorkDescription}
                    placeholder="Describe the work to be performed in detail..."
                    minHeight={200}
                  />
                </div>
              </Form.Item>

              <Form.Item name="consultation_notes" label="Phone Consultation Notes">
                <TextArea
                  rows={4}
                  placeholder="Notes from phone consultation with client..."
                />
              </Form.Item>
            </Card>
          </Col>
        </Row>

        {/* Action Buttons */}
        <Card>
          <Row justify="space-between" align="middle">
            <Col>
              <Space size="middle">
                <Button
                  size="large"
                  onClick={() => navigate('/work-orders')}
                >
                  Cancel
                </Button>
                <Button
                  type="default"
                  size="large"
                  icon={<SaveOutlined />}
                  onClick={() => handleSave('draft')}
                  loading={createWorkOrderMutation.isPending || updateWorkOrderMutation.isPending}
                >
                  {isEditMode ? 'Save Changes' : 'Save as Draft'}
                </Button>
              </Space>
            </Col>
            <Col>
              <Space size="middle">
                <Button
                  size="large"
                  icon={<EyeOutlined />}
                  onClick={handlePreview}
                  disabled={!selectedCompany}
                >
                  Preview PDF
                </Button>
                <Button
                  type="primary"
                  size="large"
                  icon={<SendOutlined />}
                  htmlType="submit"
                  loading={createWorkOrderMutation.isPending || updateWorkOrderMutation.isPending}
                  disabled={!selectedCompany}
                >
                  {isEditMode ? 'Update & Send Work Order' : 'Create & Send Work Order'}
                </Button>
              </Space>
            </Col>
          </Row>

          {/* Cost Summary */}
          {finalCost > 0 && (
            <>
              <Divider />
              <Row justify="center">
                <Col>
                  <Space align="center" size="large">
                    <DollarOutlined style={{ fontSize: '20px', color: '#1890ff' }} />
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '12px', color: '#666' }}>Estimated Cost</div>
                      <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#1890ff' }}>
                        ${finalCost.toFixed(2)}
                      </div>
                    </div>
                  </Space>
                </Col>
              </Row>
            </>
          )}
        </Card>
      </Form>
    </div>
  );
};

export default WorkOrderCreation;