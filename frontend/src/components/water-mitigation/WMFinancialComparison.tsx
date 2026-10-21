/**
 * WM Financial Comparison Component
 * Displays side-by-side comparison of our invoice vs insurance company's WM estimate.
 * When the carrier pays our invoice as billed there is no WM estimate at all;
 * the card records that instead ("paid per our invoice").
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Card, Divider, Typography, Spin, Tooltip,
  Upload, Button, Modal, Table, InputNumber, Alert, message, Space, Popconfirm,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  UploadOutlined, FilePdfOutlined, EditOutlined,
  CheckOutlined, CloseOutlined,
} from '@ant-design/icons';
import {
  financialComparisonService,
  type WMFinancialComparison,
  type WMEstimateParseResult,
  type WMEstimateSection,
} from '../../services/waterMitigationService';
import { fileService } from '../../services/fileService';
import { Pill, PropertyList, type PropertyItem } from '../common/ui';

const { Text } = Typography;

interface Props {
  jobId: string;
  isActive?: boolean;
}

const fmt = (val: number | null | undefined) =>
  val != null
    ? `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '-';

const WMFinancialComparisonCard: React.FC<Props> = ({ jobId, isActive }) => {
  const [data, setData] = useState<WMFinancialComparison | null>(null);
  const [loading, setLoading] = useState(false);

  // Insurance estimate upload
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<WMEstimateParseResult | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [wmAmount, setWmAmount] = useState<number | null>(null);

  // Manual amount entry (no PDF)
  const [editing, setEditing] = useState(false);
  const [manualAmount, setManualAmount] = useState<number | null>(null);
  const [savingManual, setSavingManual] = useState(false);

  // Carrier pays our invoice as billed (no WM estimate)
  const [markingPaid, setMarkingPaid] = useState(false);

  const load = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    try {
      const result = await financialComparisonService.get(jobId);
      setData(result);
    } catch {
      // silent - just show empty
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  // Refresh when tab becomes active
  const prevActive = React.useRef(isActive);
  useEffect(() => {
    if (isActive && !prevActive.current) {
      load();
    }
    prevActive.current = isActive;
  }, [isActive, load]);

  useEffect(() => { load(); }, [load]);

  const resetUpload = () => {
    setReviewOpen(false);
    setPendingFile(null);
    setParseResult(null);
    setSelectedIdx(null);
    setWmAmount(null);
  };

  // Parse the PDF, pre-select the WM section, then open the review modal
  const handleFile = async (file: File) => {
    setParsing(true);
    setPendingFile(file);
    try {
      const result = await financialComparisonService.parseInsuranceEstimate(jobId, file);
      setParseResult(result);

      const idx = result.wm_section_index;
      setSelectedIdx(idx);

      if (idx != null && result.sections[idx]) {
        const sec = result.sections[idx];
        setWmAmount(sec.rcv ?? sec.net_acv ?? null);
      } else {
        // Nothing detected - fall back to the document total so the user
        // has a starting point to correct.
        setWmAmount(result.totals?.rcv_amount ?? result.totals?.acv_amount ?? null);
      }
      setReviewOpen(true);
    } catch {
      message.error('Failed to read this PDF. Try another file or enter the amount manually.');
      setPendingFile(null);
    } finally {
      setParsing(false);
    }
  };

  const handleSave = async () => {
    if (!pendingFile || wmAmount == null) return;
    setSaving(true);
    try {
      const sections = parseResult?.sections ?? [];
      await financialComparisonService.saveInsuranceEstimate(jobId, {
        file: pendingFile,
        wmAmount,
        wmSection: selectedIdx != null ? sections[selectedIdx] : null,
        isCombined: !!parseResult?.is_combined,
        allSections: sections.length ? sections : null,
      });
      message.success('Insurance estimate saved.');
      resetUpload();
      await load();
    } catch (err: any) {
      message.error(
        err?.response?.data?.detail || 'Failed to save the insurance estimate.',
      );
    } finally {
      setSaving(false);
    }
  };

  // Seed the input with whatever the card currently shows, so editing starts
  // from the existing number rather than an empty field.
  const startEditing = () => {
    const current =
      data?.insurance_estimate?.wm_section?.rcv ??
      data?.insurance_estimate?.wm_estimate_amount ??
      null;
    setManualAmount(current);
    setEditing(true);
  };

  const handleSaveManual = async () => {
    if (manualAmount == null) return;
    setSavingManual(true);
    try {
      await financialComparisonService.saveManualInsuranceEstimate(jobId, {
        wmAmount: manualAmount,
      });
      message.success('Insurance estimate amount saved.');
      setEditing(false);
      setManualAmount(null);
      await load();
    } catch (err: any) {
      message.error(
        err?.response?.data?.detail || 'Failed to save the amount.',
      );
    } finally {
      setSavingManual(false);
    }
  };

  const handlePaidPerInvoice = async (paidPerInvoice: boolean) => {
    setMarkingPaid(true);
    try {
      await financialComparisonService.setPaidPerInvoice(jobId, { paidPerInvoice });
      message.success(
        paidPerInvoice
          ? 'Marked as paid per our invoice. A WM Payment follow-up was created.'
          : 'No longer marked as paid per our invoice.',
      );
      await load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Failed to update.');
    } finally {
      setMarkingPaid(false);
    }
  };

  const uploadButton = (
    <Upload
      accept=".pdf"
      maxCount={1}
      showUploadList={false}
      beforeUpload={(file) => { handleFile(file as File); return false; }}
    >
      <Button type="text" size="small" icon={<UploadOutlined />} loading={parsing} style={{ color: '#73726e' }}>
        {parsing ? 'Reading...' : 'Upload Estimate'}
      </Button>
    </Upload>
  );

  const sectionColumns: ColumnsType<WMEstimateSection & { _idx: number }> = [
    { title: 'Section', dataIndex: 'section_name', key: 'section_name', ellipsis: true },
    {
      title: 'RCV', dataIndex: 'rcv', key: 'rcv', align: 'right', width: 110,
      render: (v: number) => fmt(v),
    },
    {
      title: 'Dep.', dataIndex: 'depreciation', key: 'depreciation', align: 'right', width: 110,
      render: (v: number) => fmt(v),
    },
    {
      title: 'Net ACV', dataIndex: 'net_acv', key: 'net_acv', align: 'right', width: 110,
      render: (v: number) => fmt(v),
    },
  ];

  if (loading) return <Spin size="small" style={{ display: 'block', margin: '16px 0' }} />;

  // Render as long as the job loaded: with neither an invoice nor an estimate
  // the card is just the upload action, which is the state where uploading the
  // carrier's estimate matters most.
  if (!data) return null;

  const { our_invoice, insurance_estimate, comparison } = data;
  const wmSec = insurance_estimate?.wm_section;

  const hasWmEstimate = !!wmSec || !!insurance_estimate?.wm_estimate_amount;
  const paidPerInvoice = insurance_estimate?.wm_cost_status === 'paid_per_invoice' && !hasWmEstimate;

  const diffPositive = comparison.difference != null && comparison.difference > 0;
  const diffNegative = comparison.difference != null && comparison.difference < 0;

  const insuranceValue = editing ? (
    <div>
      <Space.Compact style={{ width: '100%', maxWidth: 320 }}>
        <InputNumber
          autoFocus
          min={0}
          step={0.01}
          prefix="$"
          style={{ width: '100%' }}
          value={manualAmount ?? undefined}
          onChange={(v) => setManualAmount(v ?? null)}
          onPressEnter={handleSaveManual}
          placeholder="0.00"
        />
        <Button
          type="primary"
          icon={<CheckOutlined />}
          loading={savingManual}
          disabled={manualAmount == null}
          onClick={handleSaveManual}
          aria-label="Save amount"
        />
        <Button
          icon={<CloseOutlined />}
          disabled={savingManual}
          onClick={() => { setEditing(false); setManualAmount(null); }}
          aria-label="Cancel"
        />
      </Space.Compact>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
        Saved as the water mitigation RCV. This updates the claim and the
        comparison below.
      </Text>
    </div>
  ) : wmSec ? (
    <div>
      <Text strong>{fmt(wmSec.rcv)}</Text> <Text type="secondary">RCV</Text>
      <div style={{ fontSize: 13, color: '#73726e', marginTop: 2 }}>
        Depreciation -{fmt(wmSec.depreciation)} · Net ACV {fmt(wmSec.net_acv)}
        {(wmSec.overhead_amount > 0 || wmSec.profit_amount > 0) && (
          <Tooltip title="Overhead & Profit included in RCV">
            <span> · O&P: {fmt(wmSec.overhead_amount)} + {fmt(wmSec.profit_amount)}</span>
          </Tooltip>
        )}
      </div>
    </div>
  ) : insurance_estimate?.wm_estimate_amount ? (
    <Text strong>{fmt(insurance_estimate.wm_estimate_amount)}</Text>
  ) : paidPerInvoice ? (
    <div>
      <Space size={6} wrap>
        <Pill tone="green">Paid per our invoice</Pill>
        {insurance_estimate?.approved_amount != null && (
          <span><Text strong>{fmt(insurance_estimate.approved_amount)}</Text> <Text type="secondary">approved</Text></span>
        )}
      </Space>
      <div style={{ fontSize: 13, color: '#73726e', marginTop: 2 }}>
        No insurance WM estimate needed.{' '}
        <Popconfirm
          title="Take back 'paid per our invoice'?"
          description="For a job marked by mistake. The WM payment follow-up stays."
          okText="Take back"
          cancelText="Cancel"
          onConfirm={() => handlePaidPerInvoice(false)}
        >
          <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} loading={markingPaid}>
            Undo
          </Button>
        </Popconfirm>
      </div>
    </div>
  ) : (
    <div>
      <Text type="secondary">
        {insurance_estimate?.wm_cost_status === 'not_received'
          ? 'Not yet received from insurance'
          : insurance_estimate?.wm_cost_status === 'included_in_rebuild'
          ? 'Included in rebuild estimate'
          : 'No WM estimate available'}
      </Text>
      {/* Linked to a claim: the carrier may simply pay our invoice */}
      {insurance_estimate && insurance_estimate.wm_cost_status !== 'included_in_rebuild' && (
        <div style={{ marginTop: 2 }}>
          <Popconfirm
            title="Insurance pays our invoice as billed?"
            description="No WM estimate is needed. The WM docs follow-up closes and a WM Payment follow-up opens."
            okText="Mark paid per invoice"
            cancelText="Cancel"
            onConfirm={() => handlePaidPerInvoice(true)}
          >
            <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} loading={markingPaid}>
              Insurance is paying our invoice
            </Button>
          </Popconfirm>
        </div>
      )}
    </div>
  );

  const items: PropertyItem[] = [
    {
      key: 'invoice',
      label: 'Our Invoice',
      value: our_invoice ? (
        <span>
          <Text strong>{fmt(our_invoice.total_amount)}</Text>
          {our_invoice.invoice_number && (
            <Text type="secondary"> · #{our_invoice.invoice_number}</Text>
          )}
        </span>
      ) : (
        <Text type="secondary">No invoice generated</Text>
      ),
    },
    {
      key: 'insurance',
      label: paidPerInvoice ? 'Insurance (WM)' : 'Insurance Estimate (WM)',
      value: (
        <div>
          {(insurance_estimate?.negotiation_type ||
            (insurance_estimate?.estimate_category === 'water_mitigation' &&
              insurance_estimate?.wm_cost_status === 'included_in_rebuild') ||
            insurance_estimate?.document_file_id) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
              {insurance_estimate?.negotiation_type && (
                <Pill tone="gray">{insurance_estimate.negotiation_type}</Pill>
              )}
              {insurance_estimate?.estimate_category === 'water_mitigation' &&
                insurance_estimate?.wm_cost_status === 'included_in_rebuild' && (
                <Pill tone="purple">from combined</Pill>
              )}
              {insurance_estimate?.document_file_id && (
                <a
                  href={`${fileService.getDownloadUrl(insurance_estimate.document_file_id)}?inline=true`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <FilePdfOutlined />
                  {insurance_estimate.document_name || 'View estimate PDF'}
                </a>
              )}
            </div>
          )}
          {insuranceValue}
        </div>
      ),
    },
  ];

  if (comparison.difference != null && comparison.insurance_total > 0) {
    items.push({
      key: 'difference',
      label: 'Difference',
      value: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span>
            {diffPositive ? 'Our invoice is higher by ' : diffNegative ? 'Our invoice is lower by ' : 'Amounts match'}
            {(diffPositive || diffNegative) && <Text strong>{fmt(Math.abs(comparison.difference))}</Text>}
          </span>
          {comparison.difference_pct != null && (
            <Pill tone={diffPositive ? 'red' : diffNegative ? 'green' : 'gray'}>
              {diffPositive ? '+' : ''}{comparison.difference_pct}%
            </Pill>
          )}
        </span>
      ),
    });
  }

  if (insurance_estimate?.negotiation_date) {
    items.push({
      key: 'received',
      label: 'Estimate received',
      value: (
        <span>
          {new Date(insurance_estimate.negotiation_date).toLocaleDateString()}
          {insurance_estimate.negotiation_revision && (
            <Text type="secondary"> (Rev. {insurance_estimate.negotiation_revision})</Text>
          )}
        </span>
      ),
    });
  }

  return (
    <Card
      size="small"
      className="ui-sheet-card"
      title="Invoice vs Insurance Estimate"
      extra={
        <Space size={4}>
          {!editing && (
            <Tooltip title="Enter the amount manually">
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={startEditing}
                aria-label="Enter the amount manually"
                style={{ color: '#73726e' }}
              />
            </Tooltip>
          )}
          {uploadButton}
        </Space>
      }
      style={{ marginTop: 0 }}
    >
      <PropertyList items={items} labelWidth={168} />

      <Modal
        title="Confirm Water Mitigation Amount"
        open={reviewOpen}
        onCancel={resetUpload}
        width={760}
        footer={[
          <Button key="cancel" onClick={resetUpload} disabled={saving}>Cancel</Button>,
          <Button
            key="save"
            type="primary"
            loading={saving}
            disabled={wmAmount == null}
            onClick={handleSave}
          >
            Save Estimate
          </Button>,
        ]}
      >
        {pendingFile && (
          <div style={{ marginBottom: 12 }}>
            <Space size={6}>
              <FilePdfOutlined style={{ color: '#d44c47' }} />
              <Text type="secondary" style={{ fontSize: 12 }}>{pendingFile.name}</Text>
            </Space>
          </div>
        )}

        {parseResult?.is_combined ? (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="This looks like a combined estimate (rebuild + water mitigation)"
            description="The water mitigation section is pre-selected below. Pick a different row if it chose wrong - only the selected section is recorded as the WM amount."
          />
        ) : (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="This looks like a water mitigation only estimate"
            description="Confirm the amount below, or pick a different section if the document has more than one."
          />
        )}

        {selectedIdx == null && (parseResult?.sections?.length ?? 0) > 0 && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="Couldn't identify the water mitigation section automatically"
            description="Select the correct section below, or just enter the amount by hand."
          />
        )}

        {parseResult?.sections?.length ? (
          <Table<WMEstimateSection & { _idx: number }>
            size="small"
            pagination={false}
            columns={sectionColumns}
            scroll={{ y: 240 }}
            dataSource={parseResult.sections.map((s, i) => ({ ...s, _idx: i }))}
            rowKey="_idx"
            rowSelection={{
              type: 'radio',
              selectedRowKeys: selectedIdx != null ? [selectedIdx] : [],
              onChange: (keys) => {
                const idx = keys[0] as number;
                setSelectedIdx(idx);
                const sec = parseResult.sections[idx];
                if (sec) setWmAmount(sec.rcv ?? sec.net_acv ?? null);
              },
            }}
          />
        ) : (
          <Alert
            type="warning"
            showIcon
            message="No sections could be read from this PDF"
            description="Enter the water mitigation amount manually to continue."
          />
        )}

        <Divider style={{ margin: '16px 0 12px' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Text strong>WM Amount</Text>
          <InputNumber
            min={0}
            step={0.01}
            prefix="$"
            style={{ width: 220 }}
            value={wmAmount ?? undefined}
            onChange={(v) => setWmAmount(v ?? null)}
            placeholder="0.00"
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            You can override the parsed amount.
          </Text>
        </div>
      </Modal>
    </Card>
  );
};

export default WMFinancialComparisonCard;
