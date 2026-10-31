/**
 * DetailsStep - Client/Company selection + estimation settings
 * Uses DB-integrated client/company selection (like CabinetEstimateDetail)
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Select, Input, InputNumber, Switch, AutoComplete, Segmented,
} from 'antd';
import AddressAutocomplete from '../common/AddressAutocomplete';
import { companyService } from '../../services/companyService';
import { clientService } from '../../services/clientService';
import type { Company } from '../../types';
import type { PackingSettings, Region } from '../../types/packing-estimate';
import { REGION_OPTIONS } from './constants';
import './packing.css';

const { Option } = Select;

interface DetailsStepProps {
  settings: PackingSettings;
  setSettings: (s: PackingSettings) => void;
  selectedCompanyId: string | null;
  setSelectedCompanyId: (id: string | null) => void;
  selectedClientId: string | null;
  setSelectedClientId: (id: string | null) => void;
  selectedClaimId: string | null;
  setSelectedClaimId: (id: string | null) => void;
  projectAddress: string;
  setProjectAddress: (addr: string) => void;
  /** Render Estimation Settings below the job fields (pages that place it elsewhere use EstimationSettings) */
  includeSettings?: boolean;
}

/** A labelled control on the sheet: grey label column, control beside it */
const FormRow: React.FC<{ label: React.ReactNode; htmlFor?: string; required?: boolean; children: React.ReactNode }> = ({
  label, htmlFor, required, children,
}) => (
  <div className="pk-form-row">
    <label className="pk-form-label" htmlFor={htmlFor}>
      {label}
      {required && <span className="pk-required" aria-hidden="true">*</span>}
    </label>
    <div className="pk-form-control">{children}</div>
  </div>
);

/** Crew, region, staging, storage and the adjustments, as labelled rows */
export const EstimationSettings: React.FC<{
  settings: PackingSettings;
  setSettings: (s: PackingSettings) => void;
}> = ({ settings, setSettings }) => {
  const patchSettings = (patch: Partial<PackingSettings>) =>
    setSettings({ ...settings, ...patch });

  return (
    <section className="ui-section pk-form-section" aria-label="Estimation Settings">
      <div className="ui-section-head"><h2 className="ui-section-title">Estimation Settings</h2></div>
      <FormRow label="Crew Size" htmlFor="pk-crew">
        <InputNumber
          id="pk-crew"
          min={2} max={6}
          value={settings.crew_size}
          onChange={v => patchSettings({ crew_size: v || 4 })}
          addonAfter="people"
          style={{ width: 160 }}
        />
      </FormRow>
      <FormRow label="Region" htmlFor="pk-region">
        <Select
          id="pk-region"
          value={settings.region}
          onChange={(v: Region) => patchSettings({ region: v })}
          style={{ width: '100%', maxWidth: 280 }}
        >
          {REGION_OPTIONS.map(r => (
            <Option key={r.value} value={r.value}>
              {r.label}
            </Option>
          ))}
        </Select>
      </FormRow>
      <FormRow label="Staging">
        <Segmented
          value={settings.staging_type}
          onChange={v => patchSettings({ staging_type: v as PackingSettings['staging_type'] })}
          options={[
            { value: 'off_site', label: 'Off-Site' },
            { value: 'on_site', label: 'On-Site' },
          ]}
        />
      </FormRow>
      <FormRow label="Storage Months" htmlFor="pk-storage">
        <InputNumber
          id="pk-storage"
          min={0} max={12}
          value={settings.storage_months}
          onChange={v => patchSettings({ storage_months: v || 0 })}
          addonAfter="months"
          style={{ width: 160 }}
        />
      </FormRow>
      <FormRow label="Include Pack-Back" htmlFor="pk-packback">
        <span className="pk-toggle">
          <Switch
            id="pk-packback"
            checked={settings.include_packback}
            onChange={v => patchSettings({ include_packback: v })}
            size="small"
          />
          <span className="pk-toggle-text">{settings.include_packback ? 'Included' : 'Not included'}</span>
        </span>
      </FormRow>
      <FormRow label="O&P" htmlFor="pk-op">
        <span className="pk-toggle">
          <Switch
            id="pk-op"
            checked={settings.include_op}
            onChange={v => patchSettings({ include_op: v })}
            size="small"
          />
          {settings.include_op ? (
            <InputNumber
              min={0} max={30} size="small"
              value={settings.op_rate}
              onChange={v => patchSettings({ op_rate: v || 0 })}
              addonAfter="%"
              style={{ width: 96 }}
              aria-label="O&P rate"
            />
          ) : <span className="pk-toggle-text">Off</span>}
        </span>
      </FormRow>
      <FormRow label="Contingency" htmlFor="pk-contingency">
        <span className="pk-toggle">
          <Switch
            id="pk-contingency"
            checked={settings.include_contingency}
            onChange={v => patchSettings({ include_contingency: v })}
            size="small"
          />
          {settings.include_contingency ? (
            <InputNumber
              min={0} max={20} size="small"
              value={settings.contingency_rate}
              onChange={v => patchSettings({ contingency_rate: v || 0 })}
              addonAfter="%"
              style={{ width: 96 }}
              aria-label="Contingency rate"
            />
          ) : <span className="pk-toggle-text">Off</span>}
        </span>
      </FormRow>
    </section>
  );
};

