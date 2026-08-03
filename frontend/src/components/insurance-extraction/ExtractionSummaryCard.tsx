import React from 'react';
import { Alert, Descriptions, Space, Tag } from 'antd';
import { InsuranceExtraction } from '../../types/insuranceExtraction';

interface ExtractionSummaryCardProps {
  extraction: InsuranceExtraction;
}

const fmt = (v?: number | null) =>
  v != null
    ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—';

const ExtractionSummaryCard: React.FC<ExtractionSummaryCardProps> = ({ extraction }) => {
  const hierarchy = extraction.parser_metadata?.hierarchy;
  const levelCount = hierarchy?.levels?.length || 0;
  const sectionCount = hierarchy?.sections?.length || 0;
  const header = extraction.parser_metadata?.header as Record<string, unknown> | undefined;
  const summary = extraction.parser_metadata?.summary as Record<string, number> | undefined;
  const strategyLog = extraction.parser_metadata?.strategy_log as string[] | undefined;
  const strategy = extraction.parser_metadata?.strategy as string | undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Alert
        type={extraction.items.length === 0 ? 'warning' : 'info'}
        showIcon
        message={
          <Space size={[6, 4]} wrap>
            <Tag>{extraction.carrier || 'generic'}</Tag>
            <Tag>Pages: {extraction.pages}</Tag>
            <Tag color="blue">Items: {extraction.items.length}</Tag>
            <Tag>Levels: {levelCount}</Tag>
            <Tag>Sections: {sectionCount}</Tag>
          </Space>
        }
        description={
          (strategyLog || strategy) ? (
            <span style={{ fontSize: 12, color: '#8c8c8c', wordBreak: 'break-word' }}>
              Strategy: {strategy || '—'}
              {strategyLog?.length ? ` | Pipeline: ${strategyLog.join(' → ')}` : ''}
            </span>
          ) : undefined
        }
      />
      {(header || summary) && (
        <Descriptions
          size="small"
          bordered
          column={{ xs: 1, sm: 2, md: 3 }}
          items={[
            header?.insured ? { key: 'insured', label: 'Insured', children: String(header.insured) } : null,
            header?.claim_number ? { key: 'claim', label: 'Claim #', children: String(header.claim_number) } : null,
            header?.estimate_id ? { key: 'est_id', label: 'Estimate ID', children: String(header.estimate_id) } : null,
            header?.date_of_loss ? { key: 'dol', label: 'Date of Loss', children: String(header.date_of_loss) } : null,
            header?.type_of_loss ? { key: 'tol', label: 'Type of Loss', children: String(header.type_of_loss) } : null,
            header?.layout ? { key: 'layout', label: 'Layout', children: String(header.layout) } : null,
            summary?.rcv != null ? { key: 'rcv', label: 'RCV', children: fmt(summary.rcv) } : null,
            summary?.depreciation != null ? { key: 'deprec', label: 'Depreciation', children: fmt(summary.depreciation) } : null,
            summary?.acv != null ? { key: 'acv', label: 'ACV', children: fmt(summary.acv) } : null,
            summary?.deductible != null ? { key: 'ded', label: 'Deductible', children: fmt(summary.deductible) } : null,
            summary?.net_claim != null ? { key: 'net', label: 'Net Claim', children: fmt(summary.net_claim) } : null,
          ].filter(Boolean) as Array<{ key: string; label: string; children: React.ReactNode }>}
        />
      )}
    </div>
  );
};

export default ExtractionSummaryCard;
