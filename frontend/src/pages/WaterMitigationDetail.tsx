/**
 * Water Mitigation Job Detail Page
 * Displays detailed information for a single water mitigation job
 */

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card,
  Descriptions,
  Button,
  Space,
  Tag,
  message,
  Spin,
  Row,
  Col,
  Timeline,
  Tabs,
  Select,
  Modal,
  Input,
  DatePicker,
  InputNumber,
  Tooltip
} from 'antd';
import dayjs from 'dayjs';
import {
  ArrowLeftOutlined,
  EditOutlined,
  SwapOutlined,
  InfoCircleOutlined
} from '@ant-design/icons';
import waterMitigationService from '../services/waterMitigationService';
import { companyService } from '../services/companyService';
import type { WaterMitigationJob, JobStatusHistory, JobStatus } from '../types/waterMitigation';
import type { Company } from '../types';
import { JOB_STATUS_OPTIONS } from '../types/waterMitigation';
import JobFormModal from '../components/water-mitigation/JobFormModal';
import WaterMitigationPhotosTab from '../components/water-mitigation/WaterMitigationPhotosTab';
import WaterMitigationDocumentsTab from '../components/water-mitigation/WaterMitigationDocumentsTab';
import WaterMitigationReportTab from '../components/water-mitigation/WaterMitigationReportTab';
import WaterMitigationTrashTab from '../components/water-mitigation/WaterMitigationTrashTab';
import EditableSection from '../components/water-mitigation/EditableSection';

const WaterMitigationDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [job, setJob] = useState<WaterMitigationJob | null>(null);
  const [statusHistory, setStatusHistory] = useState<JobStatusHistory[]>([]);
  const [isEditMode, setIsEditMode] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<JobStatus | null>(null);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [statusChangeNote, setStatusChangeNote] = useState('');
  const [companies, setCompanies] = useState<Company[]>([]);

  // Edit form states for each section
  const [jobInfoForm, setJobInfoForm] = useState({
    property_address: '',
    homeowner_name: '',
    homeowner_phone: '',
    homeowner_email: '',
    company_id: null as string | null
  });

  const [insuranceForm, setInsuranceForm] = useState({
    insurance_company: '',
    insurance_policy_number: '',
    claim_number: '',
    date_of_loss: null as string | null,
    mitigation_start_date: null as string | null,
    mitigation_end_date: null as string | null
  });

  const [financialForm, setFinancialForm] = useState({
    documents_sent_date: null as string | null,
    invoice_number: '',
    invoice_amount: null as number | null,
    check_number: '',
    check_date: null as string | null,
    check_amount: null as number | null
  });

  // Check if URL contains /edit to determine edit mode
  useEffect(() => {
    const isEdit = window.location.pathname.includes('/edit');
    setIsEditMode(isEdit);
    if (isEdit) {
      setShowEditModal(true);
    }
  }, []);

  // Load companies for selection
  const loadCompanies = async () => {
    try {
      const companiesData = await companyService.getCompanies();
      setCompanies(companiesData);
    } catch (error) {
      console.error('Failed to load companies:', error);
    }
  };

  // Load job data
  const loadJob = async () => {
    if (!id) return;

    try {
      setLoading(true);
      const [jobData, historyData] = await Promise.all([
        waterMitigationService.getJob(id),
        waterMitigationService.getJobStatusHistory(id)
      ]);
      setJob(jobData);
      setStatusHistory(historyData);
    } catch (error) {
      message.error('Failed to load job details');
      console.error('Load job error:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJob();
    loadCompanies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Update form states when job loads
  useEffect(() => {
    if (job) {
      setJobInfoForm({
        property_address: job.property_address || '',
        homeowner_name: job.homeowner_name || '',
        homeowner_phone: job.homeowner_phone || '',
        homeowner_email: job.homeowner_email || '',
        company_id: job.company_id || null
      });

      setInsuranceForm({
        insurance_company: job.insurance_company || '',
        insurance_policy_number: job.insurance_policy_number || '',
        claim_number: job.claim_number || '',
        date_of_loss: job.date_of_loss || null,
        mitigation_start_date: job.mitigation_start_date || null,
        mitigation_end_date: job.mitigation_end_date || null
      });

      setFinancialForm({
        documents_sent_date: job.documents_sent_date || null,
        invoice_number: job.invoice_number || '',
        invoice_amount: job.invoice_amount || null,
        check_number: job.check_number || '',
        check_date: job.check_date || null,
        check_amount: job.check_amount || null
      });
    }
  }, [job]);

  // Handle edit modal close
  const handleEditModalClose = () => {
    setShowEditModal(false);
    if (isEditMode) {
      // Navigate back to detail view without /edit
      navigate(`/water-mitigation/${id}`);
    }
  };

  // Handle edit modal success
  const handleEditModalSuccess = () => {
    setShowEditModal(false);
    loadJob(); // Reload job data
    if (isEditMode) {
      // Navigate back to detail view
      navigate(`/water-mitigation/${id}`);
    }
  };

  // Handle status change
  const handleStatusChange = (newStatus: JobStatus) => {
    setSelectedStatus(newStatus);
    setShowStatusModal(true);
  };

  // Confirm status change
  const confirmStatusChange = async () => {
    if (!id || !selectedStatus) return;

    try {
      await waterMitigationService.updateJobStatus(id, {
        status: selectedStatus,
        notes: statusChangeNote || undefined
      });

      message.success('Status updated successfully');
      setShowStatusModal(false);
      setStatusChangeNote('');
      setSelectedStatus(null);

      // Reload job data and status history
      await loadJob();
    } catch (error) {
      message.error('Failed to update status');
      console.error('Update status error:', error);
    }
  };

  // Cancel status change
  const cancelStatusChange = () => {
    setShowStatusModal(false);
    setSelectedStatus(null);
    setStatusChangeNote('');
  };

  // Handle section save
  const handleSaveJobInfo = async () => {
    if (!id) return;
    const updateData = {
      ...jobInfoForm,
      company_id: jobInfoForm.company_id || undefined
    };
    await waterMitigationService.updateJob(id, updateData);
    await loadJob();
  };

  const handleSaveInsurance = async () => {
    if (!id) return;

    // Validate mitigation dates
    if (insuranceForm.mitigation_start_date && insuranceForm.mitigation_end_date) {
      const startDate = dayjs(insuranceForm.mitigation_start_date);
      const endDate = dayjs(insuranceForm.mitigation_end_date);
      if (endDate.isBefore(startDate)) {
        message.error('Mitigation end date must be after start date');
        return;
      }
    }

    // Convert dates to YYYY-MM-DD format for API
    const formatDateForApi = (dateStr: string | null): string | undefined => {
      if (!dateStr) return undefined;
      return dayjs(dateStr).format('YYYY-MM-DD');
    };

    const updateData = {
      insurance_company: insuranceForm.insurance_company || undefined,
      insurance_policy_number: insuranceForm.insurance_policy_number || undefined,
      claim_number: insuranceForm.claim_number || undefined,
      date_of_loss: formatDateForApi(insuranceForm.date_of_loss),
      mitigation_start_date: formatDateForApi(insuranceForm.mitigation_start_date),
      mitigation_end_date: formatDateForApi(insuranceForm.mitigation_end_date)
    };

    try {
      await waterMitigationService.updateJob(id, updateData);
      message.success('Insurance information updated successfully');
      await loadJob();
    } catch (error) {
      message.error('Failed to update insurance information');
      console.error('Update error:', error);
    }
  };

  const handleSaveFinancial = async () => {
    if (!id) return;

    // Convert dates to YYYY-MM-DD format for API
    const formatDateForApi = (dateStr: string | null): string | undefined => {
      if (!dateStr) return undefined;
      return dayjs(dateStr).format('YYYY-MM-DD');
    };

    const updateData = {
      documents_sent_date: formatDateForApi(financialForm.documents_sent_date),
      invoice_number: financialForm.invoice_number || undefined,
      invoice_amount: financialForm.invoice_amount ?? undefined,
      check_number: financialForm.check_number || undefined,
      check_date: formatDateForApi(financialForm.check_date),
      check_amount: financialForm.check_amount ?? undefined
    };

    try {
      await waterMitigationService.updateJob(id, updateData);
      message.success('Financial information updated successfully');
      await loadJob();
    } catch (error) {
      message.error('Failed to update financial information');
      console.error('Update error:', error);
    }
  };

  // Helper function to format mitigation period display
  const formatMitigationPeriod = (): string => {
    if (!job) return '-';

    const startDate = job.mitigation_start_date;
    const endDate = job.mitigation_end_date;

    if (startDate && endDate) {
      return `${dayjs(startDate).format('YYYY-MM-DD')} to ${dayjs(endDate).format('YYYY-MM-DD')}`;
    } else if (startDate) {
      return `From ${dayjs(startDate).format('YYYY-MM-DD')}`;
    } else if (endDate) {
      return `Until ${dayjs(endDate).format('YYYY-MM-DD')}`;
    }

    return '-';
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '100px' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!job) {
    return (
      <div style={{ textAlign: 'center', padding: '100px' }}>
        <p>Job not found</p>
        <Button onClick={() => navigate('/water-mitigation')}>Back to List</Button>
      </div>
    );
  }

  // Status tag color
  const getStatusColor = (status: JobStatus): string => {
    const colors: Record<JobStatus, string> = {
      'Lead': 'blue',
      'Doc prepping': 'cyan',
      'Sent to adjuster': 'geekblue',
      'Follow up': 'orange',
      'Paperwork received': 'purple',
      'Check received': 'green',
      'Complete': 'success'
    };
    return colors[status] || 'default';
  };

  return (
    <div style={{ padding: '24px' }}>
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        {/* Header */}
        <Card>
          <Space style={{ justifyContent: 'space-between', width: '100%' }}>
            <Space>
              <Button
                icon={<ArrowLeftOutlined />}
                onClick={() => navigate('/water-mitigation')}
              >
                Back
              </Button>
              <h2 style={{ margin: 0 }}>{job.property_address}</h2>
            </Space>
            <Space>
              <Tag color={job.active ? 'success' : 'default'}>
                {job.active ? 'ACTIVE' : 'INACTIVE'}
              </Tag>
              <Select
                value={job.status}
                onChange={handleStatusChange}
                style={{ width: 200 }}
                options={JOB_STATUS_OPTIONS}
                suffixIcon={<SwapOutlined />}
              />
              <Button
                type="primary"
                icon={<EditOutlined />}
                onClick={() => navigate(`/water-mitigation/${id}/edit`)}
              >
                Edit
              </Button>
            </Space>
          </Space>
        </Card>

        {/* Tabs */}
        <Tabs
          defaultActiveKey="details"
          items={[
            {
              key: 'details',
              label: 'Job Details',
              children: (
                <Row gutter={16}>
          {/* Job Details */}
          <Col xs={24} lg={16}>
            <EditableSection
              title="Job Information"
              onSave={handleSaveJobInfo}
              style={{ marginBottom: 16 }}
            >
              {(isEditing) => (
                <Descriptions bordered column={2}>
                  <Descriptions.Item label="Property Address" span={2}>
                    {isEditing ? (
                      <Input.TextArea
                        value={jobInfoForm.property_address}
                        onChange={(e) => setJobInfoForm({ ...jobInfoForm, property_address: e.target.value })}
                        placeholder="Enter property address"
                        maxLength={500}
                        rows={2}
                        autoSize={{ minRows: 2, maxRows: 4 }}
                      />
                    ) : (
                      job.property_address
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="Assigned Company" span={2}>
                    {isEditing ? (
                      <Select
                        value={jobInfoForm.company_id}
                        onChange={(value) => setJobInfoForm({ ...jobInfoForm, company_id: value })}
                        placeholder="Select a company"
                        style={{ width: '100%' }}
                        allowClear
                        showSearch
                        optionFilterProp="children"
                        filterOption={(input, option) =>
                          (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                        }
                        options={companies.map(company => ({
                          value: company.id,
                          label: company.name + (company.company_code ? ` (${company.company_code})` : '')
                        }))}
                      />
                    ) : (
                      job.company ? (
                        <span>
                          {job.company.name}
                          {job.company.company_code && (
                            <Tag color="blue" style={{ marginLeft: 8 }}>
                              {job.company.company_code}
                            </Tag>
                          )}
                        </span>
                      ) : (
                        <span style={{ color: '#999' }}>Not assigned</span>
                      )
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="Homeowner Name">
                    {isEditing ? (
                      <Input
                        value={jobInfoForm.homeowner_name}
                        onChange={(e) => setJobInfoForm({ ...jobInfoForm, homeowner_name: e.target.value })}
                        placeholder="Enter homeowner name"
                        maxLength={255}
                      />
                    ) : (
                      job.homeowner_name || '-'
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="Phone">
                    {isEditing ? (
                      <Input
                        value={jobInfoForm.homeowner_phone}
                        onChange={(e) => setJobInfoForm({ ...jobInfoForm, homeowner_phone: e.target.value })}
                        placeholder="Enter phone number"
                        maxLength={50}
                      />
                    ) : (
                      job.homeowner_phone || '-'
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="Email" span={2}>
                    {isEditing ? (
                      <Input
                        type="email"
                        value={jobInfoForm.homeowner_email}
                        onChange={(e) => setJobInfoForm({ ...jobInfoForm, homeowner_email: e.target.value })}
                        placeholder="Enter email address"
                        maxLength={255}
                      />
                    ) : (
                      job.homeowner_email || '-'
                    )}
                  </Descriptions.Item>
                </Descriptions>
              )}
            </EditableSection>

            <EditableSection
              title="Insurance Information"
              onSave={handleSaveInsurance}
              style={{ marginBottom: 16 }}
            >
              {(isEditing) => (
                <Descriptions bordered column={2}>
                  <Descriptions.Item label="Insurance Company" span={2}>
                    {isEditing ? (
                      <Input
                        value={insuranceForm.insurance_company}
                        onChange={(e) => setInsuranceForm({ ...insuranceForm, insurance_company: e.target.value })}
                        placeholder="Enter insurance company"
                        maxLength={255}
                      />
                    ) : (
                      job.insurance_company || '-'
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="Policy Number">
                    {isEditing ? (
                      <Input
                        value={insuranceForm.insurance_policy_number}
                        onChange={(e) => setInsuranceForm({ ...insuranceForm, insurance_policy_number: e.target.value })}
                        placeholder="Enter policy number"
                        maxLength={100}
                      />
                    ) : (
                      job.insurance_policy_number || '-'
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="Claim Number">
                    {isEditing ? (
                      <Input
                        value={insuranceForm.claim_number}
                        onChange={(e) => setInsuranceForm({ ...insuranceForm, claim_number: e.target.value })}
                        placeholder="Enter claim number"
                        maxLength={100}
                      />
                    ) : (
                      job.claim_number || '-'
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="Date of Loss">
                    {isEditing ? (
                      <DatePicker
                        value={insuranceForm.date_of_loss ? dayjs(insuranceForm.date_of_loss) : undefined}
                        onChange={(date) => setInsuranceForm({ ...insuranceForm, date_of_loss: date ? date.format('YYYY-MM-DD') : null })}
                        format="YYYY-MM-DD"
                        style={{ width: '100%' }}
                        disabledDate={(current) => current && current > dayjs().endOf('day')}
                        placeholder="Select date of loss"
                      />
                    ) : (
                      job.date_of_loss ? dayjs(job.date_of_loss).format('YYYY-MM-DD') : '-'
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item
                    label={
                      <Space>
                        Mitigation Start Date
                        <Tooltip title="Start date of the water mitigation work. Used for photo report and photo date bulk update.">
                          <InfoCircleOutlined style={{ color: '#1890ff' }} />
                        </Tooltip>
                      </Space>
                    }
                  >
                    {isEditing ? (
                      <DatePicker
                        value={insuranceForm.mitigation_start_date ? dayjs(insuranceForm.mitigation_start_date) : undefined}
                        onChange={(date) => setInsuranceForm({ ...insuranceForm, mitigation_start_date: date ? date.format('YYYY-MM-DD') : null })}
                        format="YYYY-MM-DD"
                        style={{ width: '100%' }}
                        placeholder="Select start date"
                      />
                    ) : (
                      job.mitigation_start_date ? dayjs(job.mitigation_start_date).format('YYYY-MM-DD') : '-'
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item
                    label={
                      <Space>
                        Mitigation End Date
                        <Tooltip title="End date of the water mitigation work. Used for photo report and photo date bulk update.">
                          <InfoCircleOutlined style={{ color: '#1890ff' }} />
                        </Tooltip>
                      </Space>
                    }
                  >
                    {isEditing ? (
                      <DatePicker
                        value={insuranceForm.mitigation_end_date ? dayjs(insuranceForm.mitigation_end_date) : undefined}
                        onChange={(date) => setInsuranceForm({ ...insuranceForm, mitigation_end_date: date ? date.format('YYYY-MM-DD') : null })}
                        format="YYYY-MM-DD"
                        style={{ width: '100%' }}
                        placeholder="Select end date"
                        disabledDate={(current) => {
                          if (!insuranceForm.mitigation_start_date) return false;
                          return current && current < dayjs(insuranceForm.mitigation_start_date).startOf('day');
                        }}
                      />
                    ) : (
                      job.mitigation_end_date ? dayjs(job.mitigation_end_date).format('YYYY-MM-DD') : '-'
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="Mitigation Period" span={2}>
                    <Tag color={job.mitigation_start_date && job.mitigation_end_date ? 'green' : 'default'}>
                      {formatMitigationPeriod()}
                    </Tag>
                  </Descriptions.Item>
                </Descriptions>
              )}
            </EditableSection>

            <EditableSection
              title="Financial Information"
              onSave={handleSaveFinancial}
            >
              {(isEditing) => (
                <Descriptions bordered column={2}>
                  <Descriptions.Item label="Documents Sent Date" span={2}>
                    {isEditing ? (
                      <DatePicker
                        value={financialForm.documents_sent_date ? dayjs(financialForm.documents_sent_date) : undefined}
                        onChange={(date) => setFinancialForm({ ...financialForm, documents_sent_date: date ? date.format('YYYY-MM-DD') : null })}
                        format="YYYY-MM-DD"
                        style={{ width: '100%' }}
                      />
                    ) : (
                      job.documents_sent_date ? dayjs(job.documents_sent_date).format('YYYY-MM-DD') : '-'
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="Invoice Number">
                    {isEditing ? (
                      <Input
                        value={financialForm.invoice_number}
                        onChange={(e) => setFinancialForm({ ...financialForm, invoice_number: e.target.value })}
                        placeholder="Enter invoice number"
                        maxLength={100}
                      />
                    ) : (
                      job.invoice_number || '-'
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="Invoice Amount">
                    {isEditing ? (
                      <InputNumber
                        value={financialForm.invoice_amount}
                        onChange={(value) => setFinancialForm({ ...financialForm, invoice_amount: value })}
                        placeholder="Enter invoice amount"
                        prefix="$"
                        precision={2}
                        style={{ width: '100%' }}
                      />
                    ) : (
                      job.invoice_amount ? `$${job.invoice_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="Check Number">
                    {isEditing ? (
                      <Input
                        value={financialForm.check_number}
                        onChange={(e) => setFinancialForm({ ...financialForm, check_number: e.target.value })}
                        placeholder="Enter check number"
                        maxLength={100}
                      />
                    ) : (
                      job.check_number || '-'
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="Check Date">
                    {isEditing ? (
                      <DatePicker
                        value={financialForm.check_date ? dayjs(financialForm.check_date) : undefined}
                        onChange={(date) => setFinancialForm({ ...financialForm, check_date: date ? date.format('YYYY-MM-DD') : null })}
                        format="YYYY-MM-DD"
                        style={{ width: '100%' }}
                      />
                    ) : (
                      job.check_date ? dayjs(job.check_date).format('YYYY-MM-DD') : '-'
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="Check Amount" span={2}>
                    {isEditing ? (
                      <InputNumber
                        value={financialForm.check_amount}
                        onChange={(value) => setFinancialForm({ ...financialForm, check_amount: value })}
                        placeholder="Enter check amount"
                        prefix="$"
                        precision={2}
                        style={{ width: '100%' }}
                      />
                    ) : (
                      job.check_amount ? `$${job.check_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'
                    )}
                  </Descriptions.Item>
                </Descriptions>
              )}
            </EditableSection>

            {job.notes && (
              <Card title="Notes" style={{ marginTop: 16 }}>
                <p style={{ whiteSpace: 'pre-wrap' }}>{job.notes}</p>
              </Card>
            )}
          </Col>

          {/* Status History */}
          <Col xs={24} lg={8}>
            <Card title="Status History">
              <Timeline>
                {statusHistory.map((history) => (
                  <Timeline.Item
                    key={history.id}
                    color={getStatusColor(history.new_status as JobStatus)}
                  >
                    <p style={{ margin: 0, fontWeight: 'bold' }}>
                      {history.new_status}
                    </p>
                    <p style={{ margin: 0, fontSize: '12px', color: '#999' }}>
                      {new Date(history.changed_at).toLocaleString()}
                    </p>
                    {history.notes && (
                      <p style={{ margin: '4px 0 0', fontSize: '13px' }}>
                        {history.notes}
                      </p>
                    )}
                  </Timeline.Item>
                ))}
              </Timeline>
            </Card>

            <Card title="Integration Info" style={{ marginTop: 16 }}>
              <Descriptions bordered column={1} size="small">
                <Descriptions.Item label="Photos">
                  {job.photo_count || 0}
                </Descriptions.Item>
                <Descriptions.Item label="CompanyCam Project">
                  {job.companycam_project_id || '-'}
                </Descriptions.Item>
                <Descriptions.Item label="Google Sheet Row">
                  {job.google_sheet_row_number || '-'}
                </Descriptions.Item>
                <Descriptions.Item label="Last CompanyCam Sync">
                  {job.companycam_last_sync
                    ? new Date(job.companycam_last_sync).toLocaleString()
                    : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="Last Sheets Sync">
                  {job.sheets_last_sync
                    ? new Date(job.sheets_last_sync).toLocaleString()
                    : '-'}
                </Descriptions.Item>
              </Descriptions>
            </Card>
          </Col>
        </Row>
              )
            },
            {
              key: 'photos',
              label: `Photos (${job.photo_count || 0})`,
              children: id ? (
                <WaterMitigationPhotosTab
                  jobId={id}
                  clientId={job.client_id}
                  companycamProjectId={job.companycam_project_id}
                />
              ) : null
            },
            {
              key: 'documents',
              label: 'Documents',
              children: id ? (
                <WaterMitigationDocumentsTab
                  jobId={id}
                  jobAddress={job.property_address || 'Unknown Address'}
                  dateOfLoss={job.date_of_loss}
                />
              ) : null
            },
            {
              key: 'report',
              label: 'Report',
              children: id ? (
                <WaterMitigationReportTab
                  jobId={id}
                  jobAddress={job.property_address || 'Unknown Address'}
                  dateOfLoss={job.date_of_loss}
                  mitigationStartDate={job.mitigation_start_date}
                  mitigationEndDate={job.mitigation_end_date}
                />
              ) : null
            },
            {
              key: 'trash',
              label: 'Trash',
              children: id ? <WaterMitigationTrashTab jobId={id} /> : null
            }
          ]}
        />
      </Space>

      {/* Edit Modal */}
      <JobFormModal
        visible={showEditModal}
        onCancel={handleEditModalClose}
        onSuccess={handleEditModalSuccess}
        job={job || undefined}
      />

      {/* Status Change Confirmation Modal */}
      <Modal
        title="Confirm Status Change"
        open={showStatusModal}
        onOk={confirmStatusChange}
        onCancel={cancelStatusChange}
        okText="Confirm"
        cancelText="Cancel"
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <p>
            Are you sure you want to change the status from{' '}
            <Tag color={getStatusColor(job.status)}>{job.status}</Tag> to{' '}
            <Tag color={selectedStatus ? getStatusColor(selectedStatus) : 'default'}>
              {selectedStatus}
            </Tag>?
          </p>
          <div>
            <label style={{ display: 'block', marginBottom: '8px' }}>
              Notes (Optional):
            </label>
            <textarea
              value={statusChangeNote}
              onChange={(e) => setStatusChangeNote(e.target.value)}
              placeholder="Add a note about this status change..."
              style={{
                width: '100%',
                minHeight: '80px',
                padding: '8px',
                border: '1px solid #d9d9d9',
                borderRadius: '6px',
                resize: 'vertical'
              }}
            />
          </div>
        </Space>
      </Modal>
    </div>
  );
};

export default WaterMitigationDetail;
