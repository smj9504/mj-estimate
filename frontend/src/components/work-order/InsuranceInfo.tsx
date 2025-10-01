import React from 'react';
import { Form, Input, DatePicker, Card, Row, Col, Collapse } from 'antd';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

interface InsuranceInfoProps {
  disabled?: boolean;
}

const InsuranceInfo: React.FC<InsuranceInfoProps> = ({ disabled = false }) => {
  return (
    <Collapse
      style={{ marginBottom: 16 }}
      items={[
        {
          key: '1',
          label: (
            <span>
              <SafetyCertificateOutlined style={{ marginRight: 8 }} />
              Insurance Information (Optional)
            </span>
          ),
          children: (
            <div>
              <Row gutter={24}>
                {/* Left Column - Insurance Policy Information */}
                <Col xs={24} md={12}>
                  <Form.Item
                    label="Claim Number"
                    name="insurance_claim_number"
                  >
                    <Input
                      placeholder="Enter claim number"
                      disabled={disabled}
                      size="large"
                    />
                  </Form.Item>
                  <Form.Item
                    label="Policy Number"
                    name="insurance_policy_number"
                  >
                    <Input
                      placeholder="Enter policy number"
                      disabled={disabled}
                      size="large"
                    />
                  </Form.Item>
                  <Form.Item
                    label="Insurance Company"
                    name="insurance_company"
                  >
                    <Input
                      placeholder="Enter insurance company name"
                      disabled={disabled}
                      size="large"
                    />
                  </Form.Item>
                  <Row gutter={16}>
                    <Col xs={12}>
                      <Form.Item
                        label="Deductible"
                        name="insurance_deductible"
                      >
                        <Input
                          placeholder="Amount"
                          disabled={disabled}
                          prefix="$"
                          size="large"
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={12}>
                      <Form.Item
                        label="Date of Loss"
                        name="insurance_date_of_loss"
                        getValueProps={(value) => ({
                          value: value ? dayjs(value) : undefined,
                        })}
                        normalize={(value) => {
                          return value ? value.toISOString() : undefined;
                        }}
                      >
                        <DatePicker
                          style={{ width: '100%' }}
                          placeholder="Select date"
                          disabled={disabled}
                          format="YYYY-MM-DD"
                          size="large"
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </Col>

                {/* Right Column - Adjuster Information */}
                <Col xs={24} md={12}>
                  <Card
                    title="Adjuster Information"
                    type="inner"
                    size="small"
                  >
                    <Form.Item
                      label="Adjuster Name"
                      name="insurance_adjuster_name"
                    >
                      <Input
                        placeholder="Enter adjuster name"
                        disabled={disabled}
                        size="large"
                      />
                    </Form.Item>
                    <Form.Item
                      label="Adjuster Email"
                      name="insurance_adjuster_email"
                      rules={[
                        {
                          type: 'email',
                          message: 'Please enter a valid email address',
                        }
                      ]}
                    >
                      <Input
                        placeholder="Enter adjuster email"
                        disabled={disabled}
                        size="large"
                      />
                    </Form.Item>
                    <Form.Item
                      label="Adjuster Phone"
                      name="insurance_adjuster_phone"
                    >
                      <Input
                        placeholder="Enter adjuster phone number"
                        disabled={disabled}
                        size="large"
                      />
                    </Form.Item>
                  </Card>
                </Col>
              </Row>
            </div>
          ),
        },
      ]}
    />
  );
};

export default InsuranceInfo;