/**
 * SameCustomerLeads — the Lead jobs already here for the customer the job form
 * is about to make a job for (same phone, email or address). Shown before the
 * job is made, so someone can use the Lead instead of making a second one.
 * Styles: `scl-*` in sameCustomerLeads.css.
 */

import React from 'react';
import { Button } from 'antd';
import { ExportOutlined } from '@ant-design/icons';
import { Pill } from '../common/ui';
import { WMStatusPill } from './wmStatus';
import type { SameCustomerLead, SameCustomerReason } from '../../types/waterMitigation';
import './sameCustomerLeads.css';

const REASON_LABEL: Record<SameCustomerReason, string> = {
  phone: 'Same phone',
  email: 'Same email',
  address: 'Same address',
};

interface SameCustomerLeadsProps {
  leads: SameCustomerLead[];
  /** The Lead being used right now, while that saves */
  usingId?: string;
  disabled?: boolean;
  onUse: (lead: SameCustomerLead) => void;
}

const where = (lead: SameCustomerLead) => {
  if (!lead.sheet_name) return null;
  return lead.row_number ? `${lead.sheet_name} row ${lead.row_number}` : `Was on ${lead.sheet_name}`;
};

const SameCustomerLeads: React.FC<SameCustomerLeadsProps> = ({ leads, usingId, disabled, onUse }) => (
  <div className="scl">
    <p className="scl-lead">
      {leads.length === 1
        ? 'A Lead job already here has this customer\'s phone, email or address. Use it instead of making a second job, unless this is a different job.'
        : `${leads.length} Lead jobs already here have this customer's phone, email or address. Use one of them instead of making another, unless this is a different job.`}
    </p>

    <ul className="scl-list">
      {leads.map(lead => {
        const contact = [lead.homeowner_phone, lead.homeowner_email].filter(Boolean).join(' · ');
        const facts = [
          where(lead),
          lead.photo_count > 0 ? `${lead.photo_count} ${lead.photo_count === 1 ? 'photo' : 'photos'}` : null,
          lead.claim_number ? `Claim ${lead.claim_number}` : null,
        ].filter(Boolean).join(' · ');
        return (
          <li key={lead.id} className="scl-item">
            <div className="scl-main">
              <div className="scl-name">
                <span>{lead.homeowner_name || lead.property_address}</span>
                {lead.status && <WMStatusPill status={lead.status} />}
                <a
                  href={`/water-mitigation/${lead.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="scl-open"
                  aria-label="Open this job in a new tab"
                >
                  <ExportOutlined aria-hidden="true" />
                </a>
              </div>
              {lead.homeowner_name && <div className="scl-line">{lead.property_address}</div>}
              {contact && <div className="scl-line">{contact}</div>}
              {facts && <div className="scl-line scl-facts">{facts}</div>}
              <div className="scl-tags">
                {lead.reasons.map(reason => (
                  <Pill key={reason} tone="orange">{REASON_LABEL[reason]}</Pill>
                ))}
              </div>
            </div>
            <Button
              className="scl-use"
              onClick={() => onUse(lead)}
              loading={usingId === lead.id}
              disabled={disabled && usingId !== lead.id}
            >
              Use this job
            </Button>
          </li>
        );
      })}
    </ul>

    <p className="scl-note">
      Using a job adds what you typed where that job has nothing yet. Its address and anything
      already filled in stay as they are.
    </p>
  </div>
);

export default SameCustomerLeads;
