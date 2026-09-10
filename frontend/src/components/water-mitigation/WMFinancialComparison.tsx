/**
 * WM Financial Comparison Component
 * Displays side-by-side comparison of our invoice vs insurance company's WM estimate.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Card, Statistic, Row, Col, Tag, Typography, Spin, Divider, Tooltip,
  Upload, Button, Modal, Table, InputNumber, Alert, message, Space,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DollarOutlined, ArrowUpOutlined, ArrowDownOutlined,
  FileTextOutlined, SafetyCertificateOutlined, InfoCircleOutlined,
  UploadOutlined, FilePdfOutlined,
} from '@ant-design/icons';
import {
  financialComparisonService,
  type WMFinancialComparison,
  type WMEstimateParseResult,
  type WMEstimateSection,
} from '../../services/waterMitigationService';
import { fileService } from '../../services/fileService';

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

  const uploadButton = (
    <Upload
      accept=".pdf"
      maxCount={1}
      showUploadList={false}
      beforeUpload={(file) => { handleFile(file as File); return false; }}
    >
      <Button size="small" icon={<UploadOutlined />} loading={parsing}>
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

  const diffPositive = comparison.difference != null && comparison.difference > 0;
  const diffNegative = comparison.difference != null && comparison.difference < 0;

  return (
    <Card
      size="small"
      title={
        <span>
          <DollarOutlined style={{ marginRight: 6 }} />
          Invoice vs Insurance Estimate
        </span>
      }
      style={{ marginTop: 16 }}
    >
      <Row gutter={[16, 16]}>
        {/* Our Invoice */}
        <Col xs={24} md={12}>
          <div style={{
            background: '#f0f5ff', borderRadius: 8, padding: '12px 16px',
            border: '1px solid #d6e4ff',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <FileTextOutlined style={{ color: '#1890ff' }} />
              <Text strong>Our Invoice</Text>
              {our_invoice?.invoice_number && (
                <Tag color="blue" style={{ fontSize: 11 }}>#{our_invoice.invoice_number}</Tag>
              )}
            </div>
            {our_invoice ? (
              <Statistic
                value={our_invoice.total_amount}
                precision={2}
                prefix="$"
                valueStyle={{ fontSize: 24, fontWeight: 'bold', color: '#1890ff' }}
              />
            ) : (
              <Text type="secondary">No invoice generated</Text>
            )}
          </div>
        </Col>

        {/* Insurance Estimate */}
        <Col xs={24} md={12}>
          <div style={{
            background: '#fff7e6', borderRadius: 8, padding: '12px 16px',
            border: '1px solid #ffe7ba',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              <SafetyCertificateOutlined style={{ color: '#fa8c16' }} />
              <Text strong>Insurance Estimate (WM)</Text>
              {insurance_estimate?.negotiation_type && (
                <Tag style={{ fontSize: 11 }}>{insurance_estimate.negotiation_type}</Tag>
              )}
              {insurance_estimate?.estimate_category === 'water_mitigation' &&
                insurance_estimate?.wm_cost_status === 'included_in_rebuild' && (
                <Tag color="purple" style={{ fontSize: 11 }}>from combined</Tag>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                {insurance_estimate?.document_file_id && (
                  <Tooltip title={insurance_estimate.document_name || 'View estimate PDF'}>
                    <a
                      href={`${fileService.getDownloadUrl(insurance_estimate.document_file_id)}?inline=true`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <FilePdfOutlined style={{ color: '#ff4d4f', fontSize: 16 }} />
                    </a>
                  </Tooltip>
                )}
                {uploadButton}
              </div>
            </div>
            {wmSec ? (
              <>
                <Statistic
                  value={wmSec.rcv}
                  precision={2}
                  prefix="$"
                  valueStyle={{ fontSize: 24, fontWeight: 'bold', color: '#fa8c16' }}
                  suffix={<Text type="secondary" style={{ fontSize: 12 }}>RCV</Text>}
                />
                <Divider style={{ margin: '8px 0' }} />
                <Row gutter={8}>
                  <Col span={8}>
                    <div style={{ textAlign: 'center' }}>
                      <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>RCV</Text>
                      <Text strong style={{ fontSize: 13 }}>{fmt(wmSec.rcv)}</Text>
                    </div>
                  </Col>
                  <Col span={8}>
                    <div style={{ textAlign: 'center' }}>
                      <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Depreciation</Text>
                      <Text strong style={{ fontSize: 13, color: '#ff4d4f' }}>
                        -{fmt(wmSec.depreciation)}
                      </Text>
                    </div>
                  </Col>
                  <Col span={8}>
                    <div style={{ textAlign: 'center' }}>
                      <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Net ACV</Text>
                      <Text strong style={{ fontSize: 13, color: '#52c41a' }}>{fmt(wmSec.net_acv)}</Text>
                    </div>
                  </Col>
                </Row>
                {(wmSec.overhead_amount > 0 || wmSec.profit_amount > 0) && (
                  <div style={{ marginTop: 6, fontSize: 11, color: '#8c8c8c' }}>
                    <Tooltip title="Overhead & Profit included in RCV">
                      <InfoCircleOutlined style={{ marginRight: 4 }} />
                      O&P: {fmt(wmSec.overhead_amount)} + {fmt(wmSec.profit_amount)}
                    </Tooltip>
                  </div>
                )}
              </>
            ) : insurance_estimate?.wm_estimate_amount ? (
              <Statistic
                value={insurance_estimate.wm_estimate_amount}
                precision={2}
                prefix="$"
                valueStyle={{ fontSize: 24, fontWeight: 'bold', color: '#fa8c16' }}
              />
            ) : (
              <Text type="secondary">
                {insurance_estimate?.wm_cost_status === 'not_received'
                  ? 'Not yet received from insurance'
                  : insurance_estimate?.wm_cost_status === 'included_in_rebuild'
                  ? 'Included in rebuild estimate'
                  : 'No WM estimate available'}
              </Text>
            )}
          </div>
        </Col>
      </Row>

      {/* Difference Banner */}
      {comparison.difference != null && comparison.insurance_total > 0 && (
        <div style={{
          marginTop: 12, padding: '8px 16px', borderRadius: 6,
          background: diffPositive ? '#fff1f0' : diffNegative ? '#f6ffed' : '#fafafa',
          border: `1px solid ${diffPositive ? '#ffa39e' : diffNegative ? '#b7eb8f' : '#d9d9d9'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: 8,
        }}>
          <Text>
            {diffPositive ? (
              <><ArrowUpOutlined style={{ color: '#ff4d4f' }} /> Our invoice is <Text strong style={{ color: '#ff4d4f' }}>higher</Text> by</>
            ) : diffNegative ? (
              <><ArrowDownOutlined style={{ color: '#52c41a' }} /> Our invoice is <Text strong style={{ color: '#52c41a' }}>lower</Text> by</>
            ) : (
              <>Amounts match</>
            )}
          </Text>
          <div>
            <Text strong style={{ fontSize: 16 }}>
              {fmt(Math.abs(comparison.difference))}
            </Text>
            {comparison.difference_pct != null && (
              <Tag
                color={diffPositive ? 'red' : diffNegative ? 'green' : 'default'}
                style={{ marginLeft: 6, fontSize: 11 }}
              >
                {diffPositive ? '+' : ''}{comparison.difference_pct}%
              </Tag>
            )}
          </div>
        </div>
      )}

      {insurance_estimate?.negotiation_date && (
        <div style={{ marginTop: 6, fontSize: 11, color: '#8c8c8c', textAlign: 'right' }}>
          Insurance estimate received: {new Date(insurance_estimate.negotiation_date).toLocaleDateString()}
          {insurance_estimate.negotiation_revision && (
            <> (Rev. {insurance_estimate.negotiation_revision})</>
          )}
        </div>
      )}

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
              <FilePdfOutlined style={{ color: '#ff4d4f' }} />
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
