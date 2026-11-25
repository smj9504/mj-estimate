/**
 * Make the project's invoice from the carrier's estimate
 * (rebuild/estimate_invoice.py): one line per room at what the estimate
 * prices it, the deductible, prior payments and ACV payment as already
 * received, dated the day the work was completed. It is a real invoice
 * (Invoices) and its PDF becomes the project's Invoice document.
 */

import React, { useEffect, useState } from 'react';
import { Alert, DatePicker, Modal, Select, Skeleton, message } from 'antd';
import { SwapOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { humanize, useSheetModal } from '../common/ui';
import { rebuildService } from '../../services/rebuildService';
import { formatCurrency } from './rebuildUi';
import type { RebuildCompletionDoc, RebuildInvoicePreview, RebuildProject } from '../../types/rebuild';
import type { ClaimNegotiation } from '../../types/client';

type EstimateVersion = ClaimNegotiation & { file_download_id?: string | null };

interface Props {
  open: boolean;
  project: RebuildProject;
  versions: EstimateVersion[];
  latestEstimate: EstimateVersion | null;
  onClose: () => void;
  onSuccess: (doc: RebuildCompletionDoc) => void;
}

const revisionLabel = (v: EstimateVersion) =>
  [`Rev #${v.revision_number}`, humanize(v.revision_type || 'initial'), v.estimate_category && humanize(v.estimate_category)]
    .filter(Boolean)
    .join(' · ');

const RebuildInvoiceFromEstimate: React.FC<Props> = ({ open, project, versions, latestEstimate, onClose, onSuccess }) => {
  const { isPhone, sheetProps } = useSheetModal('tall');
  const withPdf = versions.filter(v => v.file_download_id);

  const [estimateId, setEstimateId] = useState<string | undefined>();
  const [completion, setCompletion] = useState<Dayjs | null>(null);
  const [preview, setPreview] = useState<RebuildInvoicePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Each time it opens: the latest estimate, and the completion date the project has
  useEffect(() => {
    if (!open) return;
    setEstimateId(latestEstimate?.id);
    setCompletion(project.actual_completion ? dayjs(project.actual_completion) : null);
    setPreview(null);
    setError(null);
  }, [open, latestEstimate?.id, project.actual_completion]);

  useEffect(() => {
    if (!open || !estimateId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    rebuildService.previewInvoice(project.id, estimateId)
      .then(p => { if (!cancelled) setPreview(p); })
      .catch((err: any) => {
        if (!cancelled) {
          setPreview(null);
          setError(err?.response?.data?.detail || 'Could not read the estimate PDF');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, estimateId, project.id]);

  const create = async () => {
    if (!completion) {
      message.warning('Pick the date the work was completed');
      return;
    }
    setCreating(true);
    try {
      const doc = await rebuildService.createInvoice(project.id, completion.format('YYYY-MM-DD'), estimateId);
      message.success(`${doc.title} made and added to the completion documents`);
      onSuccess(doc);
      onClose();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Could not make the invoice');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      title="Invoice from the insurance estimate"
      open={open}
      width={720}
      onCancel={onClose}
      onOk={create}
      okText="Make invoice"
      okButtonProps={{ disabled: !preview || !completion || loading }}
      confirmLoading={creating}
      destroyOnClose
      {...sheetProps}
    >
      <div className="rb-inv">
        <div className="rb-inv-fields">
          <label className="rb-inv-field">
            <span className="rb-inv-label">Estimate</span>
            <Select
              value={estimateId}
              onChange={setEstimateId}
              options={withPdf.map(v => ({
                value: v.id,
                label: `${revisionLabel(v)}${v.id === latestEstimate?.id ? ' (latest)' : ''}`,
              }))}
              suffixIcon={<SwapOutlined />}
              popupMatchSelectWidth={false}
              size={isPhone ? 'large' : 'middle'}
              aria-label="Estimate to bill from"
            />
          </label>
          <label className="rb-inv-field">
            <span className="rb-inv-label">Work completed (invoice date)</span>
            <DatePicker
              value={completion}
              onChange={setCompletion}
              format="MMM D, YYYY"
              allowClear={false}
              placeholder="Pick the day"
              size={isPhone ? 'large' : 'middle'}
              status={completion ? undefined : 'warning'}
              aria-label="Work completed"
              inputReadOnly={isPhone}
            />
          </label>
        </div>

        {loading && <Skeleton active title={false} paragraph={{ rows: 5 }} />}
        {!loading && error && <Alert type="error" showIcon message={error} />}
        {!loading && preview && (
          <>
            {preview.warnings.map(w => <Alert key={w} type="warning" showIcon message={w} />)}
            <table className="rb-inv-table">
              <tbody>
                {preview.lines.map((line, i) => (
                  <tr key={`${line.name}-${i}`}>
                    <td>
                      <span className="rb-inv-room">{line.name}</span>
                      {line.description && <span className="rb-inv-scope">{line.description}</span>}
                    </td>
                    <td className="rb-num">{formatCurrency(line.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="rb-inv-total">
                  <td>Total (RCV)</td>
                  <td className="rb-num">{formatCurrency(preview.total)}</td>
                </tr>
                {preview.payments.map(p => (
                  <tr key={p.label} className="rb-inv-paid">
                    <td>{p.label}</td>
                    <td className="rb-num">−{formatCurrency(p.amount)}</td>
                  </tr>
                ))}
                <tr className="rb-inv-balance">
                  <td>Balance due</td>
                  <td className="rb-num">{formatCurrency(preview.balance_due)}</td>
                </tr>
              </tfoot>
            </table>
            <p className="rb-inv-note">
              Made on the Invoices page under the claim's reconstruction company, dated{' '}
              {completion ? completion.format('MMM D, YYYY') : 'the day the work was completed'}; the date is
              saved on the project too. Edit it there, then print its PDF again from the document's menu.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
};

export default RebuildInvoiceFromEstimate;
