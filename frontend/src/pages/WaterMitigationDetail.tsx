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
  InputNumber
} from 'antd';
import dayjs from 'dayjs';
import {
  ArrowLeftOutlined,
  EditOutlined,
  SaveOutlined,
  CloseOutlined,
  SwapOutlined
} from '@ant-design/icons';
import waterMitigationService from '../services/waterMitigationService';
import type { WaterMitigationJob, JobStatusHistory, JobStatus } from '../types/waterMitigation';
import { JOB_STATUS_OPTIONS } from '../types/waterMitigation';
import JobFormModal from '../components/water-mitigation/JobFormModal';
import WaterMitigationPhotosTab from '../components/water-mitigation/WaterMitigationPhotosTab';
import WaterMitigationDocumentsTab from '../components/water-mitigation/WaterMitigationDocumentsTab';
import WaterMitigationReportTab from '../components/water-mitigation/WaterMitigationReportTab';
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

  // Edit form states for each section
  const [jobInfoForm, setJobInfoForm] = useState({
    property_address: '',
    homeowner_name: '',
    homeowner_phone: '',
    homeowner_email: ''
  });

  const [insuranceForm, setInsuranceForm] = useState({
    insurance_company: '',
    insurance_policy_number: '',
    claim_number: '',
    date_of_loss: null as string | null,
    mitigation_period: ''
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
  }, [id]);

  // Update form states when job loads
  useEffect(() => {
    if (job) {
      setJobInfoForm({
        property_address: job.property_address || '',
        homeowner_name: job.homeowner_name || '',
        homeowner_phone: job.homeowner_phone || '',
        homeowner_email: job.homeowner_email || ''
      });

      setInsuranceForm({
        insurance_company: job.insurance_company || '',
        insurance_policy_number: job.insurance_policy_number || '',
        claim_number: job.claim_number || '',
        date_of_loss: job.date_of_loss || null,
        mitigation_period: job.mitigation_period || ''
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
    await waterMitigationService.updateJob(id, jobInfoForm);
    await loadJob();
  };

  const handleSaveInsurance = async () => {
    if (!id) return;
    // Convert null to undefined for API compatibility
    const updateData = {
      ...insuranceForm,
      date_of_loss: insuranceForm.date_of_loss || undefined
    };
    await waterMitigationService.updateJob(id, updateData);
    await loadJob();
  };

  const handleSaveFinancial = async () => {
    if (!id) return;
    // Convert null to undefined for API compatibility
    const updateData = {
      ...financialForm,
      documents_sent_date: financialForm.documents_sent_date || undefined,
      invoice_amount: financialForm.invoice_amount ?? undefined,
      check_date: financialForm.check_date || undefined,
      check_amount: financialForm.check_amount ?? undefined
    };
    await waterMitigationService.updateJob(id, updateData);
    await loadJob();
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
                        value={insuranceForm.date_of_loss ? dayjs(insuranceForm.date_of_loss) : null}
                        onChange={(date) => setInsuranceForm({ ...insuranceForm, date_of_loss: date ? date.toISOString() : null })}
                        format="YYYY-MM-DD"
                        style={{ width: '100%' }}
                      />
                    ) : (
                      job.date_of_loss ? dayjs(job.date_of_loss).format('YYYY-MM-DD') : '-'
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="Mitigation Period">
                    {isEditing ? (
                      <Input
                        value={insuranceForm.mitigation_period}
                        onChange={(e) => setInsuranceForm({ ...insuranceForm, mitigation_period: e.target.value })}
                        placeholder="Enter mitigation period"
                        maxLength={100}
                      />
                    ) : (
                      job.mitigation_period || '-'
                    )}
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
                        value={financialForm.documents_sent_date ? dayjs(financialForm.documents_sent_date) : null}
                        onChange={(date) => setFinancialForm({ ...financialForm, documents_sent_date: date ? date.toISOString() : null })}
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
                        value={financialForm.check_date ? dayjs(financialForm.check_date) : null}
                        onChange={(date) => setFinancialForm({ ...financialForm, check_date: date ? date.toISOString() : null })}
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
              children: id ? <WaterMitigationPhotosTab jobId={id} /> : null
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
                />
              ) : null
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
