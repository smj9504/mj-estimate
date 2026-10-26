/**
 * Water Mitigation Job Detail Page
 * Displays detailed information for a single water mitigation job
 * Responsive: optimized for mobile and desktop
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useBreadcrumbTitle } from '../contexts/BreadcrumbContext';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card,
  Descriptions,
  Button,
  Space,
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
  Tooltip,
  Grid,
  Dropdown
} from 'antd';
import dayjs from 'dayjs';
import {
  EditOutlined,
  SwapOutlined,
  InfoCircleOutlined,
  SendOutlined,
  ReloadOutlined,
  MoreOutlined,
  MailOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import waterMitigationService, { adjusterEmailService, type WMAdjusterEmail } from '../services/waterMitigationService';
import { companyService } from '../services/companyService';
import api from '../services/api';
import type { WaterMitigationJob, JobStatusHistory, JobStatus } from '../types/waterMitigation';
import type { Company } from '../types';
import { JOB_STATUS_OPTIONS } from '../types/waterMitigation';
import JobFormModal from '../components/water-mitigation/JobFormModal';
import WaterMitigationPhotosTab from '../components/water-mitigation/WaterMitigationPhotosTab';
import WaterMitigationDocumentsTab from '../components/water-mitigation/WaterMitigationDocumentsTab';
import WaterMitigationReportTab from '../components/water-mitigation/WaterMitigationReportTab';
import WaterMitigationTrashTab from '../components/water-mitigation/WaterMitigationTrashTab';
import WaterMitigationScopeTab from '../components/water-mitigation/WaterMitigationScopeTab';
import EditableSection from '../components/water-mitigation/EditableSection';
import SendToAdjusterModal from '../components/water-mitigation/SendToAdjusterModal';
import FollowUpAdjusterModal from '../components/water-mitigation/FollowUpAdjusterModal';
import { useAdjusterEmails, senderName } from '../components/water-mitigation/AdjusterEmails';
import ReceivedEmailBody from '../components/claim-followup/ReceivedEmailBody';
import WMFinancialComparisonCard from '../components/water-mitigation/WMFinancialComparison';
import { PageHeader, Pill, type TagTone } from '../components/common/ui';
import { CompanyTag } from '../components/water-mitigation/paymentBoardShared';
import { WMStatusPill, WM_STATUS_TONES } from '../components/water-mitigation/wmStatus';
import { tagTones } from '../styles/tokens';
import { useWaterMitigationAccess } from '../hooks/useWaterMitigationAccess';
import { lazyWithRetry } from '../utils/lazyWithRetry';

const WMSketchTab = lazyWithRetry(() => import('../components/water-mitigation/sketch/WMSketchTab'));

const { useBreakpoint } = Grid;

// Tabs the Water Mitigation (View) grant opens
const LIMITED_TABS = ['details', 'photos', 'documents', 'trash'];

const WaterMitigationDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [activeTab, setActiveTab] = useState('details');
  const [sendToAdjusterOpen, setSendToAdjusterOpen] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  // The View grant: job details, photos, documents and trash; no adjuster emails
  const { limited } = useWaterMitigationAccess();

  // While the claim's WM docs follow-up is unresolved, a follow-up sent from
  // here counts on it, so the action moves out of the menu into the header.
  const { data: openFollowUpTask } = useQuery({
    queryKey: ['wm-followup-task', id],
    queryFn: () => adjusterEmailService.getOpenFollowUpTask(id!),
    enabled: !!id,
  });
  const refreshFollowUpTask = () =>
    queryClient.invalidateQueries({ queryKey: ['wm-followup-task', id] });

  // Background refresh job data when switching back to details tab
  const handleTabChange = useCallback((key: string) => {
    setActiveTab(key);
    if (key === 'details' && id) {
      // Silent refresh — update data without showing loading spinner
      waterMitigationService.getJob(id).then((jobData) => {
        setJob(jobData);
      }).catch(() => { /* silent */ });
      loadDocumentInvoices();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Prefetch photos data on tab hover for instant tab switch
  const prefetchPhotos = useCallback(() => {
    if (!id) return;
    const queryKey = ['files-infinite', 'water-mitigation', id, 'image', 20, undefined];
    // Only prefetch if not already cached
    if (!queryClient.getQueryData(queryKey)) {
      queryClient.prefetchInfiniteQuery({
        queryKey,
        queryFn: async () => {
          const response = await api.get(`/api/water-mitigation/jobs/${id}/photos`, {
            params: { page: 1, page_size: 20, sort_by: 'captured_date', sort_order: 'desc' }
          });
          const data = response.data;
          const baseURL = api.defaults.baseURL || '';
          const items = data.items.map((photo: any) => {
            const imageUrl = photo.preview_url
              ? (photo.preview_url.startsWith('http') ? photo.preview_url : `${baseURL}${photo.preview_url}`)
              : `${baseURL}/api/water-mitigation/photos/${photo.id}/preview?size=web`;
            const thumbUrl = photo.thumbnail_url
              ? (photo.thumbnail_url.startsWith('http') ? photo.thumbnail_url : `${baseURL}${photo.thumbnail_url}`)
              : imageUrl;
            const originalUrl = `${baseURL}/api/water-mitigation/photos/${photo.id}/preview?size=original`;
            return {
              id: photo.id, filename: photo.file_name, originalName: photo.file_name,
              url: imageUrl, fileUrl: originalUrl, thumbnailUrl: thumbUrl,
              contentType: photo.mime_type || 'image/jpeg', mimeType: photo.mime_type,
              size: photo.file_size || 0, category: photo.category || '',
              description: photo.description || '',
              uploadDate: photo.captured_date || photo.created_at,
              createdAt: photo.created_at, updatedAt: photo.updated_at,
            };
          });
          return { items, total: data.total, page: data.page, page_size: data.page_size, total_pages: data.total_pages };
        },
        initialPageParam: 1,
        staleTime: 5 * 60 * 1000,
      });
    }
  }, [id, queryClient]);
  const [loading, setLoading] = useState(false);
  const [job, setJob] = useState<WaterMitigationJob | null>(null);

  // Set breadcrumb title to property address
  useBreadcrumbTitle(job?.property_address || null);
  const [statusHistory, setStatusHistory] = useState<JobStatusHistory[]>([]);
  const [isEditMode, setIsEditMode] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<JobStatus | null>(null);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [statusChangeNote, setStatusChangeNote] = useState('');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [documentInvoices, setDocumentInvoices] = useState<{ filename: string; invoice_amount: number }[]>([]);

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
    check_amount: null as number | null,
    payment_status: '' as string,
    payment_note: '' as string,
  });

  useEffect(() => {
    const isEdit = window.location.pathname.includes('/edit');
    setIsEditMode(isEdit);
    if (isEdit) {
      setShowEditModal(true);
    }
  }, []);

  const loadCompanies = async () => {
    try {
      const companiesData = await companyService.getCompanies();
      setCompanies(companiesData);
    } catch (error) {
      console.error('Failed to load companies:', error);
    }
  };

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

  const loadDocumentInvoices = async () => {
    if (!id) return;
    try {
      const docs = await waterMitigationService.documents.getByJob(id, 'Invoice');
      const invoiceDocs = docs
        .filter((d: any) => d.invoice_amount != null && d.invoice_amount > 0)
        .map((d: any) => ({ filename: d.filename, invoice_amount: d.invoice_amount }));
      setDocumentInvoices(invoiceDocs);
    } catch {
      // Silent - not critical
    }
  };

  useEffect(() => {
    loadJob();
    loadCompanies();
    loadDocumentInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
        check_amount: job.check_amount || null,
        payment_status: job.payment_status || '',
        payment_note: job.payment_note || '',
      });
    }
  }, [job]);

  const handleEditModalClose = () => {
    setShowEditModal(false);
    if (isEditMode) {
      navigate(`/water-mitigation/${id}`);
    }
  };

  const handleEditModalSuccess = () => {
    setShowEditModal(false);
    loadJob();
    if (isEditMode) {
      navigate(`/water-mitigation/${id}`);
    }
  };

  const handleStatusChange = (newStatus: JobStatus) => {
    if (job && newStatus === job.status) {
      message.warning('Already in this status');
      return;
    }
    setSelectedStatus(newStatus);
    setShowStatusModal(true);
  };

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
      await loadJob();
      // Moving to "Sent to adjuster" opens the WM docs follow-up
      refreshFollowUpTask();
    } catch (error) {
      message.error('Failed to update status');
      console.error('Update status error:', error);
    }
  };

  const cancelStatusChange = () => {
    setShowStatusModal(false);
    setSelectedStatus(null);
    setStatusChangeNote('');
  };

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
    if (insuranceForm.mitigation_start_date && insuranceForm.mitigation_end_date) {
      const startDate = dayjs(insuranceForm.mitigation_start_date);
      const endDate = dayjs(insuranceForm.mitigation_end_date);
      if (endDate.isBefore(startDate)) {
        message.error('Mitigation end date must be after start date');
        return;
      }
    }
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
      check_amount: financialForm.check_amount ?? undefined,
      payment_status: financialForm.payment_status || undefined,
      payment_note: financialForm.payment_note || undefined,
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

  const formatMitigationPeriod = (): string => {
    if (!job) return '-';
    const startDate = job.mitigation_start_date;
    const endDate = job.mitigation_end_date;
    if (startDate && endDate) {
      return `${dayjs(startDate).format('MMM D, YYYY')} - ${dayjs(endDate).format('MMM D, YYYY')}`;
    } else if (startDate) {
      return `From ${dayjs(startDate).format('MMM D, YYYY')}`;
    } else if (endDate) {
      return `Until ${dayjs(endDate).format('MMM D, YYYY')}`;
    }
    return '-';
  };

  // Timeline dot colour: the status pill's text tone
  const getStatusColor = useCallback((status: JobStatus): string =>
    tagTones[WM_STATUS_TONES[status] ?? 'gray'].text, []);

  // Mail about the job sits in its history next to the status changes. The
  // View grant doesn't get adjuster correspondence.
  const { emails: receivedEmails, check: inboxCheck } = useAdjusterEmails(id || '', !limited);
  const [openEmail, setOpenEmail] = useState<WMAdjusterEmail | null>(null);
  const historyEntries = useMemo(() => [
    ...statusHistory.map((status) => ({ kind: 'status' as const, at: status.changed_at, status })),
    ...(limited ? [] : receivedEmails).map((email) => ({ kind: 'email' as const, at: email.received_at, email })),
  ].sort((a, b) => dayjs(b.at || 0).valueOf() - dayjs(a.at || 0).valueOf()),
  [statusHistory, receivedEmails, limited]);

  // Memoize company select options
  const companyOptions = useMemo(() =>
    companies.map(c => ({
      value: c.id,
      label: c.name + (c.company_code ? ` (${c.company_code})` : '')
    })),
    [companies]
  );

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: isMobile ? '50px 16px' : '100px' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!job) {
    return (
      <div style={{ textAlign: 'center', padding: isMobile ? '50px 16px' : '100px' }}>
        <p>Job not found</p>
        <Button onClick={() => navigate('/water-mitigation')}>Back to List</Button>
      </div>
    );
  }

  // Facts read as single-column property rows on every screen size
  const descColumn = 1;
  const propRows = { bordered: false, column: 1, colon: false, size: 'small' as const, className: 'ui-props-desc' };
  const EMPTY = <span className="ui-props-empty">Empty</span>;

  // Phones keep it in the menu; the header has no room for another button
  const showFollowUpButton = !!openFollowUpTask && !isMobile && !limited;

  const adjusterItems = limited ? [] : [
    {
      key: 'send',
      icon: <SendOutlined />,
      label: 'Send to Adjuster',
      onClick: () => setSendToAdjusterOpen(true),
    },
    ...((job.documents_sent_date || openFollowUpTask) && !showFollowUpButton ? [{
      key: 'followup',
      icon: <ReloadOutlined />,
      label: 'Follow Up',
      onClick: () => setFollowUpOpen(true),
    }] : []),
  ];

  const moreMenuItems = [
    ...adjusterItems,
    ...(isMobile ? [
      ...(adjusterItems.length > 0 ? [{ type: 'divider' as const }] : []),
      {
        key: 'edit',
        icon: <EditOutlined />,
        label: 'Edit Job',
        onClick: () => navigate(`/water-mitigation/${id}/edit`),
      },
    ] : []),
  ];

  return (
    <div>
      <PageHeader
        title={job.property_address}
        meta={
          <>
            {!job.active && <Pill tone="gray">Inactive</Pill>}
            <CompanyTag company={job.company} />
            {job.homeowner_name && <span>{job.homeowner_name}</span>}
            {job.claim_number && <span>{job.claim_number}</span>}
          </>
        }
        actions={
          <>
            <Select
              className="wm-status-select"
              value={job.status}
              onChange={handleStatusChange}
              style={{ width: isMobile ? 190 : 200 }}
              options={JOB_STATUS_OPTIONS}
              labelRender={({ value }) => <WMStatusPill status={value as JobStatus} />}
              optionRender={(option) => <WMStatusPill status={option.value as JobStatus} />}
              suffixIcon={<SwapOutlined />}
              aria-label="Job status"
            />
            {showFollowUpButton && (
              <Button icon={<ReloadOutlined />} onClick={() => setFollowUpOpen(true)}>
                Follow Up
              </Button>
            )}
            {!isMobile && (
              <Button
                icon={<EditOutlined />}
                onClick={() => navigate(`/water-mitigation/${id}/edit`)}
              >
                Edit
              </Button>
            )}
            {moreMenuItems.length > 0 && (
              <Dropdown menu={{ items: moreMenuItems }} trigger={['click']}>
                <Button icon={<MoreOutlined />} aria-label="More actions" />
              </Dropdown>
            )}
          </>
        }
      />
      <div>
        {/* Tabs */}
        <Tabs
          defaultActiveKey="details"
          activeKey={activeTab}
          onChange={handleTabChange}
          size="middle"
          items={[
            {
              key: 'details',
              label: 'Job Details',
              children: (
                <Row gutter={isMobile ? [0, 32] : [48, 32]}>
                  {/* Job Details */}
                  <Col xs={24} lg={16}>
                    <EditableSection
                      title="Job Information"
                      onSave={handleSaveJobInfo}
                      style={{ marginBottom: 32 }}
                    >
                      {(isEditing) => (
                        <Descriptions {...propRows}>
                          <Descriptions.Item label="Property Address" span={descColumn}>
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
                          <Descriptions.Item label="Assigned Company" span={descColumn}>
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
                                options={companyOptions}
                              />
                            ) : (
                              job.company ? (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  {job.company.company_code && <CompanyTag company={job.company} />}
                                  {job.company.name}
                                </span>
                              ) : (
                                <span style={{ color: '#a5a29a' }}>Not assigned</span>
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
                              job.homeowner_name || EMPTY
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
                              job.homeowner_phone || EMPTY
                            )}
                          </Descriptions.Item>
                          <Descriptions.Item label="Email" span={descColumn}>
                            {isEditing ? (
                              <Input
                                type="email"
                                value={jobInfoForm.homeowner_email}
                                onChange={(e) => setJobInfoForm({ ...jobInfoForm, homeowner_email: e.target.value })}
                                placeholder="Enter email address"
                                maxLength={255}
                              />
                            ) : (
                              job.homeowner_email || EMPTY
                            )}
                          </Descriptions.Item>
                        </Descriptions>
                      )}
                    </EditableSection>

                    <EditableSection
                      title="Insurance Information"
                      onSave={handleSaveInsurance}
                      style={{ marginBottom: 32 }}
                    >
                      {(isEditing) => (
                        <Descriptions {...propRows}>
                          <Descriptions.Item label="Insurance Company" span={descColumn}>
                            {isEditing ? (
                              <Input
                                value={insuranceForm.insurance_company}
                                onChange={(e) => setInsuranceForm({ ...insuranceForm, insurance_company: e.target.value })}
                                placeholder="Enter insurance company"
                                maxLength={255}
                              />
                            ) : (
                              job.insurance_company || EMPTY
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
                              job.insurance_policy_number || EMPTY
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
                              job.claim_number || EMPTY
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
                              job.date_of_loss ? dayjs(job.date_of_loss).format('MMM D, YYYY') : EMPTY
                            )}
                          </Descriptions.Item>
                          <Descriptions.Item
                            label={
                              <Space size={4}>
                                <span>{isMobile ? 'Start Date' : 'Mitigation Start Date'}</span>
                                <Tooltip title="Start date of the water mitigation work. Used for photo report and photo date bulk update.">
                                  <InfoCircleOutlined style={{ color: '#a5a29a' }} />
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
                              job.mitigation_start_date ? dayjs(job.mitigation_start_date).format('MMM D, YYYY') : EMPTY
                            )}
                          </Descriptions.Item>
                          <Descriptions.Item
                            span={descColumn}
                            label={
                              <Space size={4}>
                                <span>{isMobile ? 'End Date' : 'Mitigation End Date'}</span>
                                <Tooltip title="End date of the water mitigation work. Used for photo report and photo date bulk update.">
                                  <InfoCircleOutlined style={{ color: '#a5a29a' }} />
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
                              job.mitigation_end_date ? dayjs(job.mitigation_end_date).format('MMM D, YYYY') : EMPTY
                            )}
                          </Descriptions.Item>
                          <Descriptions.Item label="Mitigation Period" span={descColumn}>
                            {formatMitigationPeriod()}
                          </Descriptions.Item>
                        </Descriptions>
                      )}
                    </EditableSection>

                    <Card
                      title="Adjuster Contact Info"
                      className="ui-sheet-card"
                      style={{ marginBottom: 32 }}
                    >
                      <Descriptions {...propRows}>
                        <Descriptions.Item label="Adjuster Name">
                          {job.adjuster_name || EMPTY}
                        </Descriptions.Item>
                        <Descriptions.Item label="Phone">
                          {job.adjuster_phone ? (
                            <a href={`tel:${job.adjuster_phone}`}>{job.adjuster_phone}</a>
                          ) : EMPTY}
                        </Descriptions.Item>
                        <Descriptions.Item label="Email" span={descColumn}>
                          {job.adjuster_email ? (
                            <a href={`mailto:${job.adjuster_email}`}>{job.adjuster_email}</a>
                          ) : EMPTY}
                        </Descriptions.Item>
                        {job.adjuster_emails && job.adjuster_emails.length > 0 && (
                          <Descriptions.Item label="Additional Contacts" span={descColumn}>
                            <div>
                              {job.adjuster_emails.map((contact, idx) => (
                                <div key={idx} style={{ marginBottom: idx < job.adjuster_emails!.length - 1 ? 4 : 0 }}>
                                  <span style={{ fontWeight: 500 }}>{contact.name}</span>
                                  {contact.role && (
                                    <Pill tone="gray" style={{ marginLeft: 8 }}>{contact.role}</Pill>
                                  )}
                                  <span style={{ marginLeft: 8 }}>
                                    <a href={`mailto:${contact.email}`}>{contact.email}</a>
                                  </span>
                                </div>
                              ))}
                            </div>
                          </Descriptions.Item>
                        )}
                      </Descriptions>
                    </Card>

                    <EditableSection
                      title="Financial Information"
                      onSave={handleSaveFinancial}
                      style={{ marginBottom: 32 }}
                    >
                      {(isEditing) => (
                        <Descriptions {...propRows}>
                          <Descriptions.Item label="Documents Sent Date" span={descColumn}>
                            {isEditing ? (
                              <DatePicker
                                value={financialForm.documents_sent_date ? dayjs(financialForm.documents_sent_date) : undefined}
                                onChange={(date) => setFinancialForm({ ...financialForm, documents_sent_date: date ? date.format('YYYY-MM-DD') : null })}
                                format="YYYY-MM-DD"
                                style={{ width: '100%' }}
                              />
                            ) : (
                              job.documents_sent_date ? dayjs(job.documents_sent_date).format('YYYY-MM-DD') : EMPTY
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
                              job.invoice_number || EMPTY
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
                              job.invoice_amount ? `$${job.invoice_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : EMPTY
                            )}
                          </Descriptions.Item>
                          {documentInvoices.length > 0 && !isEditing && (
                            <Descriptions.Item label="Uploaded Invoices" span={descColumn}>
                              <div>
                                {documentInvoices.map((inv, idx) => (
                                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: idx < documentInvoices.length - 1 ? 4 : 0 }}>
                                    <span style={{ color: '#5f5e5b', fontSize: 13 }}>{inv.filename}</span>
                                    <span style={{ fontWeight: 500, color: '#448361' }}>
                                      ${inv.invoice_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                  </div>
                                ))}
                                {documentInvoices.length > 1 && (
                                  <div style={{ borderTop: '1px solid #e9e9e7', paddingTop: 4, marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ fontWeight: 600 }}>Total</span>
                                    <span style={{ fontWeight: 600, color: '#448361' }}>
                                      ${documentInvoices.reduce((sum, inv) => sum + inv.invoice_amount, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </Descriptions.Item>
                          )}
                          <Descriptions.Item label="Check Number">
                            {isEditing ? (
                              <Input
                                value={financialForm.check_number}
                                onChange={(e) => setFinancialForm({ ...financialForm, check_number: e.target.value })}
                                placeholder="Enter check number"
                                maxLength={100}
                              />
                            ) : (
                              job.check_number || EMPTY
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
                              job.check_date ? dayjs(job.check_date).format('YYYY-MM-DD') : EMPTY
                            )}
                          </Descriptions.Item>
                          <Descriptions.Item label="Check Amount" span={descColumn}>
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
                              job.check_amount ? `$${job.check_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : EMPTY
                            )}
                          </Descriptions.Item>
                          <Descriptions.Item label="Payment Status" span={descColumn}>
                            {isEditing ? (
                              <Select
                                value={financialForm.payment_status || undefined}
                                onChange={(value) => setFinancialForm({ ...financialForm, payment_status: value || '' })}
                                placeholder="Select status"
                                allowClear
                                style={{ width: '100%' }}
                              >
                                <Select.Option value="pending">Pending</Select.Option>
                                <Select.Option value="issued">Issued (Amount Unknown)</Select.Option>
                                <Select.Option value="homeowner_holding">Homeowner Holding Check</Select.Option>
                                <Select.Option value="lost">Check Lost in Transit</Select.Option>
                                <Select.Option value="reissued">Reissued</Select.Option>
                                <Select.Option value="received">Received</Select.Option>
                                <Select.Option value="partial">Partial Payment</Select.Option>
                              </Select>
                            ) : (
                              job.payment_status ? (
                                <Pill tone={({
                                  pending: 'orange', issued: 'blue', homeowner_holding: 'brown',
                                  lost: 'red', reissued: 'purple', received: 'green', partial: 'yellow',
                                } as Record<string, TagTone>)[job.payment_status] || 'gray'}>
                                  {{
                                    pending: 'Pending', issued: 'Issued (Amt Unknown)',
                                    homeowner_holding: 'Homeowner Holding', lost: 'Check Lost',
                                    reissued: 'Reissued', received: 'Received', partial: 'Partial',
                                  }[job.payment_status] || job.payment_status}
                                </Pill>
                              ) : EMPTY
                            )}
                          </Descriptions.Item>
                          <Descriptions.Item label="Payment Note" span={descColumn}>
                            {isEditing ? (
                              <Input.TextArea
                                value={financialForm.payment_note}
                                onChange={(e) => setFinancialForm({ ...financialForm, payment_note: e.target.value })}
                                placeholder="e.g. Homeowner has check, waiting for handoff / Check lost, reissue requested 6/8"
                                rows={2}
                                maxLength={500}
                              />
                            ) : (
                              job.payment_note ? <span style={{ whiteSpace: 'pre-wrap' }}>{job.payment_note}</span> : EMPTY
                            )}
                          </Descriptions.Item>
                        </Descriptions>
                      )}
                    </EditableSection>

                    {id && (
                      <WMFinancialComparisonCard
                        jobId={id}
                        isActive={activeTab === 'details'}
                      />
                    )}

                    {job.notes && (
                      <Card title="Notes" className="ui-sheet-card" style={{ marginTop: 32 }}>
                        <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{job.notes}</p>
                      </Card>
                    )}
                  </Col>

                  {/* History: status changes and received emails */}
                  <Col xs={24} lg={8}>
                    <Card
                      title="History"
                      className="ui-sheet-card"
                      extra={!limited && (
                        <Tooltip title="Search the connected inboxes for this job's adjuster emails now">
                          <Button
                            size="small"
                            type="text"
                            icon={<MailOutlined />}
                            loading={inboxCheck.isPending}
                            onClick={() => inboxCheck.mutate(undefined, {
                              onSuccess: (result) => {
                                if (result.skipped_reason) message.info(result.skipped_reason);
                                else if (result.errors.length) message.warning(`Couldn't check ${result.errors.map(e => e.account).join(', ')}`);
                                else message.success(result.saved ? `${result.saved} new email(s) found` : 'No new emails');
                              },
                              onError: () => message.error('Inbox check failed'),
                            })}
                          >
                            Check inbox
                          </Button>
                        </Tooltip>
                      )}
                    >
                      <Timeline
                        items={historyEntries.map((entry) => {
                          if (entry.kind === 'status') {
                            const history = entry.status;
                            return {
                              key: history.id,
                              color: getStatusColor(history.new_status as JobStatus),
                              children: (
                                <>
                                  <p style={{ margin: 0, fontWeight: 500 }}>
                                    {history.new_status}
                                  </p>
                                  <p style={{ margin: 0, fontSize: '12px', color: '#73726e' }}>
                                    {dayjs(history.changed_at).format('MMM D, YYYY h:mm A')}
                                  </p>
                                  {history.notes && (
                                    <p style={{ margin: '4px 0 0', fontSize: '13px' }}>
                                      {history.notes}
                                    </p>
                                  )}
                                </>
                              ),
                            };
                          }
                          const { email } = entry;
                          return {
                            key: email.id,
                            color: email.from_adjuster ? tagTones.blue.text : tagTones.gray.text,
                            dot: <MailOutlined />,
                            children: (
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => setOpenEmail(email)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setOpenEmail(email);
                                  }
                                }}
                                style={{ cursor: 'pointer' }}
                              >
                                <p style={{ margin: 0, fontWeight: 500 }}>
                                  {email.from_adjuster ? 'Email from adjuster' : 'Email received'}
                                  {' · '}{senderName(email.sender)}
                                </p>
                                <p style={{ margin: 0, fontSize: '12px', color: '#73726e' }}>
                                  {email.received_at ? dayjs(email.received_at).format('MMM D, YYYY h:mm A') : '-'}
                                </p>
                                <p style={{ margin: '4px 0 0', fontSize: '13px' }}>
                                  {email.subject || '(no subject)'}
                                </p>
                                {email.snippet && (
                                  <p style={{
                                    margin: '2px 0 0', fontSize: '12px', color: '#73726e',
                                    overflow: 'hidden', display: '-webkit-box',
                                    WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                                  }}>
                                    {email.snippet}
                                  </p>
                                )}
                              </div>
                            ),
                          };
                        })}
                      />
                    </Card>

                    <Card title="Integration Info" className="ui-sheet-card" style={{ marginTop: 32 }}>
                      <Descriptions {...propRows}>
                        <Descriptions.Item label="Photos">
                          {job.photo_count || 0}
                        </Descriptions.Item>
                        <Descriptions.Item label="CompanyCam Project">
                          {job.companycam_project_id || EMPTY}
                        </Descriptions.Item>
                        <Descriptions.Item label="PA (Sheet)">
                          {job.google_sheet_name || EMPTY}
                        </Descriptions.Item>
                        <Descriptions.Item label="Google Sheet Row">
                          {job.google_sheet_row_number || EMPTY}
                        </Descriptions.Item>
                        <Descriptions.Item label="Last CompanyCam Sync">
                          {job.companycam_last_sync
                            ? new Date(job.companycam_last_sync).toLocaleString()
                            : EMPTY}
                        </Descriptions.Item>
                        <Descriptions.Item label="Last Sheets Sync">
                          {job.sheets_last_sync
                            ? new Date(job.sheets_last_sync).toLocaleString()
                            : EMPTY}
                        </Descriptions.Item>
                      </Descriptions>
                    </Card>
                  </Col>
                </Row>
              )
            },
            {
              key: 'photos',
              label: <span onMouseEnter={prefetchPhotos}>{`Photos (${job.photo_count || 0})`}</span>,
              children: id ? (
                <WaterMitigationPhotosTab
                  jobId={id}
                  clientId={job.client_id}
                  companycamProjectId={job.companycam_project_id}
                  isActive={activeTab === 'photos'}
                  aiTools={!limited}
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
                  mitigationStartDate={job.mitigation_start_date}
                  companyId={job.company_id}
                  isActive={activeTab === 'documents'}
                  onJobDataChange={loadJob}
                  canEditInvoices={!limited}
                />
              ) : null
            },
            {
              key: 'scope',
              label: 'Scope',
              children: id ? <WaterMitigationScopeTab jobId={id} jobCompanyId={job.company_id} isActive={activeTab === 'scope'} /> : null
            },
            {
              key: 'sketch',
              label: 'Sketch',
              children: id ? (
                <React.Suspense fallback={<Spin size="large" />}>
                  <WMSketchTab
                    jobId={id}
                    jobAddress={job.property_address || 'Unknown Address'}
                    isActive={activeTab === 'sketch'}
                  />
                </React.Suspense>
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
                  isActive={activeTab === 'report'}
                />
              ) : null
            },
            {
              key: 'trash',
              label: 'Trash',
              children: id ? <WaterMitigationTrashTab jobId={id} isActive={activeTab === 'trash'} /> : null
            }
          ].filter(tab => !limited || LIMITED_TABS.includes(tab.key))}
        />
      </div>

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
            <WMStatusPill status={job.status} /> to{' '}
            <WMStatusPill status={selectedStatus} />?
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
                border: '1px solid #dfdfdc',
                borderRadius: '6px',
                resize: 'vertical'
              }}
            />
          </div>
        </Space>
      </Modal>

      {/* Send to Adjuster Modal */}
      {id && (
        <SendToAdjusterModal
          open={sendToAdjusterOpen}
          onClose={() => setSendToAdjusterOpen(false)}
          jobId={id}
          onSent={(result) => {
            // Update local job state
            setJob(prev => prev ? {
              ...prev,
              status: result.status as any,
              documents_sent_date: result.documents_sent_date,
            } : prev);
            refreshFollowUpTask();
          }}
        />
      )}

      {/* Follow-Up Email Modal */}
      {id && (
        <FollowUpAdjusterModal
          open={followUpOpen}
          onClose={() => setFollowUpOpen(false)}
          jobId={id}
          onSent={() => {
            // The follow-up screen shows this send in its history and task
            refreshFollowUpTask();
            queryClient.invalidateQueries({ queryKey: ['sent-emails'] });
            queryClient.invalidateQueries({ queryKey: ['communications'] });
            queryClient.invalidateQueries({ queryKey: ['claim-followup-detail'] });
            queryClient.invalidateQueries({ queryKey: ['followup-tasks'] });
          }}
        />
      )}

      {/* A received email from the history, in full */}
      <Modal
        open={!!openEmail}
        title={openEmail?.subject || '(no subject)'}
        footer={null}
        width={720}
        onCancel={() => setOpenEmail(null)}
        destroyOnHidden
      >
        {openEmail && <ReceivedEmailBody emailId={openEmail.id} />}
      </Modal>
    </div>
  );
};

export default WaterMitigationDetail;
