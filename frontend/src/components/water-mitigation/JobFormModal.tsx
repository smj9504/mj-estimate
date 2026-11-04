/**
 * Water Mitigation Job Creation/Edit Form Modal
 */

import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal, Form, Input, DatePicker, Switch, Select, Button, Space, Row, Col, message } from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import AddressAutocomplete from '../common/AddressAutocomplete';
import AdditionalAdjustersFields from '../common/AdditionalAdjustersFields';
import SameCustomerLeads from './SameCustomerLeads';
import type { WaterMitigationJob, JobCreateRequest, SameCustomerLead } from '../../types/waterMitigation';
import { JOB_STATUS_OPTIONS } from '../../types/waterMitigation';
import waterMitigationService from '../../services/waterMitigationService';
import { companyService } from '../../services/companyService';
import type { Company } from '../../types';

const { TextArea } = Input;
const { Option } = Select;

interface JobFormModalProps {
  visible: boolean;
  onCancel: () => void;
  onSuccess: () => void;
  job?: WaterMitigationJob; // If editing existing job
}

const JobFormModal: React.FC<JobFormModalProps> = ({
  visible,
  onCancel,
  onSuccess,
  job
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = React.useState(false);
  const [companies, setCompanies] = React.useState<Company[]>([]);
  const [loadingCompanies, setLoadingCompanies] = React.useState(false);
  // Leads already here for this customer, found when the new job was about to be made
  const [leads, setLeads] = React.useState<SameCustomerLead[] | null>(null);
  const [pendingPayload, setPendingPayload] = React.useState<JobCreateRequest | null>(null);
  const [usingId, setUsingId] = React.useState<string>();
  const navigate = useNavigate();
  const isEditing = !!job;
  const choosing = !!leads?.length && !!pendingPayload;

  // Load companies when modal opens
  useEffect(() => {
    if (visible) {
      loadCompanies();
    }
  }, [visible]);

  // Reset form when modal opens with job data
  useEffect(() => {
    if (visible) {
      setLeads(null);
      setPendingPayload(null);
      setUsingId(undefined);
      if (job) {
        // Edit mode - populate form with job data
        form.setFieldsValue({
          company_id: job.company_id,
          // The input shows the street only; city/state/zip have their own
          // fields. Older jobs have no property_street, so fall back to the
          // full address rather than showing an empty box.
          property_address: job.property_street || job.property_address,
          property_city: job.property_city,
          property_state: job.property_state,
          property_zipcode: job.property_zipcode,
          companycam_project_id: job.companycam_project_id,
          homeowner_name: job.homeowner_name,
          homeowner_phone: job.homeowner_phone,
          homeowner_email: job.homeowner_email,
          insurance_company: job.insurance_company,
          insurance_policy_number: job.insurance_policy_number,
          claim_number: job.claim_number,
          date_of_loss: job.date_of_loss ? dayjs(job.date_of_loss) : null,
          mitigation_period: job.mitigation_period,
          mitigation_start_date: job.mitigation_start_date ? dayjs(job.mitigation_start_date) : null,
          mitigation_end_date: job.mitigation_end_date ? dayjs(job.mitigation_end_date) : null,
          adjuster_name: job.adjuster_name,
          adjuster_phone: job.adjuster_phone,
          adjuster_email: job.adjuster_email,
          additional_adjusters: job.additional_adjusters || [],
          adjuster_emails: job.adjuster_emails || [],
          inspection_date: job.inspection_date ? dayjs(job.inspection_date) : null,
          inspection_time: job.inspection_time,
          plumbers_report: job.plumbers_report,
          mitigation_flag: job.mitigation_flag,
          documents_sent_date: job.documents_sent_date ? dayjs(job.documents_sent_date) : null,
          invoice_number: job.invoice_number,
          invoice_amount: job.invoice_amount,
          check_number: job.check_number,
          check_date: job.check_date ? dayjs(job.check_date) : null,
          check_amount: job.check_amount,
          active: job.active,
          status: job.status
        });
      } else {
        // Create mode - reset form
        form.resetFields();
        form.setFieldsValue({
          active: true,
          status: 'Lead',
          mitigation_flag: false
        });
      }
    }
  }, [visible, job, form]);

  const loadCompanies = async () => {
    try {
      setLoadingCompanies(true);
      const companiesData = await companyService.getCompanies();
      setCompanies(companiesData);
    } catch (error) {
      console.error('Failed to load companies:', error);
      message.error('Failed to load companies');
    } finally {
      setLoadingCompanies(false);
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      // The address input holds the street only (AddressAutocomplete moves
      // city/state/zip into their own fields). Send it as property_street and
      // let the backend compose/keep property_address - it owns that format
      // and re-derives any component the form left blank.
      const street = (values.property_address || '').trim();

      // These are calendar days, so send the day picked rather than its UTC instant
      const payload: JobCreateRequest = {
        ...values,
        property_street: street || undefined,
        date_of_loss: values.date_of_loss ? values.date_of_loss.format('YYYY-MM-DD') : null,
        mitigation_start_date: values.mitigation_start_date ? values.mitigation_start_date.format('YYYY-MM-DD') : null,
        mitigation_end_date: values.mitigation_end_date ? values.mitigation_end_date.format('YYYY-MM-DD') : null,
        inspection_date: values.inspection_date ? values.inspection_date.format('YYYY-MM-DD') : null,
        documents_sent_date: values.documents_sent_date ? values.documents_sent_date.format('YYYY-MM-DD') : null,
        check_date: values.check_date ? values.check_date.format('YYYY-MM-DD') : null,
      };

      if (isEditing) {
        await waterMitigationService.updateJob(job.id, payload);
        message.success('Job updated successfully');
      } else {
        // A Lead already here for this customer is offered before a second job is made.
        // If the lookup fails, the job is made as it always was.
        const found = await waterMitigationService.findSameCustomerLeads(payload).catch(error => {
          console.warn('Could not look for a Lead already here:', error);
          return [] as SameCustomerLead[];
        });
        if (found.length) {
          setPendingPayload(payload);
          setLeads(found);
          return;
        }
        await waterMitigationService.createJob(payload);
        message.success('Job created successfully');
      }

      onSuccess();
      form.resetFields();
    } catch (error: any) {
      if (error.errorFields) {
        message.error('Please fill in required fields');
      } else {
        message.error(isEditing ? 'Failed to update job' : 'Failed to create job');
        console.error('Submit error:', error);
      }
    } finally {
      setLoading(false);
    }
  };

  const backToForm = () => {
    setLeads(null);
    setPendingPayload(null);
  };

  const createAnyway = async () => {
    if (!pendingPayload) return;
    setLoading(true);
    try {
      await waterMitigationService.createJob(pendingPayload);
      message.success('Job created successfully');
      onSuccess();
      form.resetFields();
    } catch (error) {
      message.error('Failed to create job');
      console.error('Create error:', error);
    } finally {
      setLoading(false);
    }
  };

  const pickLead = async (lead: SameCustomerLead) => {
    if (!pendingPayload) return;
    setUsingId(lead.id);
    try {
      await waterMitigationService.fillInJob(lead.id, pendingPayload);
      message.success('Added to the Lead already here');
      onSuccess();
      form.resetFields();
      navigate(`/water-mitigation/${lead.id}`);
    } catch (error) {
      message.error('Failed to update that job');
      console.error('Fill-in error:', error);
    } finally {
      setUsingId(undefined);
    }
  };

  return (
    <Modal
      title={isEditing ? 'Edit Job' : choosing ? 'This customer may already have a Lead' : 'Create New Job'}
      open={visible}
      onCancel={onCancel}
      onOk={handleSubmit}
      confirmLoading={loading}
      width={800}
      destroyOnHidden
      footer={choosing ? [
        <Button key="back" onClick={backToForm} disabled={loading || !!usingId}>Back</Button>,
        <Button key="create" onClick={createAnyway} loading={loading} disabled={!!usingId}>
          Create new job anyway
        </Button>,
      ] : undefined}
    >
      {choosing && leads && (
        <SameCustomerLeads leads={leads} usingId={usingId} disabled={loading || !!usingId} onUse={pickLead} />
      )}
      {/* Kept mounted while choosing, so Back returns to what was typed */}
      <div hidden={choosing}>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          active: true,
          status: 'Lead',
          mitigation_flag: false
        }}
      >
        {/* Property Information */}
        <Form.Item
          label="Property Address"
          name="property_address"
          rules={[{ required: true, message: 'Please enter property address' }]}
        >
          <AddressAutocomplete
            placeholder="123 Main St"
            onSelect={(addr) => form.setFieldsValue({
              property_city: addr.city,
              property_state: addr.state,
              property_zipcode: addr.zip,
            })}
          />
        </Form.Item>

        <Row gutter={16}>
          <Col xs={24} sm={10}>
            <Form.Item label="City" name="property_city">
              <Input placeholder="Clifton" />
            </Form.Item>
          </Col>
          <Col xs={12} sm={7}>
            <Form.Item label="State" name="property_state">
              <Input placeholder="VA" maxLength={2} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={7}>
            <Form.Item label="Zip Code" name="property_zipcode">
              <Input placeholder="20124" />
            </Form.Item>
          </Col>
        </Row>

        {/* Company Assignment */}
        <Form.Item
          label="Assigned Company"
          name="company_id"
          tooltip="Optional: Assign this job to a company"
        >
          <Select
            placeholder="Select a company (optional)"
            allowClear
            loading={loadingCompanies}
            showSearch
            filterOption={(input, option) => {
              const label = String(option?.label || '');
              return label.toLowerCase().includes(input.toLowerCase());
            }}
          >
            {companies.map(company => (
              <Option key={company.id} value={company.id} label={`${company.name} ${company.company_code ? `(${company.company_code})` : ''}`}>
                {company.name} {company.company_code ? `(${company.company_code})` : ''}
              </Option>
            ))}
          </Select>
        </Form.Item>

        {/* CompanyCam Integration */}
        <Form.Item
          label="CompanyCam Project ID"
          name="companycam_project_id"
          tooltip="Optional: Link this job to a CompanyCam project for automatic photo sync"
        >
          <Input placeholder="Enter CompanyCam Project ID (e.g., 2695397918)" />
        </Form.Item>

        {/* Homeowner Information */}
        <h4 style={{ marginTop: 16, marginBottom: 8 }}>Homeowner Information</h4>
        <Form.Item
          label="Homeowner Name"
          name="homeowner_name"
        >
          <Input placeholder="John Doe" />
        </Form.Item>

        <Form.Item
          label="Phone"
          name="homeowner_phone"
        >
          <Input placeholder="555-0123" />
        </Form.Item>

        <Form.Item
          label="Email"
          name="homeowner_email"
          rules={[{ type: 'email', message: 'Please enter a valid email' }]}
        >
          <Input placeholder="john.doe@example.com" />
        </Form.Item>

        {/* Insurance Information */}
        <h4 style={{ marginTop: 16, marginBottom: 8 }}>Insurance Information</h4>
        <Form.Item
          label="Insurance Company"
          name="insurance_company"
        >
          <Input placeholder="ABC Insurance Co." />
        </Form.Item>

        <Form.Item
          label="Policy Number"
          name="insurance_policy_number"
        >
          <Input placeholder="POL-123456" />
        </Form.Item>

        <Form.Item
          label="Claim Number"
          name="claim_number"
        >
          <Input placeholder="CLAIM-2025-001" />
        </Form.Item>

        <Form.Item
          label="Date of Loss"
          name="date_of_loss"
        >
          <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
        </Form.Item>

        {/* Mitigation Information */}
        <h4 style={{ marginTop: 16, marginBottom: 8 }}>Mitigation Information</h4>
        <Form.Item
          label="Mitigation Period"
          name="mitigation_period"
        >
          <Input placeholder="3 days" />
        </Form.Item>

        <Form.Item
          label="Start Date"
          name="mitigation_start_date"
        >
          <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
        </Form.Item>

        <Form.Item
          label="End Date"
          name="mitigation_end_date"
        >
          <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
        </Form.Item>

        <Form.Item
          label="Mitigation Flag"
          name="mitigation_flag"
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>

        {/* Adjuster Information */}
        <h4 style={{ marginTop: 16, marginBottom: 8 }}>Adjuster Information</h4>
        <Form.Item
          label="Adjuster Name"
          name="adjuster_name"
        >
          <Input placeholder="Jane Smith" />
        </Form.Item>

        <Form.Item
          label="Adjuster Phone"
          name="adjuster_phone"
        >
          <Input placeholder="555-0456" />
        </Form.Item>

        <Form.Item
          label="Adjuster Email"
          name="adjuster_email"
          rules={[{ type: 'email', message: 'Please enter a valid email' }]}
        >
          <Input placeholder="jane.smith@insurance.com" />
        </Form.Item>

        {/* Adjusters 2 and 3, e.g. a third-party firm the carrier handed it to */}
        <AdditionalAdjustersFields />

        {/* Other people emailed with the adjusters, e.g. the carrier's claims inbox */}
        <Form.List name="adjuster_emails">
          {(fields, { add, remove }) => (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: '#666' }}>Other Email Contacts</span>
                <Button
                  type="dashed"
                  size="small"
                  onClick={() => add({ name: '', email: '', role: 'adjuster' })}
                  icon={<PlusOutlined />}
                >
                  Add
                </Button>
              </div>
              {fields.map(({ key, name, ...restField }) => (
                <Space key={key} style={{ display: 'flex', marginBottom: 4 }} align="baseline">
                  <Form.Item {...restField} name={[name, 'name']} style={{ marginBottom: 4 }}>
                    <Input placeholder="Name" style={{ width: 140 }} />
                  </Form.Item>
                  <Form.Item
                    {...restField}
                    name={[name, 'email']}
                    style={{ marginBottom: 4 }}
                    rules={[{ type: 'email', message: 'Invalid email' }]}
                  >
                    <Input placeholder="email@example.com" style={{ width: 200 }} />
                  </Form.Item>
                  <Form.Item {...restField} name={[name, 'role']} style={{ marginBottom: 4 }}>
                    <Select style={{ width: 120 }} placeholder="Role">
                      <Option value="adjuster">Adjuster</Option>
                      <Option value="insurance">Insurance Co.</Option>
                      <Option value="other">Other</Option>
                    </Select>
                  </Form.Item>
                  <MinusCircleOutlined
                    onClick={() => remove(name)}
                    style={{ color: '#d44c47', cursor: 'pointer' }}
                  />
                </Space>
              ))}
            </>
          )}
        </Form.List>

        {/* Inspection Information */}
        <h4 style={{ marginTop: 16, marginBottom: 8 }}>Inspection Information</h4>
        <Form.Item
          label="Inspection Date"
          name="inspection_date"
        >
          <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
        </Form.Item>

        <Form.Item
          label="Inspection Time"
          name="inspection_time"
        >
          <Input placeholder="10:00 AM" />
        </Form.Item>

        <Form.Item
          label="Plumber's Report"
          name="plumbers_report"
        >
          <Input placeholder="Report reference" />
        </Form.Item>

        {/* Financial/Documents Information */}
        <h4 style={{ marginTop: 16, marginBottom: 8 }}>Financial & Documents</h4>
        <Form.Item
          label="Documents Sent to Adjuster"
          name="documents_sent_date"
          tooltip="Date when Invoice, COS, EWA, and Photo Report were sent"
        >
          <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
        </Form.Item>

        <Form.Item
          label="Invoice Number"
          name="invoice_number"
        >
          <Input placeholder="INV-2025-001" />
        </Form.Item>

        <Form.Item
          label="Invoice Amount"
          name="invoice_amount"
        >
          <Input type="number" prefix="$" placeholder="0.00" />
        </Form.Item>

        <Form.Item
          label="Check Number"
          name="check_number"
        >
          <Input placeholder="CHK-123456" />
        </Form.Item>

        <Form.Item
          label="Check Date"
          name="check_date"
        >
          <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
        </Form.Item>

        <Form.Item
          label="Check Amount"
          name="check_amount"
        >
          <Input type="number" prefix="$" placeholder="0.00" />
        </Form.Item>

        {/* Job Status */}
        <h4 style={{ marginTop: 16, marginBottom: 8 }}>Job Status</h4>
        <Form.Item
          label="Status"
          name="status"
        >
          <Select>
            {JOB_STATUS_OPTIONS.map(option => (
              <Option key={option.value} value={option.value}>
                {option.label}
              </Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          label="Active"
          name="active"
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>
      </Form>
      </div>
    </Modal>
  );
};

export default JobFormModal;
