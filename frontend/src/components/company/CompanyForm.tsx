import React, { useEffect, useState, useCallback } from 'react';
import {
  Form,
  Input,
  Button,
  Row,
  Col,
  Space,
  Tabs,
  Select,
  Upload,
  message,
  Typography,
  Tag,
} from 'antd';
import {
  SaveOutlined, CloseOutlined, UploadOutlined,
  FilePdfOutlined, DeleteOutlined, CheckCircleFilled,
} from '@ant-design/icons';
import AddressAutocomplete from '../common/AddressAutocomplete';
import { Company, CompanyFormData, PaymentMethod, PaymentFrequency, CompanyType, COMPANY_TYPE_LABELS } from '../../types';
import { companyService } from '../../services/companyService';
import LogoUpload from './LogoUpload';
import LicenseManager from './LicenseManager';
import InsuranceManager from './InsuranceManager';
import ContractTemplateManager from './ContractTemplateManager';
import paymentConfigService from '../../services/paymentConfigService';

interface CompanyFormProps {
  initialData?: Company;
  onSubmit: (data: CompanyFormData) => Promise<void>;
  onCancel: () => void;
  loading?: boolean;
}

const CompanyForm: React.FC<CompanyFormProps> = ({
  initialData,
  onSubmit,
  onCancel,
  loading = false,
}) => {
  const [form] = Form.useForm();
  const [licenses, setLicenses] = useState<any[]>([]);
  const [insurancePolicies, setInsurancePolicies] = useState<any[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [paymentFrequencies, setPaymentFrequencies] = useState<PaymentFrequency[]>([]);

  // W9 state
  const [w9Info, setW9Info] = useState<{
    has_w9: boolean; filename: string | null; uploaded_at: string | null;
  }>({ has_w9: false, filename: null, uploaded_at: null });
  const [w9Uploading, setW9Uploading] = useState(false);

  useEffect(() => {
    // Load payment configurations
    const loadPaymentConfigs = async () => {
      try {
        const [methods, frequencies] = await Promise.all([
          paymentConfigService.getPaymentMethods(),
          paymentConfigService.getPaymentFrequencies()
        ]);
        setPaymentMethods(methods);
        setPaymentFrequencies(frequencies);
      } catch (error) {
        console.error('Failed to load payment configurations:', error);
      }
    };
    loadPaymentConfigs();

    // Load W9 info if editing
    if (initialData?.id) {
      companyService.getW9Info(initialData.id).then(setW9Info).catch(() => {});
    }

    if (initialData) {
      form.setFieldsValue({
        name: initialData.name,
        company_type: initialData.company_type,
        address: initialData.address,
        city: initialData.city,
        state: initialData.state,
        zipcode: initialData.zipcode,
        phone: initialData.phone,
        email: initialData.email,
        logo: initialData.logo,
        // Use new ID fields if available, fallback to legacy fields
        payment_method_id: initialData.payment_method_id,
        payment_frequency_id: initialData.payment_frequency_id,
        // Legacy fields for backward compatibility
        payment_method: initialData.payment_method,
        payment_frequency: initialData.payment_frequency,
      });
      // Set licenses and insurance if they exist
      setLicenses((initialData as any).licenses || []);
      setInsurancePolicies((initialData as any).insurance_policies || []);
    } else {
      form.resetFields();
      setLicenses([]);
      setInsurancePolicies([]);
    }
  }, [initialData, form]);

  const handleSubmit = async (values: CompanyFormData) => {
    try {
      // Include licenses and insurance in the submission
      const dataToSubmit = {
        ...values,
        licenses,
        insurance_policies: insurancePolicies,
      };
      await onSubmit(dataToSubmit as any);
      if (!initialData) {
        form.resetFields();
        setLicenses([]);
        setInsurancePolicies([]);
      }
    } catch (error) {
      // Error handling in parent component
    }
  };

  const validateMessages = {
    required: 'Please enter ${label}.', // eslint-disable-line no-template-curly-in-string
    types: {
      email: 'Please enter a valid email address.',
    },
  };

  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={handleSubmit}
      validateMessages={validateMessages}
      initialValues={{
        name: '',
        address: '',
        city: '',
        state: '',
        zipcode: '',
        phone: '',
        email: '',
        logo: '',
      }}
    >
      <Tabs defaultActiveKey="basic">
        <Tabs.TabPane tab="Basic Information" key="basic">
          <Row gutter={[24, 0]}>
            <Col xs={24}>
              <Form.Item
                name="logo"
                label="Company Logo"
              >
                <LogoUpload disabled={loading} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={[16, 0]}>
            <Col xs={24} md={12}>
              <Form.Item
                name="name"
                label="Company Name"
                rules={[{ required: true }]}
              >
                <Input
                  placeholder="Enter company name"
                  disabled={loading}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="company_type"
                label="Company Type"
              >
                <Select
                  placeholder="Select company type"
                  disabled={loading}
                  allowClear
                >
                  {(Object.entries(COMPANY_TYPE_LABELS) as [CompanyType, string][]).map(([value, label]) => (
                    <Select.Option key={value} value={value}>
                      {label}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={[16, 0]}>
            <Col xs={24} md={12}>
              <Form.Item
                name="phone"
                label="Phone Number"
              >
                <Input
                  placeholder="Enter phone number"
                  disabled={loading}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={[16, 0]}>
            <Col xs={24} md={12}>
              <Form.Item
                name="email"
                label="Email"
                rules={[{ type: 'email' }]}
              >
                <Input
                  placeholder="Enter email address"
                  disabled={loading}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="zipcode"
                label="Zip Code"
              >
                <Input
                  placeholder="Enter zip code"
                  disabled={loading}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={[16, 0]}>
            <Col xs={24}>
              <Form.Item
                name="address"
                label="Address"
                rules={[{ required: true }]}
              >
                <AddressAutocomplete
                  placeholder="Enter address"
                  disabled={loading}
                  onSelect={(addr) => form.setFieldsValue({
                    city: addr.city,
                    state: addr.state,
                    zipcode: addr.zip,
                  })}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={[16, 0]}>
            <Col xs={24} md={12}>
              <Form.Item
                name="city"
                label="City"
                rules={[{ required: true }]}
              >
                <Input
                  placeholder="Enter city"
                  disabled={loading}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="state"
                label="State"
                rules={[{ required: true }]}
              >
                <Input
                  placeholder="Enter state"
                  disabled={loading}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={[16, 0]}>
            <Col xs={24} md={12}>
              <Form.Item
                name="payment_method_id"
                label="Payment Method"
              >
                <Select
                  placeholder="Select payment method"
                  disabled={loading}
                  allowClear
                  showSearch
                  optionFilterProp="children"
                >
                  {paymentMethods.map(method => (
                    <Select.Option key={method.id} value={method.id}>
                      {method.name}
                      {method.description && (
                        <span style={{ color: '#888', fontSize: '12px', marginLeft: '8px' }}>
                          ({method.description})
                        </span>
                      )}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="payment_frequency_id"
                label="Payment Frequency"
              >
                <Select
                  placeholder="Select payment frequency"
                  disabled={loading}
                  allowClear
                  showSearch
                  optionFilterProp="children"
                >
                  {paymentFrequencies.map(freq => (
                    <Select.Option key={freq.id} value={freq.id}>
                      {freq.name}
                      {freq.days_interval && (
                        <span style={{ color: '#888', fontSize: '12px', marginLeft: '8px' }}>
                          (Every {freq.days_interval} days)
                        </span>
                      )}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
        </Tabs.TabPane>

        <Tabs.TabPane tab="Licenses" key="licenses">
          <LicenseManager
            companyId={initialData?.id}
            licenses={licenses}
            onChange={setLicenses}
            disabled={loading}
          />
        </Tabs.TabPane>

        <Tabs.TabPane tab="Insurance" key="insurance">
          <InsuranceManager
            companyId={initialData?.id}
            insurancePolicies={insurancePolicies}
            onChange={setInsurancePolicies}
            disabled={loading}
          />
        </Tabs.TabPane>

        <Tabs.TabPane tab="Documents" key="documents">
          {!initialData?.id ? (
            <Typography.Text type="secondary">
              Save the company first, then you can upload documents.
            </Typography.Text>
          ) : (
            <div>
              <Typography.Title level={5}>Company W-9</Typography.Title>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                Upload your company W-9 form. This will be attached when sending water mitigation documents to insurance adjusters.
              </Typography.Text>

              {w9Info.has_w9 ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 16px', background: '#f6ffed',
                  border: '1px solid #b7eb8f', borderRadius: 6,
                }}>
                  <CheckCircleFilled style={{ color: '#52c41a', fontSize: 20 }} />
                  <FilePdfOutlined style={{ color: '#ff4d4f', fontSize: 18 }} />
                  <div style={{ flex: 1 }}>
                    <Typography.Text strong>{w9Info.filename || 'W-9 Document'}</Typography.Text>
                    {w9Info.uploaded_at && (
                      <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                        Uploaded: {new Date(w9Info.uploaded_at).toLocaleDateString()}
                      </Typography.Text>
                    )}
                  </div>
                  <Button
                    danger size="small" icon={<DeleteOutlined />}
                    onClick={async () => {
                      try {
                        await companyService.deleteW9(initialData.id);
                        setW9Info({ has_w9: false, filename: null, uploaded_at: null });
                        message.success('W-9 removed');
                      } catch {
                        message.error('Failed to remove W-9');
                      }
                    }}
                  >
                    Remove
                  </Button>
                </div>
              ) : (
                <Upload
                  accept=".pdf,.jpg,.jpeg,.png,.tiff"
                  showUploadList={false}
                  beforeUpload={async (file) => {
                    if (file.size > 10 * 1024 * 1024) {
                      message.error('File must be less than 10MB');
                      return false;
                    }
                    setW9Uploading(true);
                    try {
                      const result = await companyService.uploadW9(initialData!.id, file);
                      setW9Info({
                        has_w9: true,
                        filename: result.filename || file.name,
                        uploaded_at: new Date().toISOString(),
                      });
                      message.success('W-9 uploaded successfully');
                    } catch {
                      message.error('Failed to upload W-9');
                    } finally {
                      setW9Uploading(false);
                    }
                    return false;
                  }}
                >
                  <Button
                    icon={<UploadOutlined />}
                    loading={w9Uploading}
                    type="dashed"
                    style={{ width: 300 }}
                  >
                    Upload W-9 (PDF or Image)
                  </Button>
                </Upload>
              )}
            </div>
          )}
        </Tabs.TabPane>

        <Tabs.TabPane tab="Contracts" key="contracts">
          <ContractTemplateManager
            companyId={initialData?.id}
            disabled={loading}
          />
        </Tabs.TabPane>
      </Tabs>

      <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
        <Col xs={24}>
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button
              onClick={onCancel}
              disabled={loading}
            >
              <CloseOutlined />
              Cancel
            </Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              icon={<SaveOutlined />}
            >
              {initialData ? 'Update' : 'Register'}
            </Button>
          </Space>
        </Col>
      </Row>
    </Form>
  );
};

export default CompanyForm;