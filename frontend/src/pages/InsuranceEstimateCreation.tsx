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
  Tabs,
} from 'antd';
import {
  SaveOutlined,
  EyeOutlined,
  FileTextOutlined,
  SafetyOutlined,
  DollarOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate, useParams } from 'react-router-dom';
import { estimateService, EstimateLineItem, EstimateResponse } from '../services/EstimateService';
import { companyService } from '../services/companyService';
import GroupableLineItemsWithSidebar from '../components/estimate/GroupableLineItemsWithSidebar';
import RichTextEditor from '../components/editor/RichTextEditor';
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

interface InsuranceEstimateCreationProps {
  initialEstimate?: EstimateResponse;
}

const InsuranceEstimateCreation: React.FC<InsuranceEstimateCreationProps> = ({ initialEstimate }) => {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id;
  
  // State management
  const [loading, setLoading] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [items, setItems] = useState<EstimateLineItem[]>([]);
  const [showInsurance, setShowInsurance] = useState(true); // Default to true for insurance estimates
  const [activeTab, setActiveTab] = useState('basic');
  
  // Modal and editing states - removed unused modal states since using GroupableLineItemsWithSidebar
  
  // Removed unused search states since using GroupableLineItemsWithSidebar

  // Load companies only when needed
  const loadCompanies = useCallback(async () => {
    if (companies.length > 0) return companies; // Already loaded

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
  }, [companies]);

  // Load initial data (only for edit mode)
  useEffect(() => {
    const loadData = async () => {
      if (!id) return; // No need to load anything for create mode

      try {
        setLoading(true);

        // Load companies first for edit mode
        const companiesData = await loadCompanies();

        const estimate = initialEstimate || await estimateService.getEstimate(id);
        console.log('=== ESTIMATE LOADED ===', estimate);
        console.log('=== CLIENT DATA LOADED ===');
        console.log('estimate.client_name:', `"${estimate.client_name}"`);
        console.log('estimate.loss_date:', estimate.loss_date);

        if (estimate) {
          // Find and set the selected company from the loaded companies list
          console.log('Estimate company_id:', estimate.company_id);
          console.log('Estimate company_name:', estimate.company_name);
          console.log('Companies loaded:', companiesData.length, companiesData);

          // Handle company selection - prioritize company_id, fallback to company_name
          let companyToSelect: Company | null = null;

          if (estimate.company_id && companiesData.length > 0) {
            // Try to find by company_id first
            companyToSelect = companiesData.find(c => c.id === estimate.company_id) || null;
            console.log('Found company by ID:', companyToSelect?.name);
          }

          if (!companyToSelect && estimate.company_name && companiesData.length > 0) {
            // Fallback to find by company name
            companyToSelect = companiesData.find(c =>
              c.name.toLowerCase() === estimate.company_name!.toLowerCase()
            ) || null;
            console.log('Found company by name:', companyToSelect?.name);
            // Update the estimate data with the found company_id
            if (companyToSelect) {
              estimate.company_id = companyToSelect.id;
            }
          }

          if (!companyToSelect && estimate.company_name) {
            // Create company from estimate data if not found in companies list
            companyToSelect = {
              id: estimate.company_id || `temp-${Date.now()}`,
              name: estimate.company_name,
              address: estimate.company_address || '',
              city: estimate.company_city || '',
              state: estimate.company_state || '',
              zipcode: estimate.company_zipcode || '',
              phone: estimate.company_phone || '',
              email: estimate.company_email || '',
            };
            // Add it to the companies list so it appears in the dropdown
            setCompanies([companyToSelect, ...companiesData]);
            console.log('Created company from estimate data:', companyToSelect.name);
          }

          if (companyToSelect) {
            setSelectedCompany(companyToSelect);
            console.log('Set selected company:', companyToSelect.name);
            // Also make sure the form field is updated with the correct company_id
            if (companyToSelect.id && companyToSelect.id !== `temp-${Date.now()}`) {
              estimate.company_id = companyToSelect.id;
            }
          } else {
            console.log('No company could be determined from estimate data');
          }

          // Set form values including all fields
          const formValues = {
            estimate_number: estimate.estimate_number,
            company_id: estimate.company_id,
            client_name: estimate.client_name,
            client_address: estimate.client_address,
            client_city: estimate.client_city,
            client_state: estimate.client_state,
            client_zipcode: estimate.client_zipcode,
            client_phone: estimate.client_phone,
            client_email: estimate.client_email,
            claim_number: estimate.claim_number,
            policy_number: estimate.policy_number,
            insurance_company: estimate.insurance_company,
            adjuster_name: estimate.adjuster_name,
            adjuster_phone: estimate.adjuster_phone,
            adjuster_email: estimate.adjuster_email,
            deductible: estimate.deductible,
            estimate_date: estimate.estimate_date ? dayjs(estimate.estimate_date) : dayjs(),
            loss_date: estimate.loss_date ? dayjs(estimate.loss_date) : undefined,
            notes: estimate.notes,
            terms: estimate.terms,
          };

          console.log('=== FORM VALUES BEING SET ===', formValues);
          form.setFieldsValue(formValues);

          setItems(estimate.items || []);
          // Show insurance section if any insurance field has data OR if it's an insurance estimate
          setShowInsurance(
            estimate.estimate_type === 'insurance' ||
            !!estimate.claim_number ||
            !!estimate.policy_number ||
            !!estimate.insurance_company ||
            !!estimate.adjuster_name ||
            !!estimate.adjuster_phone ||
            !!estimate.adjuster_email ||
            !!estimate.deductible ||
            !!estimate.loss_date
          );
        }
      } catch (error) {
        message.error('Failed to load data');
        console.error(error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [id, initialEstimate]); // eslint-disable-line react-hooks/exhaustive-deps
  // Note: form and loadCompanies are stable, companies and selectedCompany are managed within the effect

  // Removed unused search functions since using GroupableLineItemsWithSidebar

  // Removed unused item management functions since using GroupableLineItemsWithSidebar

  const calculateTotals = () => {
    return estimateService.calculateTotals(items);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      // Get all form values including optional fields
      const allFormValues = form.getFieldsValue();
      // Merge validated required fields with all form values
      const completeValues = { ...allFormValues, ...values };
      console.log('Form values (validated):', values);
      console.log('All form values:', allFormValues);
      console.log('Complete values:', completeValues);
      console.log('Selected company:', selectedCompany);
      console.log('=== COMPANY DEBUG ===');
      console.log('completeValues.company_id:', completeValues.company_id);
      console.log('selectedCompany?.id:', selectedCompany?.id);
      console.log('currentSelectedCompany will be:', selectedCompany);
      console.log('=== LOSS DATE DEBUG ===');
      console.log('completeValues.loss_date:', completeValues.loss_date);
      console.log('completeValues.loss_date type:', typeof completeValues.loss_date);
      console.log('Is dayjs object?', completeValues.loss_date && typeof completeValues.loss_date.format === 'function');
      console.log('=== CLIENT DEBUG ===');
      console.log('completeValues.client_name:', completeValues.client_name);
      console.log('values.client_name:', values.client_name);
      console.log('allFormValues.client_name:', allFormValues.client_name);
      setLoading(true);

      // Ensure selectedCompany is set if company_id is provided but selectedCompany is null
      let currentSelectedCompany = selectedCompany;
      if (!currentSelectedCompany && completeValues.company_id) {
        // Try to find company in the existing companies list
        if (companies.length > 0) {
          currentSelectedCompany = companies.find(c => c.id === completeValues.company_id) || null;
          if (currentSelectedCompany) {
            setSelectedCompany(currentSelectedCompany);
            console.log('Restored selected company from companies list:', currentSelectedCompany.name);
          }
        }

        // If still not found, load companies and try again
        if (!currentSelectedCompany) {
          try {
            const companiesData = await loadCompanies();
            currentSelectedCompany = companiesData.find(c => c.id === completeValues.company_id) || null;
            if (currentSelectedCompany) {
              setSelectedCompany(currentSelectedCompany);
              console.log('Loaded and set selected company:', currentSelectedCompany.name);
            }
          } catch (error) {
            console.error('Failed to load companies for company lookup:', error);
          }
        }
      }

      const totals = calculateTotals();

      // Generate estimate number if not provided
      let estimateNumber = completeValues.estimate_number;
      if (!estimateNumber) {
        estimateNumber = await estimateService.generateEstimateNumber();
      }

      console.log('Using company info for save:', {
        company_id: completeValues.company_id || currentSelectedCompany?.id,
        company_name: currentSelectedCompany?.name,
        company_address: currentSelectedCompany?.address,
        company_city: currentSelectedCompany?.city,
        company_state: currentSelectedCompany?.state,
        company_zipcode: currentSelectedCompany?.zipcode,
        company_phone: currentSelectedCompany?.phone,
        company_email: currentSelectedCompany?.email,
      });

      const estimateData: EstimateResponse = {
        estimate_number: estimateNumber,
        estimate_type: 'insurance',  // Mark as insurance estimate
        company_id: completeValues.company_id || currentSelectedCompany?.id,
        company_name: currentSelectedCompany?.name,
        company_address: currentSelectedCompany?.address,
        company_city: currentSelectedCompany?.city,
        company_state: currentSelectedCompany?.state,
        company_zipcode: currentSelectedCompany?.zipcode,
        company_phone: currentSelectedCompany?.phone,
        company_email: currentSelectedCompany?.email,
        client_name: completeValues.client_name,
        client_address: completeValues.client_address,
        client_city: completeValues.client_city,
        client_state: completeValues.client_state,
        client_zipcode: completeValues.client_zipcode,
        client_phone: completeValues.client_phone,
        client_email: completeValues.client_email,
        ...(showInsurance && {
          claim_number: completeValues.claim_number,
          policy_number: completeValues.policy_number,
          insurance_company: completeValues.insurance_company,
          adjuster_name: completeValues.adjuster_name,
          adjuster_phone: completeValues.adjuster_phone,
          adjuster_email: completeValues.adjuster_email,
          deductible: completeValues.deductible,
          loss_date: completeValues.loss_date ? completeValues.loss_date.format('YYYY-MM-DD') : undefined,
        }),
        estimate_date: completeValues.estimate_date ? completeValues.estimate_date.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
        items,
        ...totals,
        notes: completeValues.notes,
        terms: completeValues.terms,
        status: 'draft',
      };

      console.log('=== FINAL ESTIMATE DATA TO SAVE ===');
      console.log('estimateData.company_id:', estimateData.company_id);
      console.log('estimateData.company_name:', estimateData.company_name);
      console.log('estimateData.loss_date:', estimateData.loss_date);
      console.log('Full estimateData:', estimateData);

      let response;
      if (id) {
        response = await estimateService.updateEstimate(id, estimateData);
        message.success('Estimate updated successfully!');
        navigate('/documents/estimate');
        return;
      } else {
        response = await estimateService.createEstimate(estimateData);
        message.success('Estimate created successfully!');
        // Update URL to edit mode after creation to prevent duplicate creation
        navigate(`/insurance-estimate/${response.id}`, { replace: true });
      }
    } catch (error) {
      message.error(`Failed to ${id ? 'update' : 'create'} estimate`);
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!id) {
      message.warning('Cannot delete an unsaved estimate');
      return;
    }

    // Show confirmation dialog
    const confirmed = window.confirm(
      `Are you sure you want to delete this estimate? This action cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    try {
      setLoading(true);
      await estimateService.deleteEstimate(id);
      message.success('Estimate deleted successfully');
      navigate('/documents');
    } catch (error) {
      message.error('Failed to delete estimate');
      console.error('Delete estimate error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePreviewPDF = async () => {
    try {
      const values = await form.validateFields();
      // Get all form values including optional fields
      const allFormValues = form.getFieldsValue();
      // Merge validated required fields with all form values
      const completeValues = { ...allFormValues, ...values };
      setLoading(true);
      
      const totals = calculateTotals();
      // Generate estimate number if not provided
      let estimateNumber = completeValues.estimate_number;
      if (!estimateNumber) {
        estimateNumber = await estimateService.generateEstimateNumber();
      }

      const estimateData: EstimateResponse = {
        estimate_number: estimateNumber,
        estimate_type: 'insurance',  // Mark as insurance estimate
        company_id: completeValues.company_id || selectedCompany?.id,
        company_name: selectedCompany?.name,
        company_address: selectedCompany?.address,
        company_city: selectedCompany?.city,
        company_state: selectedCompany?.state,
        company_zipcode: selectedCompany?.zipcode,
        company_phone: selectedCompany?.phone,
        company_email: selectedCompany?.email,
        client_name: completeValues.client_name,
        client_address: completeValues.client_address,
        client_city: completeValues.client_city,
        client_state: completeValues.client_state,
        client_zipcode: completeValues.client_zipcode,
        client_phone: completeValues.client_phone,
        client_email: completeValues.client_email,
        ...(showInsurance && {
          claim_number: completeValues.claim_number,
          policy_number: completeValues.policy_number,
          insurance_company: completeValues.insurance_company,
          adjuster_name: completeValues.adjuster_name,
          adjuster_phone: completeValues.adjuster_phone,
          adjuster_email: completeValues.adjuster_email,
          deductible: completeValues.deductible,
          loss_date: completeValues.loss_date ? completeValues.loss_date.format('YYYY-MM-DD') : undefined,
        }),
        estimate_date: completeValues.estimate_date ? completeValues.estimate_date.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
        items,
        ...totals,
        notes: completeValues.notes,
        terms: completeValues.terms,
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
              extra={!selectedCompany && isEditMode ? "No company selected for this estimate. Please select one." : null}
            >
              <Select
                placeholder={isEditMode && !selectedCompany ? "Select a company for this estimate" : "Select a company"}
                status={!selectedCompany && isEditMode ? "warning" : undefined}
                onChange={async (value) => {
                  console.log('Select onChange triggered with value:', value);
                  const company = companies.find(c => c.id === value);
                  console.log('Found company:', company);

                  if (company) {
                    // Create a clean copy of company to avoid circular references
                    const cleanCompany: Company = {
                      id: company.id,
                      name: company.name,
                      address: company.address,
                      city: company.city,
                      state: company.state,
                      zipcode: company.zipcode,
                      phone: company.phone,
                      email: company.email,
                      company_code: company.company_code
                    };

                    setSelectedCompany(cleanCompany);
                    console.log('Set selectedCompany:', cleanCompany.name);

                    // Update form field with company_id
                    form.setFieldsValue({ company_id: cleanCompany.id });
                    console.log('Set form company_id:', cleanCompany.id);

                    // Generate new estimate number based on selected company (only in create mode)
                    if (!isEditMode) {
                      try {
                        const newEstimateNumber = await estimateService.generateEstimateNumber(
                          company.id,
                          'insurance'
                        );
                        form.setFieldsValue({ estimate_number: newEstimateNumber });
                        console.log('Generated new estimate number:', newEstimateNumber);
                      } catch (error) {
                        console.error('Failed to generate estimate number:', error);
                        // Fallback to default number if API fails
                        const fallbackNumber = `EST-INS-${new Date().getFullYear()}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
                        form.setFieldsValue({ estimate_number: fallbackNumber });
                      }
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
                notFoundContent={companies.length === 0 ? "Loading companies..." : "No companies found"}
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
                { required: true, message: 'Estimate number is required' }
              ]}
            >
              <Input
                prefix="#"
                placeholder={isEditMode ? "Estimate number" : "Select company to generate number"}
                disabled={!isEditMode && !selectedCompany}
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

{selectedCompany ? (
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
      ) : isEditMode ? (
        <Card
          title="Company Information Missing"
          style={{ marginBottom: 24, borderColor: '#faad14' }}
        >
          <Row gutter={16}>
            <Col span={24}>
              <Text type="warning">
                This estimate doesn't have a company associated with it.
                Please select a company above to complete the estimate information.
              </Text>
            </Col>
          </Row>
        </Card>
      ) : null}
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
            {/* Client Name, Email, Phone in one row */}
            <Col xs={24} md={8}>
              <Form.Item
                name="client_name"
                label="Client Name"
              >
                <Input placeholder="Enter client name" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="client_email" label="Email">
                <Input type="email" placeholder="client@example.com" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="client_phone" label="Phone">
                <Input placeholder="(xxx) xxx-xxxx" />
              </Form.Item>
            </Col>

            {/* Address, City, State, Zip in one row */}
            <Col xs={24} md={12}>
              <Form.Item
                name="client_address"
                label="Address"
                rules={[{ required: true, message: 'Address is required' }]}
              >
                <Input placeholder="Street address" />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="client_city" label="City">
                <Input placeholder="City" />
              </Form.Item>
            </Col>
            <Col xs={24} md={3}>
              <Form.Item name="client_state" label="State">
                <Input placeholder="State" maxLength={2} style={{ textTransform: 'uppercase' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={3}>
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
              <Col xs={24} md={6}>
                <Form.Item name="insurance_company" label="Insurance Company">
                  <Input placeholder="Insurance company name" />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name="claim_number" label="Claim Number">
                  <Input placeholder="Insurance claim number" />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name="policy_number" label="Policy Number">
                  <Input placeholder="Insurance policy number" />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name="loss_date" label="Date of Loss">
                  <DatePicker style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
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
            </Row>

            {/* Adjuster Information in one row */}
            <Row gutter={16}>
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
              <Col xs={24} md={8}>
                <Form.Item name="adjuster_email" label="Adjuster Email">
                  <Input type="email" placeholder="adjuster@insurance.com" />
                </Form.Item>
              </Col>
            </Row>
          </>
        ) : null
      }
    ];

    return (
      <Collapse
        defaultActiveKey={['client', 'insurance']}
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
        name: item.name,
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
            <RichTextEditor
              placeholder="Enter any additional notes..."
              minHeight={120}
              maxHeight={300}
            />
          </Form.Item>

          <Form.Item name="terms" label="Terms & Conditions">
            <RichTextEditor
              placeholder="Enter terms and conditions..."
              minHeight={120}
              maxHeight={300}
            />
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
            {isEditMode && (
              <Button
                icon={<DeleteOutlined />}
                onClick={handleDelete}
                loading={loading}
                block
                danger
              >
                Delete Estimate
              </Button>
            )}
            <Button block onClick={() => navigate('/documents')}>
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
              {isEditMode && (
                <Button
                  icon={<DeleteOutlined />}
                  onClick={handleDelete}
                  loading={loading}
                  danger
                >
                  Delete
                </Button>
              )}
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
            estimate_date: dayjs(),
            // Don't set estimate_number initial value to avoid conflicts
            // Don't set company_id initial value to avoid conflicts in edit mode
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