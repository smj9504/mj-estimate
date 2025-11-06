/**
 * Water Mitigation Job Creation/Edit Form Modal
 */

import React, { useEffect } from 'react';
import { Modal, Form, Input, DatePicker, Switch, Select, message } from 'antd';
import dayjs from 'dayjs';
import type { WaterMitigationJob, JobCreateRequest } from '../../types/waterMitigation';
import { JOB_STATUS_OPTIONS } from '../../types/waterMitigation';
import waterMitigationService from '../../services/waterMitigationService';

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
  const isEditing = !!job;

  // Reset form when modal opens with job data
  useEffect(() => {
    if (visible) {
      if (job) {
        // Edit mode - populate form with job data
        form.setFieldsValue({
          property_address: job.property_address,
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

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      // Convert dates to ISO strings
      const payload: JobCreateRequest = {
        ...values,
        date_of_loss: values.date_of_loss ? values.date_of_loss.toISOString() : null,
        mitigation_start_date: values.mitigation_start_date ? values.mitigation_start_date.toISOString() : null,
        mitigation_end_date: values.mitigation_end_date ? values.mitigation_end_date.toISOString() : null,
        inspection_date: values.inspection_date ? values.inspection_date.toISOString() : null,
        documents_sent_date: values.documents_sent_date ? values.documents_sent_date.toISOString() : null,
        check_date: values.check_date ? values.check_date.toISOString() : null,
      };

      if (isEditing) {
        await waterMitigationService.updateJob(job.id, payload);
        message.success('Job updated successfully');
      } else {
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

  return (
    <Modal
      title={isEditing ? 'Edit Job' : 'Create New Job'}
      open={visible}
      onCancel={onCancel}
      onOk={handleSubmit}
      confirmLoading={loading}
      width={800}
      destroyOnClose
    >
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
          <TextArea rows={2} placeholder="123 Main St, City, State ZIP" />
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
    </Modal>
  );
};

export default JobFormModal;
