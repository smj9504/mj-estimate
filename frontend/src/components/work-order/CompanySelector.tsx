import React from 'react';
import { Select, Card, Typography, Row, Col, Tag, Space } from 'antd';
import { BankOutlined } from '@ant-design/icons';
import { Company } from '../../types';

const { Option } = Select;
const { Text } = Typography;

interface CompanySelectorProps {
  companies: Company[];
  selectedCompany: Company | null;
  onCompanySelect: (companyId: string) => void;
  loading?: boolean;
  showCompanyInfo?: boolean;
}

const CompanySelector: React.FC<CompanySelectorProps> = ({
  companies,
  selectedCompany,
  onCompanySelect,
  loading = false,
  showCompanyInfo = true
}) => {
  return (
    <div>
      <Select
        placeholder="Search and select a company..."
        value={selectedCompany?.id}
        onChange={onCompanySelect}
        loading={loading}
        showSearch
        filterOption={(input, option) =>
          option?.children?.toString().toLowerCase().includes(input.toLowerCase()) || false
        }
        style={{ width: '100%' }}
        size="large"
      >
        {companies.map(company => (
          <Option key={company.id} value={company.id}>
            <Space>
              <BankOutlined />
              {company.name}
              {company.company_code && (
                <Tag color="blue" style={{ fontSize: '10px' }}>
                  {company.company_code}
                </Tag>
              )}
            </Space>
          </Option>
        ))}
      </Select>

      {showCompanyInfo && selectedCompany && (
        <Card 
          size="small" 
          style={{ marginTop: 16 }}
          styles={{ body: { padding: '12px 16px' } }}
        >
          <Row gutter={[16, 8]} align="middle">
            <Col xs={24} sm={12} md={8}>
              <Space direction="vertical" size={2}>
                <Text strong style={{ fontSize: '14px' }}>
                  {selectedCompany.name}
                </Text>
                {selectedCompany.company_code && (
                  <Tag color="blue">
                    Code: {selectedCompany.company_code}
                  </Tag>
                )}
              </Space>
            </Col>

            <Col xs={24} sm={12} md={8}>
              <Space direction="vertical" size={2}>
                <Text type="secondary" style={{ fontSize: '12px' }}>
                  Contact Information
                </Text>
                <div>
                  {selectedCompany.phone && (
                    <Text style={{ fontSize: '12px', display: 'block' }}>
                      📞 {selectedCompany.phone}
                    </Text>
                  )}
                  {selectedCompany.email && (
                    <Text style={{ fontSize: '12px', display: 'block' }}>
                      ✉️ {selectedCompany.email}
                    </Text>
                  )}
                </div>
              </Space>
            </Col>

            <Col xs={24} sm={24} md={8}>
              <Space direction="vertical" size={2}>
                <Text type="secondary" style={{ fontSize: '12px' }}>
                  Address
                </Text>
                <Text style={{ fontSize: '12px' }}>
                  {[
                    selectedCompany.address,
                    selectedCompany.city,
                    selectedCompany.state,
                    selectedCompany.zipcode
                  ].filter(Boolean).join(', ')}
                </Text>
              </Space>
            </Col>
          </Row>

        </Card>
      )}
    </div>
  );
};

export default CompanySelector;