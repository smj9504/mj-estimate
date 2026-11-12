/**
 * The job: who the estimate is for, where, and whether O&P is on it.
 */

import React from 'react';
import { Card, Col, Input, InputNumber, Row, Select, Switch, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import AddressAutocomplete from '../common/AddressAutocomplete';
import ClaimSearchSelect from '../common/ClaimSearchSelect';
import { companyService } from '../../services/companyService';

const { Text } = Typography;

export interface ProjectDraft {
  company_id: string | null;
  claim_id: string | null;
  property_address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  include_overhead_profit: boolean;
  overhead_pct: number;
  profit_pct: number;
  notes: string | null;
}

interface ProjectPanelProps {
  value: ProjectDraft;
  clientName?: string | null;
  onChange: (patch: Partial<ProjectDraft>) => void;
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ marginBottom: 12 }}>
    <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>{label}</Text>
    {children}
  </div>
);

const FlooringProjectPanel: React.FC<ProjectPanelProps> = ({ value, clientName, onChange }) => {
  const { data: companies } = useQuery({
    queryKey: ['companies-for-estimates'],
    queryFn: () => companyService.getCompanies(),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <Card size="small" data-testid="flooring-project-panel">
      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Field label="Company (its prices and letterhead)">
            <Select
              showSearch
              allowClear
              style={{ width: '100%' }}
              placeholder="Pick a company"
              value={value.company_id ?? undefined}
              optionFilterProp="label"
              options={(companies || []).map((c: { id: string; name: string }) => ({ value: c.id, label: c.name }))}
              onChange={(v) => onChange({ company_id: v ?? null })}
            />
          </Field>
        </Col>
        <Col xs={24} md={12}>
          <Field label={`Claim${clientName ? ` — ${clientName}` : ''}`}>
            <ClaimSearchSelect
              style={{ width: '100%' }}
              value={value.claim_id ?? undefined}
              onChange={(id, claim) => onChange({
                claim_id: id ?? null,
                // A new job takes the claim's address
                ...(claim && !value.property_address ? { property_address: claim.address } : {}),
              })}
            />
          </Field>
        </Col>
        <Col xs={24} md={12}>
          <Field label="Property address">
            <AddressAutocomplete
              value={value.property_address ?? ''}
              onChange={(v) => onChange({ property_address: v })}
              onSelect={(a) => onChange({ property_address: a.streetAddress || a.fullAddress, city: a.city, state: a.state, zip_code: a.zip })}
            />
          </Field>
        </Col>
        <Col xs={12} md={5}>
          <Field label="City">
            <Input value={value.city ?? ''} onChange={(e) => onChange({ city: e.target.value })} />
          </Field>
        </Col>
        <Col xs={6} md={3}>
          <Field label="State">
            <Select style={{ width: '100%' }} value={value.state ?? undefined} allowClear
              options={['VA', 'MD', 'DC'].map((s) => ({ value: s, label: s }))}
              onChange={(v) => onChange({ state: v ?? null })} />
          </Field>
        </Col>
        <Col xs={6} md={4}>
          <Field label="Zip">
            <Input value={value.zip_code ?? ''} onChange={(e) => onChange({ zip_code: e.target.value })} />
          </Field>
        </Col>
        <Col xs={24} md={12}>
          <Field label="Overhead & profit (folded into the unit prices)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Switch checked={value.include_overhead_profit} onChange={(v) => onChange({ include_overhead_profit: v })}
                aria-label="Include overhead and profit" />
              <InputNumber size="small" min={0} max={100} suffix="% OH" disabled={!value.include_overhead_profit}
                value={Math.round(value.overhead_pct * 1000) / 10} style={{ width: 100 }}
                onChange={(v) => onChange({ overhead_pct: (v ?? 0) / 100 })} />
              <InputNumber size="small" min={0} max={100} suffix="% P" disabled={!value.include_overhead_profit}
                value={Math.round(value.profit_pct * 1000) / 10} style={{ width: 100 }}
                onChange={(v) => onChange({ profit_pct: (v ?? 0) / 100 })} />
            </div>
          </Field>
        </Col>
        <Col xs={24} md={12}>
          <Field label="Notes (not on the estimate)">
            <Input.TextArea rows={2} value={value.notes ?? ''} onChange={(e) => onChange({ notes: e.target.value })} />
          </Field>
        </Col>
      </Row>
    </Card>
  );
};

export default FlooringProjectPanel;
