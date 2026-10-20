/**
 * ResolveTaskModal — closes a follow-up stage the way that stage needs:
 * estimate-intake stages record the insurance outcome (estimate received,
 * WM only, our estimate requested, denied), payment stages record the
 * payment status, every other stage just takes notes. The outcome drives what
 * the backend creates next (rebuild project, WM payment task, dispute path),
 * so the list and the claim page both resolve through this one form.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button, Col, Form, Input, InputNumber, message, Modal, Row, Select, Tooltip, Upload,
} from 'antd';
import {
  DeleteOutlined, FilePdfOutlined, InfoCircleOutlined, PlusOutlined, UploadOutlined,
} from '@ant-design/icons';
import { claimFollowUpService } from '../../services/claimFollowUpService';
import { supplementService } from '../../services/supplementService';
import { fileService } from '../../services/fileService';
import { Pill, useSheetModal } from '../common/ui';
import type { FollowUpTask } from '../../types/claimFollowUp';
import { ESTIMATE_OUTCOME_TASK_TYPES, PAYMENT_TASK_TYPES } from './claimProgress';

const { TextArea } = Input;

interface ResolveTaskModalProps {
  /** The task to resolve; the dialog is open while this is set */
  task: FollowUpTask | null;
  onClose: () => void;
  onResolved?: (task: FollowUpTask) => void;
}

