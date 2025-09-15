import React, { useState, useCallback } from 'react';
import {
  Card,
  Row,
  Col,
  Input,
  Select,
  DatePicker,
  Button,
  Space,
  Form,
  Divider,
} from 'antd';
import {
  SearchOutlined,
  FilterOutlined,
  ClearOutlined,
} from '@ant-design/icons';
import { Company, DocumentType, WorkOrder } from '../../types';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;
const { Option } = Select;

// Status options
const statusOptions = [
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Pending Approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

// Document type options
const documentTypeOptions = [
  { value: 'estimate', label: 'Estimate' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'insurance_estimate', label: 'Insurance Estimate' },
  { value: 'plumber_report', label: 'Plumber Report' },
];

interface WorkOrderFiltersProps {
  filters: {
    search?: string;
    status?: WorkOrder['status'];
    company_id?: string;
    document_type?: DocumentType;
    date_from?: string;
    date_to?: string;
  };
  onFilterChange: (filters: any) => void;
  companies: Company[];
}

const WorkOrderFilters: React.FC<WorkOrderFiltersProps> = ({
  filters,
  onFilterChange,
  companies,
}) => {
  const [form] = Form.useForm();
  const [isExpanded, setIsExpanded] = useState(false);

  // Handle search input
  const handleSearch = useCallback((value: string) => {
    onFilterChange({ search: value || undefined });
  }, [onFilterChange]);

  // Handle filter form submission
  const handleFilterSubmit = useCallback((values: any) => {
    const filterValues: any = {};
    
    // Convert form values to filter format
    if (values.search) filterValues.search = values.search;
    if (values.status) filterValues.status = values.status;
    if (values.company_id) filterValues.company_id = values.company_id;
    if (values.document_type) filterValues.document_type = values.document_type;
    
    // Handle date range
    if (values.dateRange && values.dateRange[0] && values.dateRange[1]) {
      filterValues.date_from = values.dateRange[0].format('YYYY-MM-DD');
      filterValues.date_to = values.dateRange[1].format('YYYY-MM-DD');
    }
    
    onFilterChange(filterValues);
  }, [onFilterChange]);

  // Handle filter clear
  const handleClearFilters = useCallback(() => {
    form.resetFields();
    onFilterChange({});
    setIsExpanded(false);
  }, [form, onFilterChange]);

  // Check if any filters are applied
  const hasActiveFilters = useCallback(() => {
    return !!(
      filters.search ||
      filters.status ||
      filters.company_id ||
      filters.document_type ||
      filters.date_from ||
      filters.date_to
    );
  }, [filters]);

  // Initialize form values from current filters
  const getInitialValues = useCallback(() => {
    const values: any = {};
    
    if (filters.search) values.search = filters.search;
    if (filters.status) values.status = filters.status;
    if (filters.company_id) values.company_id = filters.company_id;
    if (filters.document_type) values.document_type = filters.document_type;
    
    if (filters.date_from && filters.date_to) {
      values.dateRange = [
        dayjs(filters.date_from),
        dayjs(filters.date_to),
      ];
    }
    
    return values;
  }, [filters]);

  return (
    <Card>
      <Form
        form={form}
        layout="vertical"
        onFinish={handleFilterSubmit}
        initialValues={getInitialValues()}
      >
        <Row gutter={16} align="middle">
          {/* Quick Search */}
          <Col xs={24} sm={12} md={8} lg={6}>
            <Form.Item name="search" style={{ marginBottom: 0 }}>
              <Input
                placeholder="Search by work order number or address..."
                prefix={<SearchOutlined />}
                allowClear
                onChange={(e) => {
                  // Debounced search
                  const value = e.target.value;
                  setTimeout(() => {
                    if (form.getFieldValue('search') === value) {
                      handleSearch(value);
                    }
                  }, 500);
                }}
              />
            </Form.Item>
          </Col>

          {/* Quick Status Filter */}
          <Col xs={24} sm={12} md={8} lg={6}>
            <Form.Item name="status" style={{ marginBottom: 0 }}>
              <Select
                placeholder="Select status"
                allowClear
                onChange={(value) => {
                  onFilterChange({ ...filters, status: value || undefined });
                }}
              >
                {statusOptions.map(option => (
                  <Option key={option.value} value={option.value}>
                    {option.label}
                  </Option>
                ))}
              </Select>
            </Form.Item>
          </Col>

          {/* Advanced Filters Toggle */}
          <Col flex="auto" style={{ textAlign: 'right' }}>
            <Space>
              {hasActiveFilters() && (
                <Button
                  icon={<ClearOutlined />}
                  onClick={handleClearFilters}
                  title="Clear Filters"
                >
                  Reset
                </Button>
              )}
              <Button
                type={isExpanded ? 'primary' : 'default'}
                icon={<FilterOutlined />}
                onClick={() => setIsExpanded(!isExpanded)}
              >
                {isExpanded ? 'Hide' : 'Show'} Advanced Filters
              </Button>
            </Space>
          </Col>
        </Row>

        {/* Advanced Filters */}
        {isExpanded && (
          <>
            <Divider style={{ margin: '16px 0' }} />
            
            <Row gutter={16}>
              {/* Company Filter */}
              <Col xs={24} sm={12} md={8} lg={6}>
                <Form.Item label="Company" name="company_id">
                  <Select
                    placeholder="Select company"
                    allowClear
                    showSearch
                    optionFilterProp="children"
                    filterOption={(input, option) =>
                      (option?.children?.toString() || '').toLowerCase().indexOf(input.toLowerCase()) >= 0
                    }
                  >
                    {companies.map(company => (
                      <Option key={company.id} value={company.id}>
                        {company.name}
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>

              {/* Document Type Filter */}
              <Col xs={24} sm={12} md={8} lg={6}>
                <Form.Item label="Document Type" name="document_type">
                  <Select placeholder="Select document type" allowClear>
                    {documentTypeOptions.map(option => (
                      <Option key={option.value} value={option.value}>
                        {option.label}
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>

              {/* Date Range Filter */}
              <Col xs={24} sm={12} md={8} lg={8}>
                <Form.Item label="Date Range" name="dateRange">
                  <RangePicker
                    format="YYYY-MM-DD"
                    placeholder={['Start date', 'End date']}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>

              {/* Apply Filters Button */}
              <Col xs={24} sm={12} md={8} lg={4}>
                <Form.Item label=" " style={{ marginBottom: 0 }}>
                  <Space style={{ width: '100%' }}>
                    <Button type="primary" htmlType="submit" block>
                      Apply Filters
                    </Button>
                  </Space>
                </Form.Item>
              </Col>
            </Row>
          </>
        )}
      </Form>

      {/* Active Filters Display */}
      {hasActiveFilters() && (
        <>
          <Divider style={{ margin: '12px 0' }} />
          <div style={{ fontSize: '12px', color: '#666' }}>
            <Space wrap>
              <span>Applied Filters:</span>
              {filters.search && (
                <span style={{ color: '#1890ff' }}>
                  Search: "{filters.search}"
                </span>
              )}
              {filters.status && (
                <span style={{ color: '#1890ff' }}>
                  Status: {statusOptions.find(s => s.value === filters.status)?.label}
                </span>
              )}
              {filters.company_id && (
                <span style={{ color: '#1890ff' }}>
                  Company: {companies.find(c => c.id === filters.company_id)?.name}
                </span>
              )}
              {filters.document_type && (
                <span style={{ color: '#1890ff' }}>
                  Document Type: {documentTypeOptions.find(d => d.value === filters.document_type)?.label}
                </span>
              )}
              {filters.date_from && filters.date_to && (
                <span style={{ color: '#1890ff' }}>
                  Period: {filters.date_from} ~ {filters.date_to}
                </span>
              )}
            </Space>
          </div>
        </>
      )}
    </Card>
  );
};

export default WorkOrderFilters;