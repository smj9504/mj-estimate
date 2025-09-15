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
  message,
  Divider,
  Switch,
  Typography,
  Collapse,
  Badge,
  Alert,
  Tabs,
} from 'antd';
import {
  SaveOutlined,
  EyeOutlined,
  FileTextOutlined,
  SafetyOutlined,
  DollarOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate, useParams } from 'react-router-dom';
import { estimateService, EstimateLineItem, InsuranceEstimate } from '../services/EstimateService';
import { companyService } from '../services/companyService';
import GroupableLineItemsWithSidebar from '../components/estimate/GroupableLineItemsWithSidebar';
import { Company } from '../types';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { Option } = Select;

// Utility function to format number with thousand separators
const formatNumber = (num: number | undefined | null): string => {
  if (num === undefined || num === null) return '0.00';
  return num.toLocaleString('en-US', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  });
};

// Removed unused LineItemSearchResult interface since using GroupableLineItemsWithSidebar

const InsuranceEstimateCreation: React.FC = () => {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id;
  
  // State management
  const [loading, setLoading] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [items, setItems] = useState<EstimateLineItem[]>([]);
  const [showInsurance, setShowInsurance] = useState(false);
  const [activeTab, setActiveTab] = useState('basic');
  
  // Modal and editing states - removed unused modal states since using GroupableLineItemsWithSidebar
  
  // Removed unused search states since using GroupableLineItemsWithSidebar

  // Load companies only when needed
  const loadCompanies = async () => {
    if (companies.length > 0) return; // Already loaded
    
    try {
      setLoading(true);
      const companiesData = await companyService.getCompanies();
      setCompanies(companiesData);
      return companiesData;
    } catch (error) {
      message.error('Failed to load companies');
      console.error(error);
      return [];
    } finally {
      setLoading(false);
    }
  };

  // Load initial data (only for edit mode)
  useEffect(() => {
    const loadData = async () => {
      if (!id) return; // No need to load anything for create mode

      try {
        setLoading(true);
        
        // Load companies first for edit mode
        const companiesData = await loadCompanies();

        const estimate = await estimateService.getEstimate(id);
        if (estimate) {
          form.setFieldsValue({
            ...estimate,
            estimate_date: estimate.estimate_date ? dayjs(estimate.estimate_date) : dayjs(),
            loss_date: estimate.loss_date ? dayjs(estimate.loss_date) : undefined,
          });
          
          setItems(estimate.items || []);
          setShowInsurance(!!estimate.claim_number || !!estimate.policy_number);
          
          // Find company if companiesData is available
          if (companiesData && companiesData.length > 0) {
            const company = companiesData.find(c => c.id === estimate.company_id);
            if (company) setSelectedCompany(company);
          }
        }
      } catch (error) {
        message.error('Failed to load data');
        console.error(error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [id, form, loadCompanies]);

  // Removed unused search functions since using GroupableLineItemsWithSidebar

  // Removed unused item management functions since using GroupableLineItemsWithSidebar

  const calculateTotals = () => {
    return estimateService.calculateTotals(items);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      console.log('Form values:', values);
      setLoading(true);

      const totals = calculateTotals();

      // Generate estimate number if not provided
      let estimateNumber = values.estimate_number;
      if (!estimateNumber) {
        estimateNumber = await estimateService.generateEstimateNumber();
      }

      const estimateData: InsuranceEstimate = {
        estimate_number: estimateNumber,
        estimate_type: 'insurance',  // Mark as insurance estimate
        company_id: values.company_id,
        company_name: selectedCompany?.name,
        company_address: selectedCompany?.address,
        company_city: selectedCompany?.city,
        company_state: selectedCompany?.state,
        company_zipcode: selectedCompany?.zipcode,
        company_phone: selectedCompany?.phone,
        company_email: selectedCompany?.email,
        client_name: values.client_name,
        client_address: values.client_address,
        client_city: values.client_city,
        client_state: values.client_state,
        client_zipcode: values.client_zipcode,
        client_phone: values.client_phone,
        client_email: values.client_email,
        ...(showInsurance && {
          claim_number: values.claim_number,
          policy_number: values.policy_number,
          insurance_company: values.insurance_company,
          adjuster_name: values.adjuster_name,
          adjuster_phone: values.adjuster_phone,
          adjuster_email: values.adjuster_email,
          deductible: values.deductible,
        }),
        estimate_date: values.estimate_date ? values.estimate_date.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
        loss_date: values.loss_date ? values.loss_date.format('YYYY-MM-DD') : undefined,
        items,
        ...totals,
        notes: values.notes,
        terms: values.terms,
        status: 'draft',
      };

      let response;
      if (id) {
        response = await estimateService.updateEstimate(id, estimateData);
      } else {
        response = await estimateService.createEstimate(estimateData);
      }

      message.success(`Estimate ${id ? 'updated' : 'created'} successfully!`);
      navigate(`/estimates/${response.id}`);
    } catch (error) {
      message.error(`Failed to ${id ? 'update' : 'create'} estimate`);
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handlePreviewPDF = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      
      const totals = calculateTotals();
      // Generate estimate number if not provided
      let estimateNumber = values.estimate_number;
      if (!estimateNumber) {
        estimateNumber = await estimateService.generateEstimateNumber();
      }

      const estimateData: InsuranceEstimate = {
        estimate_number: estimateNumber,
        estimate_type: 'insurance',  // Mark as insurance estimate
        company_id: values.company_id,
        company_name: selectedCompany?.name,
        company_address: selectedCompany?.address,
        company_city: selectedCompany?.city,
        company_state: selectedCompany?.state,
        company_zipcode: selectedCompany?.zipcode,
        company_phone: selectedCompany?.phone,
        company_email: selectedCompany?.email,
        client_name: values.client_name,
        client_address: values.client_address,
        client_city: values.client_city,
        client_state: values.client_state,
        client_zipcode: values.client_zipcode,
        client_phone: values.client_phone,
        client_email: values.client_email,
        ...(showInsurance && {
          claim_number: values.claim_number,
          policy_number: values.policy_number,
          insurance_company: values.insurance_company,
          adjuster_name: values.adjuster_name,
          adjuster_phone: values.adjuster_phone,
          adjuster_email: values.adjuster_email,
          deductible: values.deductible,
        }),
        estimate_date: values.estimate_date ? values.estimate_date.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
        loss_date: values.loss_date ? values.loss_date.format('YYYY-MM-DD') : undefined,
        items,
        ...totals,
        notes: values.notes,
        terms: values.terms,
        status: 'draft',
      };

      const pdfBlob = await estimateService.previewPDF(estimateData);
      const pdfUrl = URL.createObjectURL(pdfBlob);
      window.open(pdfUrl, '_blank');
      
      // Clean up the object URL after opening
      setTimeout(() => {
        URL.revokeObjectURL(pdfUrl);
      }, 1000);
    } catch (error) {
      message.error('Failed to generate PDF');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const totals = calculateTotals();

  // Tab configurations
  const tabItems = [
    {
      key: 'basic',
      label: (
        <Space>
          <FileTextOutlined />
          Basic Info
        </Space>
      ),
    },
    {
      key: 'client',
      label: (
        <Space>
          <SafetyOutlined />
          Client & Insurance
        </Space>
      ),
    },
    {
      key: 'items',
      label: (
        <Space>
          <DollarOutlined />
          Line Items
          {items.length > 0 && <Badge count={items.length} size="small" />}
        </Space>
      ),
    },
    {
      key: 'review',
      label: (
        <Space>
          <CheckCircleOutlined />
          Review
        </Space>
      ),
    },
  ];

  // Basic Info Tab Content
  const renderBasicInfoTab = () => (
    <>
      <Card title="Basic Information" style={{ marginBottom: 24 }}>
        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Form.Item
              name="company_id"
              label="Company"
              rules={[{ required: true, message: 'Please select a company' }]}
            >
              <Select
                placeholder="Select a company"
                onChange={async (value) => {
                  const company = companies.find(c => c.id === value);
                  if (company) {
                    setSelectedCompany(company);
                    
                    // Generate new estimate number based on selected company
                    try {
                      const newEstimateNumber = await estimateService.generateEstimateNumber(
                        company.id, 
                        'insurance'
                      );
                      // Use setFieldsValue to avoid circular reference warning
                      form.setFieldsValue({ estimate_number: newEstimateNumber });
                    } catch (error) {
                      console.error('Failed to generate estimate number:', error);
                      // Fallback to default number if API fails
                      const fallbackNumber = `EST-INS-${new Date().getFullYear()}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
                      form.setFieldsValue({ estimate_number: fallbackNumber });
                    }
                  }
                }}
                onOpenChange={async (open: boolean) => {
                  if (open && companies.length === 0) {
                    await loadCompanies();
                  }
                }}
                showSearch
                optionFilterProp="children"
                loading={loading && companies.length === 0}
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
              name="estimate_number"
              label="Estimate Number"
              rules={[
                { required: true, message: 'Please select a company first to generate estimate number' }
              ]}
            >
              <Input 
                prefix="#" 
                placeholder="Select company to generate number"
                disabled={!selectedCompany}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item
              name="estimate_date"
              label="Estimate Date"
              rules={[{ required: true }]}
            >
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
      </Card>

      {selectedCompany && (
        <Card title="Selected Company Details" style={{ marginBottom: 24 }}>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <div>
                <Text strong>{selectedCompany.name}</Text>
                <br />
                <Text type="secondary">{selectedCompany.address}</Text>
                <br />
                <Text type="secondary">{selectedCompany.city}, {selectedCompany.state} {selectedCompany.zipcode}</Text>
              </div>
            </Col>
            <Col xs={24} md={12}>
              <div>
                <Text><strong>Phone:</strong> {selectedCompany.phone}</Text>
                <br />
                <Text><strong>Email:</strong> {selectedCompany.email}</Text>
              </div>
            </Col>
          </Row>
        </Card>
      )}
    </>
  );

  // Client & Insurance Tab Content
  const renderClientInsuranceTab = () => {
    const collapseItems = [
      {
        key: 'client',
        label: (
          <Space>
            <FileTextOutlined />
            <Text strong>Client Information</Text>
            <Badge status="error" text="Required" />
          </Space>
        ),
        children: (
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="client_name"
                label="Client Name"
              >
                <Input placeholder="Enter client name" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="client_email" label="Email">
                <Input type="email" placeholder="client@example.com" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="client_address"
                label="Address"
                rules={[{ required: true, message: 'Address is required' }]}
              >
                <Input placeholder="Street address" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="client_phone" label="Phone">
                <Input placeholder="(xxx) xxx-xxxx" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="client_city" label="City">
                <Input placeholder="City" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="client_state" label="State">
                <Input placeholder="State" maxLength={2} style={{ textTransform: 'uppercase' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="client_zipcode" label="ZIP Code">
                <Input placeholder="12345" maxLength={10} />
              </Form.Item>
            </Col>
          </Row>
        )
      },
      {
        key: 'insurance',
        label: (
          <Space>
            <SafetyOutlined />
            <Text strong>Insurance Information</Text>
            <Switch
              size="small"
              checked={showInsurance}
              onChange={setShowInsurance}
            />
          </Space>
        ),
        children: showInsurance ? (
          <>
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item name="claim_number" label="Claim Number">
                  <Input placeholder="Insurance claim number" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="policy_number" label="Policy Number">
                  <Input placeholder="Insurance policy number" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="insurance_company" label="Insurance Company">
                  <Input placeholder="Insurance company name" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="deductible" label="Deductible">
                  <InputNumber
                    style={{ width: '100%' }}
                    prefix="$"
                    min={0}
                    max={999999.99}
                    step={0.01}
                    precision={2}
                    placeholder="0.00"
                    controls={true}
                    keyboard={true}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="loss_date" label="Date of Loss">
                  <DatePicker style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="adjuster_name" label="Adjuster Name">
                  <Input placeholder="Adjuster name" />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="adjuster_phone" label="Adjuster Phone">
                  <Input placeholder="(xxx) xxx-xxxx" />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="adjuster_email" label="Adjuster Email">
              <Input type="email" placeholder="adjuster@insurance.com" />
            </Form.Item>
          </>
        ) : null
      }
    ];

    return (
      <Collapse 
        defaultActiveKey={['client']}
        style={{ marginBottom: 24 }}
        expandIconPosition="end"
        items={collapseItems}
      />
    );
  };

  // Items change handler with logging
  const handleItemsChange = (newItems: EstimateLineItem[]) => {
    console.log('InsuranceEstimateCreation: setItems called with:', newItems);
    console.log('InsuranceEstimateCreation: Previous items count:', items.length);
    console.log('InsuranceEstimateCreation: New items count:', newItems.length);
    
    // Log group information for each item
    newItems.forEach((item, index) => {
      console.log(`InsuranceEstimateCreation: Item ${index}:`, {
        id: item.id,
        item: item.item,
        primary_group: item.primary_group,
        secondary_group: item.secondary_group,
        hasGroup: !!(item.primary_group || item.secondary_group)
      });
    });
    
    setItems(newItems);
  };

  // Line Items Tab Content
  const renderLineItemsTab = () => (
    <div style={{ height: '100%' }}>
      <GroupableLineItemsWithSidebar
        items={items || []}
        onItemsChange={handleItemsChange}
      />
    </div>
  );

  // Review Tab Content - using Form.Item dependencies for safe value access
  const renderReviewTab = () => (
    <Row gutter={24}>
      <Col xs={24} lg={14}>
        <Card title="Estimate Summary" style={{ marginBottom: 24 }}>
          <Form.Item dependencies={['estimate_number', 'estimate_date', 'client_name']} noStyle>
            {({ getFieldValue }) => (
              <Row gutter={[16, 16]}>
                <Col span={12}>
                  <Text type="secondary">Estimate #:</Text>
                  <div><Text strong>{getFieldValue('estimate_number') || 'Not set'}</Text></div>
                </Col>
                <Col span={12}>
                  <Text type="secondary">Date:</Text>
                  <div><Text strong>{getFieldValue('estimate_date')?.format('MM/DD/YYYY') || 'Not set'}</Text></div>
                </Col>
                <Col span={12}>
                  <Text type="secondary">Client:</Text>
                  <div><Text strong>{getFieldValue('client_name') || 'Not set'}</Text></div>
                </Col>
                <Col span={12}>
                  <Text type="secondary">Items:</Text>
                  <div><Text strong>{items.length} items</Text></div>
                </Col>
              </Row>
            )}
          </Form.Item>
          
          <Divider />
          
          <Form.Item name="notes" label="Additional Notes">
            <TextArea rows={4} placeholder="Enter any additional notes..." />
          </Form.Item>
          
          <Form.Item name="terms" label="Terms & Conditions">
            <TextArea rows={4} placeholder="Enter terms and conditions..." />
          </Form.Item>
        </Card>
      </Col>
      
      <Col xs={24} lg={10}>
        <Card title="Financial Summary" style={{ marginBottom: 24 }}>
          <div style={{ fontSize: '16px' }}>
            <Row justify="space-between" style={{ marginBottom: 16 }}>
              <Col>
                <Text>Total RCV:</Text>
              </Col>
              <Col>
                <Text strong style={{ fontSize: '20px', color: '#52c41a' }}>
                  ${formatNumber(totals.rcv_total)}
                </Text>
              </Col>
            </Row>
            
            {showInsurance && (
              <>
                <Divider />
                <Form.Item dependencies={['deductible']} noStyle>
                  {({ getFieldValue }) => (
                    <Row justify="space-between" style={{ marginBottom: 12 }}>
                      <Col><Text type="secondary">Deductible:</Text></Col>
                      <Col>
                        <Text>${formatNumber(getFieldValue('deductible') || 0)}</Text>
                      </Col>
                    </Row>
                  )}
                </Form.Item>
              </>
            )}
          </div>
        </Card>
        
        <Card>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSave}
              loading={loading}
              block
              size="large"
            >
              Save Estimate
            </Button>
            <Button
              icon={<EyeOutlined />}
              onClick={handlePreviewPDF}
              loading={loading}
              block
            >
              Preview PDF
            </Button>
            <Button block onClick={() => navigate('/documents/insurance_estimate')}>
              Cancel
            </Button>
          </Space>
        </Card>
      </Col>
    </Row>
  );

  // Render tab content based on active tab
  const renderTabContent = (tabKey: string) => {
    switch (tabKey) {
      case 'basic':
        return renderBasicInfoTab();
      case 'client':
        return renderClientInsuranceTab();
      case 'items':
        return renderLineItemsTab();
      case 'review':
        return renderReviewTab();
      default:
        return null;
    }
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid #f0f0f0', background: '#fff' }}>
        <Row justify="space-between" align="middle">
          <Col>
            <Title level={2} style={{ margin: 0 }}>
              {isEditMode ? 'Edit' : 'Create'} Insurance Estimate
            </Title>
          </Col>
          <Col>
            <Space>
              <Button 
                icon={<SaveOutlined />} 
                onClick={handleSave} 
                loading={loading}
              >
                Save Draft
              </Button>
              <Button 
                icon={<EyeOutlined />} 
                onClick={handlePreviewPDF} 
                loading={loading}
              >
                Preview PDF
              </Button>
            </Space>
          </Col>
        </Row>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            estimate_number: '', // Will be set when company is selected
            estimate_date: dayjs(),
          }}
        >
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            size="large"
            style={{ height: '100%' }}
            tabBarStyle={{ margin: 0, paddingLeft: '24px', paddingRight: '24px' }}
            destroyOnHidden={true}
            items={tabItems.map(tab => ({
              ...tab,
              children: (
                <div style={{ height: 'calc(100vh - 140px)', overflow: 'auto', padding: '0 24px 24px' }}>
                  {renderTabContent(tab.key)}
                </div>
              )
            }))}
          />
        </Form>
      </div>

      {/* Removed unused Line Item Modal since using GroupableLineItemsWithSidebar */}
    </div>
  );
};

export default InsuranceEstimateCreation;