const DetailsStep: React.FC<DetailsStepProps> = ({
  settings, setSettings,
  selectedCompanyId, setSelectedCompanyId,
  selectedClientId, setSelectedClientId,
  selectedClaimId, setSelectedClaimId,
  projectAddress, setProjectAddress,
  includeSettings = true,
}) => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [claims, setClaims] = useState<any[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<any>(null);

  useEffect(() => {
    companyService.getCompanies().then(setCompanies).catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedClientId) {
      let current = true;
      clientService.getById(selectedClientId).then((client: any) => {
        if (!current) return;
        setClaims(client.claims || []);
        setSelectedClient(client);
        // Also when the client is switched from outside (From Claim)
        setClientSearch(client.display_name || '');
      }).catch(() => {});
      return () => { current = false; };
    } else {
      setClaims([]);
      setSelectedClaimId(null);
      setSelectedClient(null);
    }
  }, [selectedClientId, setSelectedClaimId]);

  const handleClientSearch = useCallback(async (value: string) => {
    setClientSearch(value);
    if (!value) {
      setSelectedClientId(null);
      setSelectedClient(null);
    }
    if (value.length >= 2) {
      try {
        const result = await clientService.search(value, 20);
        setClients(result.clients || []);
      } catch { setClients([]); }
    }
  }, [setSelectedClientId]);

  const handleClientSelect = useCallback((clientId: string) => {
    const client = clients.find((c: any) => c.id === clientId);
    if (client) {
      setSelectedClientId(clientId);
      setSelectedClient(client);
      if (client.address) {
        setProjectAddress(
          [client.address, client.city, client.state, client.zipcode]
            .filter(Boolean).join(', ')
        );
      }
      setClientSearch(client.display_name || '');
    }
  }, [clients, setSelectedClientId, setProjectAddress]);

  const clientContact = selectedClient
    ? [selectedClient.phone, selectedClient.email].filter(Boolean).join(' · ')
    : '';

  return (
    <div className="pk-details">
      <section className="ui-section pk-form-section" aria-label="Company & Client">
        <div className="ui-section-head"><h2 className="ui-section-title">Company &amp; Client</h2></div>
        <FormRow label="Company" htmlFor="pk-company" required>
          <Select
            id="pk-company"
            placeholder="Select company"
            value={selectedCompanyId || undefined}
            onChange={setSelectedCompanyId}
            showSearch
            optionFilterProp="children"
            style={{ width: '100%' }}
          >
            {companies.map(c => (
              <Option key={c.id} value={c.id}>
                {c.name}
              </Option>
            ))}
          </Select>
        </FormRow>
        <FormRow label="Client" htmlFor="pk-client">
          <AutoComplete
            id="pk-client"
            placeholder="Search client..."
            value={clientSearch}
            onSearch={handleClientSearch}
            onSelect={handleClientSelect}
            options={clients.map((c: any) => ({
              value: c.id,
              label: `${c.display_name} — ${c.address || ''}`,
            }))}
            allowClear
            onClear={() => {
              setSelectedClientId(null);
              setSelectedClient(null);
              setClientSearch('');
            }}
            style={{ width: '100%' }}
          />
          {selectedClient && (
            <span className="pk-form-meta">{clientContact || 'No phone or email on file'}</span>
          )}
        </FormRow>
        {claims.length > 0 && (
          <FormRow label="Claim (Optional)" htmlFor="pk-claim">
            <Select
              id="pk-claim"
              placeholder="Select claim"
              value={selectedClaimId || undefined}
              onChange={setSelectedClaimId}
              allowClear
              style={{ width: '100%' }}
            >
              {claims.map((cl: any) => (
                <Option key={cl.id} value={cl.id}>
                  {cl.claim_number} ({cl.insurance_company || 'N/A'})
                </Option>
              ))}
            </Select>
          </FormRow>
        )}
        <FormRow label="Property Address" htmlFor="pk-address">
          {claims.length > 0 ? (
            <AddressAutocomplete
              value={projectAddress}
              onChange={(val) => setProjectAddress(val)}
            />
          ) : (
            <Input
              id="pk-address"
              value={projectAddress}
              onChange={e => setProjectAddress(e.target.value)}
            />
          )}
        </FormRow>
      </section>

      {includeSettings && <EstimationSettings settings={settings} setSettings={setSettings} />}
    </div>
  );
};

export default DetailsStep;
