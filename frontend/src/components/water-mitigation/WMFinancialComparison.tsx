/**
 * WM Financial Comparison Component
 * Displays side-by-side comparison of our invoice vs insurance company's WM estimate.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Card, Statistic, Row, Col, Tag, Typography, Spin, Empty, Divider, Tooltip } from 'antd';
import {
  DollarOutlined, ArrowUpOutlined, ArrowDownOutlined,
  FileTextOutlined, SafetyCertificateOutlined, InfoCircleOutlined,
} from '@ant-design/icons';
import {
  financialComparisonService,
  type WMFinancialComparison,
} from '../../services/waterMitigationService';

const { Text, Title } = Typography;

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

  if (loading) return <Spin size="small" style={{ display: 'block', margin: '16px 0' }} />;

  const hasInsurance = data?.insurance_estimate &&
    (data.insurance_estimate.wm_section || data.insurance_estimate.wm_estimate_amount);
  const hasOurInvoice = data?.our_invoice;

  if (!data || (!hasInsurance && !hasOurInvoice)) return null;

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
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <SafetyCertificateOutlined style={{ color: '#fa8c16' }} />
              <Text strong>Insurance Estimate (WM)</Text>
              {insurance_estimate?.negotiation_type && (
                <Tag style={{ fontSize: 11 }}>{insurance_estimate.negotiation_type}</Tag>
              )}
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
                  <div style={{ marginTop: 6, fontSize: 11, color: '#888' }}>
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
        <div style={{ marginTop: 6, fontSize: 11, color: '#999', textAlign: 'right' }}>
          Insurance estimate received: {new Date(insurance_estimate.negotiation_date).toLocaleDateString()}
          {insurance_estimate.negotiation_revision && (
            <> (Rev. {insurance_estimate.negotiation_revision})</>
          )}
        </div>
      )}
    </Card>
  );
};

export default WMFinancialComparisonCard;
