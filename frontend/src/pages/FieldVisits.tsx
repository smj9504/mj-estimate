/**
 * Field Visits: start from where you're standing, or carry on one already going.
 * A new client only needs its address; the visit opens straight after.
 */

import React, { useEffect, useState } from 'react';
import { Button, ConfigProvider, Input, Select, Skeleton } from 'antd';
import { AimOutlined, ReloadOutlined, RightOutlined, SearchOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { PageHeader, Pill } from '../components/common/ui';
import { AddressFields } from '../components/field-visit/FieldForms';
import { locate } from '../components/field-visit/locate';
import type { LocatedFix } from '../components/field-visit/locate';
import '../components/field-visit/field.css';
import '../components/onsite-signing/onsite.css';
import { clientService } from '../services/clientService';
import { fieldVisitService } from '../services/fieldVisitService';
import { comfortTheme } from '../styles/antTheme';
import type { FieldAddress } from '../types/fieldVisit';

type Finding = 'idle' | 'locating' | 'found' | 'no-number' | 'no-address' | 'denied' | 'no-fix';

// Only worth saying when the address may be someone else's
const VAGUE_ACCURACY_M = 60;

const NOTES: Partial<Record<Finding, string>> = {
  'no-number': 'Add the house number.',
  'no-address': "Couldn't find the address here.",
  denied: 'Location is off.',
  'no-fix': 'No location yet.',
};

const agoLabel = (iso: string | null) => {
  if (!iso) return '';
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / (60 * 24))}d ago`;
};

const NewClient: React.FC<{ onCancel: () => void }> = ({ onCancel }) => {
  const navigate = useNavigate();
  const [finding, setFinding] = useState<Finding>('idle');
  const [fix, setFix] = useState<LocatedFix | null>(null);
  const [address, setAddress] = useState<FieldAddress>({ street: '' });
  const [fromMap, setFromMap] = useState(false);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const companies = useQuery({ queryKey: ['field-companies'], queryFn: fieldVisitService.companies });
  const list = companies.data?.companies ?? [];
  useEffect(() => {
    if (companies.data && !companyId) setCompanyId(companies.data.default_id);
  }, [companies.data, companyId]);

  const find = async () => {
    setFinding('locating');
    setProblem(null);
    let position: LocatedFix;
    try {
      position = await locate();
    } catch (err: any) {
      setFinding(err.message === 'denied' ? 'denied' : 'no-fix');
      return;
    }
    setFix(position);
    try {
      const found = await fieldVisitService.addressHere(position.latitude, position.longitude);
      setAddress({ street: found.street, city: found.city, state: found.state, zipcode: found.zipcode });
      setFromMap(true);
      setFinding(found.has_number ? 'found' : 'no-number');
    } catch {
      setFinding('no-address');
    }
  };

  useEffect(() => {
    find();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async () => {
    const street = address.street.trim();
    if (!street) return;
    setSaving(true);
    setProblem(null);
    try {
      const visit = await fieldVisitService.start({
        address: { ...address, street, state: address.state?.trim().toUpperCase() },
        company_id: companyId,
        latitude: fix?.latitude,
        longitude: fix?.longitude,
        gps_accuracy: fix?.accuracy,
        altitude: fix?.altitude,
        altitude_accuracy: fix?.altitudeAccuracy,
      });
      navigate(`/field/${visit.id}`, { state: { existing: !visit.client_created } });
    } catch (err: any) {
      setProblem(err.response?.data?.detail || "Couldn't start. Check the signal and try again.");
      setSaving(false);
    }
  };

  // Asking for the number stops once it's been typed
  const note = finding === 'no-number' && /^\d/.test(address.street.trim()) ? undefined : NOTES[finding];
  const vague = fix && fix.accuracy > VAGUE_ACCURACY_M && (finding === 'found' || finding === 'no-number');

  return (
    <section className="fv-new" aria-label="New client">
      {finding === 'locating' && <Skeleton active title={false} paragraph={{ rows: 2 }} />}
      {finding !== 'locating' && (
        <>
          {(note || vague) && (
            <div className="fv-find-note" role="status">
              {note && <Pill tone="yellow">{note}</Pill>}
              {vague && <Pill tone="yellow">±{Math.round(fix.accuracy)} m</Pill>}
            </div>
          )}
          <AddressFields
            value={address}
            onChange={setAddress}
            focusStreet={finding === 'no-number' || finding === 'no-address' || finding === 'denied'}
          />
          {list.length > 1 && (
            <Select
              className="fv-company"
              aria-label="Company"
              value={companyId ?? undefined}
              placeholder="Company"
              options={list.map(company => ({ value: company.id, label: company.name }))}
              onChange={setCompanyId}
            />
          )}
          {problem && <div className="os-error" role="alert">{problem}</div>}
          <div className="fv-new-actions">
            <Button icon={<ReloadOutlined />} aria-label="Find again" onClick={find} />
            <Button onClick={onCancel}>Cancel</Button>
            <Button type="primary" loading={saving} disabled={!address.street.trim()} onClick={start}>
              Start
            </Button>
          </div>
          {fromMap && (
            <a
              className="fv-credit"
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
            >
              Address © OpenStreetMap contributors
            </a>
          )}
        </>
      )}
    </section>
  );
};

const FieldVisits: React.FC = () => {
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [startProblem, setStartProblem] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const visits = useQuery({ queryKey: ['field-visits'], queryFn: () => fieldVisitService.list() });
  const results = useQuery({
    queryKey: ['field-client-search', query],
    queryFn: () => clientService.search(query, 8),
    enabled: query.length >= 2,
  });
  const clients = results.data?.clients ?? [];

  const startFor = async (clientId: string) => {
    setStartProblem(null);
    try {
      const visit = await fieldVisitService.start({ client_id: clientId });
      navigate(`/field/${visit.id}`);
    } catch (err: any) {
      setStartProblem(err.response?.data?.detail || "Couldn't start. Check the signal and try again.");
    }
  };

  return (
    <ConfigProvider theme={comfortTheme} componentSize="large">
      <div className="os-page fv-page">
        <PageHeader title="Field visits" />

        {adding ? (
          <NewClient onCancel={() => setAdding(false)} />
        ) : (
          <Button type="primary" block className="fv-main-btn" icon={<AimOutlined />} onClick={() => setAdding(true)}>
            New client here
          </Button>
        )}

        <Input
          className="fv-search"
          prefix={<SearchOutlined aria-hidden="true" />}
          placeholder="Existing client"
          aria-label="Search clients"
          value={search}
          allowClear
          onChange={event => setSearch(event.target.value)}
        />
        {startProblem && <div className="os-error" role="alert">{startProblem}</div>}
        {query.length >= 2 && clients.length > 0 && (
          <ul className="os-rows fv-rows">
            {clients.map(client => (
              <li key={client.id}>
                <button type="button" className="os-row" onClick={() => startFor(client.id)}>
                  <span className="os-row-body">
                    <span className="os-row-title">{client.display_name}</span>
                    <span className="os-row-meta">{[client.address, client.city].filter(Boolean).join(', ')}</span>
                  </span>
                  <RightOutlined className="os-row-go" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {query.length >= 2 && !results.isFetching && !results.isError && clients.length === 0 && (
          <div className="os-empty">No client matches &ldquo;{query}&rdquo;.</div>
        )}

        {query.length < 2 && (
          <section className="ui-section fv-recent">
            <div className="ui-section-head">
              <h2 className="ui-section-title">Recent</h2>
            </div>
            {visits.isLoading && <Skeleton active title={false} paragraph={{ rows: 3 }} />}
            {visits.isError && (
              <div className="os-error" role="alert">
                Couldn&apos;t load visits.
                <Button size="small" onClick={() => visits.refetch()}>Try again</Button>
              </div>
            )}
            {visits.data?.length === 0 && <p className="os-note">No visits yet.</p>}
            {!!visits.data?.length && (
              <ul className="os-rows fv-rows">
                {visits.data.map(visit => (
                  <li key={visit.id}>
                    <button type="button" className="os-row" onClick={() => navigate(`/field/${visit.id}`)}>
                      <span className="os-row-body">
                        <span className="os-row-title">{visit.address || visit.client_name}</span>
                        <span className="os-row-meta">
                          {[
                            visit.client_name !== visit.address && visit.client_name !== visit.address.split(',')[0]
                              ? visit.client_name
                              : null,
                            `${visit.shot_count} ${visit.shot_count === 1 ? 'photo' : 'photos'}`,
                            agoLabel(visit.last_activity_at),
                          ].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <RightOutlined className="os-row-go" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </ConfigProvider>
  );
};

export default FieldVisits;