interface ExistingPdf {
  name: string;
  id?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const DENIED_ACTIONS = [
  { value: 'complete', label: 'Complete', hint: 'Close the claim' },
  { value: 'dispute', label: 'Dispute', hint: 'Create estimate & dispute with insurance' },
  { value: 'appraisal', label: 'Appraisal', hint: 'Proceed to appraisal process' },
  { value: 'attorney', label: 'Attorney', hint: 'Refer to attorney' },
];

/** An already-uploaded PDF the form will reuse unless a new one is picked */
const ExistingFile: React.FC<{ file: ExistingPdf }> = ({ file }) => (
  <div className="fu-existing-file">
    <FilePdfOutlined className="fu-pdf-icon" />
    {file.id ? (
      <a href={`${fileService.getDownloadUrl(file.id)}?inline=true`} target="_blank" rel="noopener noreferrer">
        {file.name}
      </a>
    ) : (
      <span>{file.name}</span>
    )}
    <Pill tone="green">Uploaded</Pill>
  </div>
);

const ResolveTaskModal: React.FC<ResolveTaskModalProps> = ({ task, onClose, onResolved }) => {
  const queryClient = useQueryClient();
  const { sheetProps } = useSheetModal();
  const [form] = Form.useForm();
  const [outcome, setOutcome] = useState<string | undefined>();
  const [deniedAction, setDeniedAction] = useState<string | undefined>();
  const [file, setFile] = useState<File | undefined>();
  const [wmFile, setWmFile] = useState<File | undefined>();
  const [parsedWmAmount, setParsedWmAmount] = useState<number | undefined>();
  const [isParsingWm, setIsParsingWm] = useState(false);
  const [parsedSections, setParsedSections] = useState<any[] | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [existingPdf, setExistingPdf] = useState<ExistingPdf | undefined>();
  const [existingWmPdf, setExistingWmPdf] = useState<ExistingPdf | undefined>();

  // Keep the last task on screen while the dialog animates closed
  const lastTask = useRef<FollowUpTask | null>(null);
  if (task) lastTask.current = task;
  const shown = task || lastTask.current;

  const isPaymentTask = !!shown && PAYMENT_TASK_TYPES.includes(shown.task_type);
  const isEstimateOutcomeTask = !!shown && ESTIMATE_OUTCOME_TASK_TYPES.includes(shown.task_type);
  const isDeniedWithNextStep = outcome === 'denied' && !!deniedAction && deniedAction !== 'complete';

  const resetState = () => {
    form.resetFields();
    setOutcome(undefined);
    setDeniedAction(undefined);
    setFile(undefined);
    setWmFile(undefined);
    setParsedWmAmount(undefined);
    setParsedSections(null);
    setExistingPdf(undefined);
    setExistingWmPdf(undefined);
  };

  // Fresh form for every task; estimate-intake stages prefill from the
  // carrier estimate already on the claim.
  useEffect(() => {
    if (!task) return;
    let cancelled = false;
    resetState();
    if (task.resolution_notes) {
      form.setFieldsValue({ resolution_notes: task.resolution_notes });
    }
    // Only estimate-intake stages need the insurance-estimate autofill.
    // Payment / supplement / other stages resolve independently and must
    // not be forced into the "Insurance Estimate Received" flow.
    if (ESTIMATE_OUTCOME_TASK_TYPES.includes(task.task_type) && task.claim_id) {
      supplementService.listInsuranceEstimates(task.claim_id).then((estimates: any[]) => {
        if (cancelled || estimates.length === 0) return;
        const combined = estimates.find((e: any) => e.estimate_category === 'combined');
        const recon = estimates.find((e: any) => e.estimate_category === 'reconstruction');
        const wm = estimates.find((e: any) => e.estimate_category === 'water_mitigation');
        const main = combined || recon
          || estimates.find((e: any) => (e.rcv_amount || 0) > 0)
          || estimates[0];
        const formValues: any = {
          outcome: 'estimate_received',
          rcv_amount: main.rcv_amount || 0,
          acv_amount: main.acv_amount || 0,
          depreciation_amount: main.depreciation_amount || 0,
          deductible: main.deductible || 0,
        };
        if (combined) {
          formValues.wm_cost_status = 'included_in_rebuild';
        } else if (wm && wm.document_url && wm.document_url !== main.document_url) {
          formValues.wm_cost_status = 'separate_estimate';
        }
        form.setFieldsValue(formValues);
        setOutcome('estimate_received');
        if (main.sections_data?.length) setParsedSections(main.sections_data);
        if (main.document_name) {
          setExistingPdf({ name: main.document_name, id: main.file_download_id || main.document_url });
        }
        if (wm && wm.document_url && wm.document_url !== main.document_url) {
          if (wm.document_name) {
            setExistingWmPdf({ name: wm.document_name, id: wm.file_download_id || wm.document_url });
          }
          if (wm.rcv_amount) {
            setParsedWmAmount(wm.rcv_amount);
            form.setFieldsValue({ wm_estimate_amount: wm.rcv_amount });
          }
        }
      }).catch(() => {
        // Ignore - just open the empty form
      });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  const close = () => {
    resetState();
    onClose();
  };

  const resolveMutation = useMutation({
    mutationFn: ({ taskId, body }: { taskId: string; body: any }) =>
      claimFollowUpService.resolveTask(taskId, body),
    onSuccess: (resolved, variables) => {
      const result = variables.body?.outcome;
      const nextAction = variables.body?.denied_action;
      if (result === 'estimate_received') {
        message.success('Task resolved - Insurance estimate received. Rebuild project created.');
      } else if (result === 'wm_estimate_only') {
        message.success('Task resolved - WM estimate recorded. WM Payment task created.');
      } else if (result === 'estimate_requested') {
        message.success('Task resolved - Estimate request created. Check Estimates page.');
      } else if (result === 'denied' && nextAction && nextAction !== 'complete') {
        const labels: Record<string, string> = { dispute: 'Dispute', appraisal: 'Appraisal', attorney: 'Attorney' };
        message.info(`Claim denied - Proceeding with ${labels[nextAction] || nextAction}. Task updated.`);
      } else if (result === 'denied') {
        message.warning('Task resolved - Claim denied.');
      } else {
        message.success('Task resolved');
      }
      queryClient.invalidateQueries({ queryKey: ['followup-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['followup-stats'] });
      queryClient.invalidateQueries({ queryKey: ['claim-followup-detail'] });
      queryClient.invalidateQueries({ queryKey: ['supplements'] });
      queryClient.invalidateQueries({ queryKey: ['supplement-stats'] });
      if (shown) onResolved?.(resolved || shown);
      close();
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail || 'Failed to resolve task';
      if (err?.response?.status === 404) {
        message.error('Task not found. It may have been deleted. Refreshing list...');
        queryClient.invalidateQueries({ queryKey: ['followup-tasks'] });
        queryClient.invalidateQueries({ queryKey: ['claim-followup-detail'] });
        close();
      } else {
        message.error(detail);
      }
    },
  });

  const recalcTotals = (sections: any[]) => {
    const totalRcv = sections.reduce((sum, s) => sum + (s.rcv || 0), 0);
    const totalDep = sections.reduce((sum, s) => sum + (s.depreciation || 0), 0);
    form.setFieldsValue({
      rcv_amount: round2(totalRcv),
      acv_amount: round2(totalRcv - totalDep),
      depreciation_amount: round2(totalDep),
    });
  };

  const updateSection = (idx: number, patch: Record<string, any>) => {
    const updated = [...(parsedSections || [])];
    const next = { ...updated[idx], ...patch };
    next.net_acv = round2((next.rcv || 0) - (next.depreciation || 0));
    updated[idx] = next;
    setParsedSections(updated);
    if ('rcv' in patch || 'depreciation' in patch) recalcTotals(updated);
  };

  const handleEstimatePdf = async (picked: File) => {
    setFile(picked);
    setParsedSections(null);
    if (!picked.name.toLowerCase().endsWith('.pdf')) return;
    setIsParsing(true);
    try {
      const result = await claimFollowUpService.parseEstimatePdf(picked);
      setParsedSections(result.sections);
      if (result.totals?.deductible) {
        form.setFieldsValue({ deductible: result.totals.deductible });
      }
      recalcTotals(result.sections);
      message.success(`Parsed ${result.sections.length} sections from PDF`);
    } catch {
      message.warning('PDF parsing failed. Enter amounts manually.');
    } finally {
      setIsParsing(false);
    }
  };

  const handleWmPdf = async (picked: File) => {
    setWmFile(picked);
    setParsedWmAmount(undefined);
    if (!picked.name.toLowerCase().endsWith('.pdf')) return;
    setIsParsingWm(true);
    try {
      const result = await claimFollowUpService.parseEstimatePdf(picked);
      const amt = result.totals?.rcv_amount || result.totals?.acv_amount;
      if (amt) {
        setParsedWmAmount(amt);
        form.setFieldsValue({ wm_estimate_amount: amt });
        message.success(`Auto-parsed WM amount: $${amt.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      } else {
        message.warning('Could not auto-parse WM amount. Enter manually.');
      }
    } catch {
      message.warning('WM PDF parsing failed. Enter amount manually.');
    } finally {
      setIsParsingWm(false);
    }
  };

  const submit = () => {
    form.validateFields().then(values => {
      if (!shown) return;
      resolveMutation.mutate({
        taskId: shown.id,
        body: {
          resolution_notes: values.resolution_notes,
          outcome: values.outcome,
          denied_action: values.denied_action,
          acv_amount: values.acv_amount,
          rcv_amount: values.rcv_amount,
          depreciation_amount: values.depreciation_amount,
          deductible: values.deductible,
          wm_cost_status: values.wm_cost_status,
          wm_estimate_amount: parsedWmAmount ?? values.wm_estimate_amount,
          sections_data: parsedSections,
          payment_status: values.payment_status,
          payment_note: values.payment_note,
          file,
          wm_estimate_file: wmFile,
        },
      });
    }).catch(() => {
      // Form validation failed — antd shows field-level errors
    });
  };

  const money = (name: string, label: string) => (
    <Col xs={12} sm={6}>
      <Form.Item name={name} label={label} className="fu-compact-item">
        <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
      </Form.Item>
    </Col>
  );

  return (
    <Modal
      title={isDeniedWithNextStep ? `Denied - Next Action: ${shown?.title || ''}` : `Resolve: ${shown?.title || ''}`}
      open={!!task}
      okText={isDeniedWithNextStep ? 'Update Task' : 'Resolve'}
      width={650}
      {...sheetProps}
      onOk={submit}
      onCancel={close}
      confirmLoading={resolveMutation.isPending}
      className="fu-resolve-modal"
      forceRender
    >
      <Form form={form} layout="vertical">
        {isPaymentTask && (
          <p className="fu-form-hint">
            Payment stage — just record the payment status below. No estimate info needed here.
          </p>
        )}

        {!isPaymentTask && !isEstimateOutcomeTask && (
          <p className="fu-form-hint">
            Add resolution notes if needed, then click Resolve to complete this stage.
          </p>
        )}

        {isEstimateOutcomeTask && (
          <Form.Item name="outcome" label="Outcome" rules={[{ required: true, message: 'Select an outcome' }]}>
            <Select
              placeholder="What was the result?"
              onChange={(v) => { setOutcome(v); setDeniedAction(undefined); form.setFieldsValue({ denied_action: undefined }); }}
              options={[
                { value: 'estimate_received', label: 'Insurance Estimate Received' },
                { value: 'wm_estimate_only', label: 'WM Estimate Only (Rebuild Unknown)' },
                { value: 'estimate_requested', label: 'Insurance Requested Our Estimate' },
                { value: 'denied', label: 'Claim Denied' },
                { value: 'other', label: 'Other' },
              ]}
            />
          </Form.Item>
        )}

        {isEstimateOutcomeTask && outcome === 'denied' && (
          <Form.Item name="denied_action" label="Next Action" rules={[{ required: true, message: 'Select next action' }]}>
            <Select
              placeholder="What would you like to do?"
              onChange={(v) => setDeniedAction(v)}
              optionLabelProp="label"
              options={DENIED_ACTIONS.map(a => ({
                value: a.value,
                label: a.label,
                hint: a.hint,
              }))}
              optionRender={(option) => (
                <span className="fu-option">
                  <span>{option.data.label}</span>
                  <span className="fu-option-hint">{option.data.hint}</span>
                </span>
              )}
            />
          </Form.Item>
        )}

        {outcome === 'estimate_received' && (
          <>
            <Form.Item label="Insurance Estimate PDF">
              <div className="fu-upload-stack">
                {existingPdf && !file && <ExistingFile file={existingPdf} />}
                <Upload
                  maxCount={1}
                  accept=".pdf"
                  beforeUpload={(picked) => { handleEstimatePdf(picked); return false; }}
                  onRemove={() => { setFile(undefined); setParsedSections(null); }}
                  fileList={file ? [{ uid: '-1', name: file.name, status: 'done' }] : []}
                >
                  <Button icon={<UploadOutlined />} loading={isParsing}>
                    {isParsing ? 'Parsing PDF...' : existingPdf ? 'Replace PDF' : 'Upload & Parse Estimate PDF'}
                  </Button>
                </Upload>
              </div>
            </Form.Item>

            {/* Editable sections */}
            <section className="fu-form-group">
              <div className="fu-form-group-head">
                <h4 className="fu-form-group-title">Estimate Sections</h4>
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => setParsedSections([...(parsedSections || []), { section_name: '', rcv: 0, depreciation: 0, net_acv: 0 }])}
                >
                  Add Section
                </Button>
              </div>
              {(parsedSections || []).length === 0 ? (
                <p className="fu-form-hint">No sections. Upload PDF to auto-parse or add manually.</p>
              ) : (
                (parsedSections || []).map((section, idx) => (
                  <div key={idx} className="fu-section-card">
                    <div className="fu-section-card-top">
                      <Input
                        placeholder="Section name (e.g. Dwelling, Water Mitigation, Code Upgrade)"
                        aria-label="Section name"
                        value={section.section_name}
                        onChange={e => updateSection(idx, { section_name: e.target.value })}
                      />
                      <Tooltip title="Remove section">
                        <Button
                          type="text"
                          className="ui-icon-btn ui-icon-btn--danger"
                          icon={<DeleteOutlined />}
                          aria-label="Remove section"
                          onClick={() => {
                            const updated = (parsedSections || []).filter((_, i) => i !== idx);
                            setParsedSections(updated);
                            recalcTotals(updated);
                          }}
                        />
                      </Tooltip>
                    </div>
                    <Row gutter={[8, 8]}>
                      <Col xs={12} sm={8}>
                        <label className="fu-field">
                          <span className="fu-field-label">RCV</span>
                          <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }}
                            value={section.rcv} onChange={v => updateSection(idx, { rcv: v || 0 })} />
                        </label>
                      </Col>
                      <Col xs={12} sm={8}>
                        <label className="fu-field">
                          <span className="fu-field-label">Depreciation</span>
                          <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }}
                            value={section.depreciation} onChange={v => updateSection(idx, { depreciation: v || 0 })} />
                        </label>
                      </Col>
                      <Col xs={12} sm={8}>
                        <label className="fu-field">
                          <span className="fu-field-label">Net ACV</span>
                          <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }}
                            value={section.net_acv} disabled />
                        </label>
                      </Col>
                    </Row>
                  </div>
                ))
              )}
            </section>

            {/* Totals (auto-calculated) */}
            <section className="fu-form-group">
              <div className="fu-form-group-head">
                <h4 className="fu-form-group-title">Totals</h4>
              </div>
              <Row gutter={[8, 0]}>
                {money('rcv_amount', 'Total RCV')}
                {money('acv_amount', 'Total ACV')}
                {money('depreciation_amount', 'Depreciation')}
                {money('deductible', 'Deductible')}
              </Row>
            </section>

            {/* WM cost status */}
            <section className="fu-form-group">
              <div className="fu-form-group-head">
                <h4 className="fu-form-group-title">Water Mitigation Costs</h4>
              </div>
              <Form.Item
                name="wm_cost_status"
                className="fu-compact-item"
                rules={[{ required: true, message: 'WM cost status is required' }]}
              >
                <Select
                  placeholder="Does estimate include WM costs?"
                  aria-label="Water mitigation costs"
                  options={[
                    { value: 'included_in_rebuild', label: 'Included in Rebuild Estimate' },
                    { value: 'separate_estimate', label: 'Received as Separate WM Estimate' },
                    { value: 'not_received', label: 'Not Received - Need Follow-up' },
                    { value: 'not_applicable', label: 'N/A (No WM on this claim)' },
                  ]}
                />
              </Form.Item>
              <Form.Item noStyle shouldUpdate={(prev, cur) => prev.wm_cost_status !== cur.wm_cost_status}>
                {({ getFieldValue }) => {
                  const wmStatus = getFieldValue('wm_cost_status');
                  if (wmStatus === 'separate_estimate') {
                    return (
                      <div className="fu-form-sub">
                        <Form.Item label="WM Estimate PDF (Optional)">
                          <div className="fu-upload-stack">
                            {existingWmPdf && !wmFile && <ExistingFile file={existingWmPdf} />}
                            <Upload
                              maxCount={1}
                              accept=".pdf"
                              beforeUpload={(picked) => { handleWmPdf(picked); return false; }}
                              onRemove={() => { setWmFile(undefined); setParsedWmAmount(undefined); }}
                              fileList={wmFile ? [{ uid: '-2', name: wmFile.name, status: 'done' }] : []}
                            >
                              <Button icon={<UploadOutlined />} loading={isParsingWm}>
                                {isParsingWm ? 'Parsing...' : existingWmPdf ? 'Replace WM PDF' : 'Upload WM Estimate PDF'}
                              </Button>
                            </Upload>
                          </div>
                        </Form.Item>
                        <Form.Item name="wm_estimate_amount" label="WM Estimate Amount" className="fu-compact-item">
                          <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} placeholder="0.00" />
                        </Form.Item>
                      </div>
                    );
                  }
                  if (wmStatus === 'not_received') {
                    return (
                      <p className="fu-note">
                        <InfoCircleOutlined aria-hidden="true" />
                        <span>
                          A <strong>WM Payment Check</strong> follow-up task will be auto-created to request WM cost coverage from the insurance company.
                        </span>
                      </p>
                    );
                  }
                  return null;
                }}
              </Form.Item>
            </section>
          </>
        )}

        {/* WM Estimate Only - just WM amount, no rebuild info needed */}
        {outcome === 'wm_estimate_only' && (
          <section className="fu-form-group">
            <div className="fu-form-group-head">
              <h4 className="fu-form-group-title">Water Mitigation Estimate</h4>
            </div>
            <Form.Item name="wm_estimate_amount" label="WM Amount (if known)">
              <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} placeholder="Enter if known" />
            </Form.Item>
            <Form.Item label="WM Estimate PDF (Optional)" className="fu-compact-item">
              <Upload
                maxCount={1}
                accept=".pdf"
                beforeUpload={(picked) => { setWmFile(picked); return false; }}
                onRemove={() => setWmFile(undefined)}
                fileList={wmFile ? [{ uid: '-2', name: wmFile.name, status: 'done' as const }] : []}
              >
                <Button icon={<UploadOutlined />}>Upload WM PDF</Button>
              </Upload>
            </Form.Item>
            <p className="fu-note">
              <InfoCircleOutlined aria-hidden="true" />
              <span>Amount and PDF are both optional. Rebuild estimate can be added later.</span>
            </p>
          </section>
        )}

        {/* Payment status for payment tasks */}
        {isPaymentTask && (
          <section className="fu-form-group">
            <div className="fu-form-group-head">
              <h4 className="fu-form-group-title">Payment Status</h4>
            </div>
            <Form.Item name="payment_status" rules={[{ required: true, message: 'Select payment status' }]}>
              <Select
                placeholder="What is the payment status?"
                aria-label="Payment status"
                options={[
                  { value: 'received', label: 'Received' },
                  { value: 'issued', label: 'Issued (Amount Unknown)' },
                  { value: 'homeowner_holding', label: 'Homeowner Holding Check' },
                  { value: 'lost', label: 'Check Lost in Transit' },
                  { value: 'reissued', label: 'Reissued' },
                  { value: 'partial', label: 'Partial Payment' },
                  { value: 'pending', label: 'Still Pending' },
                ]}
              />
            </Form.Item>
            <Form.Item name="payment_note" label="Payment Note" className="fu-compact-item">
              <TextArea rows={2} placeholder="e.g. Homeowner has check since 6/1 / Check lost, reissue requested to State Farm" />
            </Form.Item>
          </section>
        )}

        <Form.Item name="resolution_notes" label="Resolution Notes" className="fu-compact-item">
          <TextArea rows={3} placeholder="Additional details..." />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default ResolveTaskModal;
