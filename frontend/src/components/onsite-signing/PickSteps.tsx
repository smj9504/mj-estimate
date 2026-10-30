/**
 * The steps that choose what's being signed: whose it is, what it's for, which
 * company it's from and, when that company has more than one, which document.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Input, Skeleton } from 'antd';
import { RightOutlined, SearchOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import AddressAutocomplete, { type ParsedAddress } from '../common/AddressAutocomplete';
import { PageHeader } from '../common/ui';
import { CompanyName } from '../packing-estimate/packingUi';
import { clientService } from '../../services/clientService';
import { onsiteSigningService } from '../../services/contractService';
import { SIGNING_PURPOSES } from '../../types/contract';
import type { ClientListItem } from '../../types/client';
import type { OnsiteAddress, OnsiteCompany, SigningPurpose } from '../../types/contract';

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  authorization: 'Authorization',
  certificate_of_satisfaction: 'Certificate of Satisfaction',
  certificate_of_completion: 'Certificate of Completion',
  scope_of_work: 'Scope of Work',
  lien_waiver: 'Lien Waiver',
  change_order: 'Change Order',
  other: 'Other',
};

const addressLine = (client: ClientListItem) =>
  [client.address, client.city, client.state].filter(Boolean).join(', ');

export const LoadError: React.FC<{ what: string; onRetry: () => void }> = ({ what, onRetry }) => (
  <div className="os-error" role="alert">
    Couldn&apos;t load {what}.
    <Button size="small" onClick={onRetry}>Try again</Button>
  </div>
);

// ── Whose it is ─────────────────────────────────────

export const ClientStep: React.FC<{
  onClient: (client: ClientListItem) => void;
  onAddress: (address: OnsiteAddress) => void;
}> = ({ onClient, onAddress }) => {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [addressOpen, setAddressOpen] = useState(false);
  const [addressText, setAddressText] = useState('');
  const [picked, setPicked] = useState<ParsedAddress | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const results = useQuery({
    queryKey: ['onsite-client-search', query],
    queryFn: () => clientService.search(query, 10),
    enabled: query.length >= 2,
  });
  const clients = results.data?.clients ?? [];
  const noMatch = query.length >= 2 && !results.isFetching && !results.isError && clients.length === 0;

  const openAddress = () => {
    // What they searched for is often the address already
    if (!addressText && /^\d/.test(search.trim())) setAddressText(search.trim());
    setAddressOpen(true);
  };

  const submitAddress = () => {
    const text = addressText.trim();
    if (!text) return;
    onAddress(picked
      ? { street: picked.streetAddress, city: picked.city, state: picked.state, zipcode: picked.zip }
      : { street: text });
  };

  return (
    <>
      <PageHeader title="Who is this for?" meta="Search your clients, or start from the address." />
      <Input
        className="os-search"
        prefix={<SearchOutlined aria-hidden="true" />}
        placeholder="Name, address, phone or email"
        aria-label="Search clients"
        value={search}
        onChange={e => setSearch(e.target.value)}
        allowClear
        autoFocus
      />

      {results.isFetching && <Skeleton active title={false} paragraph={{ rows: 3 }} />}
      {results.isError && <LoadError what="clients" onRetry={() => results.refetch()} />}
      {!results.isFetching && clients.length > 0 && (
        <ul className="os-rows">
          {clients.map(client => (
            <li key={client.id}>
              <button type="button" className="os-row" onClick={() => onClient(client)}>
                <span className="os-row-body">
                  <span className="os-row-title">{client.display_name}</span>
                  {addressLine(client) && <span className="os-row-meta">{addressLine(client)}</span>}
                </span>
                <RightOutlined className="os-row-go" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {noMatch && <div className="os-empty">No client matches &ldquo;{query}&rdquo;.</div>}

      {addressOpen ? (
        <div className="os-address">
          <h2 className="os-address-title">Start with the address</h2>
          <p className="os-lead">The client is created when the contract is signed.</p>
          <AddressAutocomplete
            value={addressText}
            onChange={value => {
              setAddressText(value);
              setPicked(null);
            }}
            onSelect={setPicked}
            placeholder="Street address"
            size="large"
            aria-label="Street address"
            onPressEnter={submitAddress}
          />
          <div className="os-actions">
            <div className="os-actions-end">
              <Button type="primary" disabled={!addressText.trim()} onClick={submitAddress}>Continue</Button>
            </div>
          </div>
        </div>
      ) : (
        <Button className="os-address-toggle" onClick={openAddress}>Start with an address instead</Button>
      )}
    </>
  );
};

// ── What it's for ───────────────────────────────────

export const PurposeStep: React.FC<{
  leading: React.ReactNode;
  trail: React.ReactNode;
  backRow: React.ReactNode;
  onPick: (purpose: SigningPurpose) => void;
}> = ({ leading, trail, backRow, onPick }) => (
  <>
    <PageHeader leading={leading} title="What is the customer signing?" meta={trail} />
    <div className="os-cards">
      {SIGNING_PURPOSES.map(purpose => (
        <button key={purpose.value} type="button" className="os-card" onClick={() => onPick(purpose.value)}>
          <span className="os-card-title">{purpose.label}</span>
          <span className="os-card-text">{purpose.description}</span>
        </button>
      ))}
    </div>
    {backRow}
  </>
);

// ── Which company ───────────────────────────────────

export const CompanyStep: React.FC<{
  leading: React.ReactNode;
  trail: React.ReactNode;
  backRow: React.ReactNode;
  purpose: SigningPurpose;
  onPick: (company: OnsiteCompany) => void;
}> = ({ leading, trail, backRow, purpose, onPick }) => {
  const companies = useQuery({
    queryKey: ['onsite-companies', purpose],
    queryFn: () => onsiteSigningService.getCompanies(purpose),
  });
  const list = companies.data?.companies ?? [];
  const label = useMemo(() => SIGNING_PURPOSES.find(p => p.value === purpose)?.label, [purpose]);

  return (
    <>
      <PageHeader leading={leading} title="Which company is it from?" meta={trail} />
      {companies.isLoading && <Skeleton active title={false} paragraph={{ rows: 3 }} />}
      {companies.isError && <LoadError what="companies" onRetry={() => companies.refetch()} />}
      {companies.isSuccess && list.length === 0 && (
        <div className="os-empty">
          <strong>None of your companies has a {label} document to sign.</strong>
          An admin can set one up in Contract Templates, or add you to the company.
        </div>
      )}
      {list.length > 0 && (
        <ul className="os-rows">
          {list.map(company => (
            <li key={company.id}>
              <button type="button" className="os-row" onClick={() => onPick(company)}>
                <span className="os-row-body">
                  <CompanyName id={company.id} name={company.name} />
                </span>
                <RightOutlined className="os-row-go" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {backRow}
    </>
  );
};

// ── Which document ──────────────────────────────────

export const DocumentStep: React.FC<{
  leading: React.ReactNode;
  trail: React.ReactNode;
  backRow: React.ReactNode;
  company: OnsiteCompany;
  onPick: (templateId: string) => void;
}> = ({ leading, trail, backRow, company, onPick }) => (
  <>
    <PageHeader leading={leading} title="Which document?" meta={trail} />
    <ul className="os-rows">
      {company.templates.map(template => (
        <li key={template.id}>
          <button type="button" className="os-row" onClick={() => onPick(template.id)}>
            <span className="os-row-body">
              <span className="os-row-title">{template.name}</span>
              <span className="os-row-meta">
                {DOCUMENT_TYPE_LABELS[template.document_type] || template.document_type}
              </span>
            </span>
            <RightOutlined className="os-row-go" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
    {backRow}
  </>
);
