import React, { useEffect, useState } from 'react';
import {
  Form,
  Input,
  Button,
  Row,
  Col,
  Space,
  Tabs,
  Select,
} from 'antd';
import { SaveOutlined, CloseOutlined } from '@ant-design/icons';
import { Company, CompanyFormData, PaymentMethod, PaymentFrequency } from '../../types';
import LogoUpload from './LogoUpload';
import LicenseManager from './LicenseManager';
import InsuranceManager from './InsuranceManager';
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
    
    if (initialData) {
      form.setFieldsValue({
        name: initialData.name,
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
                <Input
                  placeholder="Enter address"
                  disabled={loading}
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