/**
 * After signing: the PDFs, where they landed, and emailing them, all of a
 * visit's contracts in one email. Email is only offered when every mapped field
 * was filled; otherwise it says what was skipped instead of offering something
 * that would be refused.
 */

import React, { useState } from 'react';
import { Button, Input, message } from 'antd';
import { FilePdfOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { PageHeader, Pill, PropertyList } from '../common/ui';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../services/api';
import { onsiteSigningService } from '../../services/contractService';
import type { OnsiteSignedContract } from '../../types/contract';

const DoneStep: React.FC<{
  result: OnsiteSignedContract;
  signerName: string;
  onStartOver: () => void;
}> = ({ result, signerName, onStartOver }) => {
  const { canAccessPath } = useAuth();
  const [email, setEmail] = useState(result.client_email);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string[] | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const { contracts } = result;
  const several = contracts.length > 1;
  const noPdf = contracts.filter(c => !c.pdf_ready);
  const missing = [...new Set(contracts.flatMap(c => c.missing_fields))];

  const send = async () => {
    const emails = email.split(/[,;\s]+/).map(e => e.trim()).filter(e => e.includes('@'));
    if (emails.length === 0) {
      setEmailError('Enter an email address.');
      return;
    }
    setSending(true);
    setEmailError(null);
    try {
      const sent = await onsiteSigningService.email(contracts.map(c => c.contract_id), emails);
      setSentTo(sent.emails);
      message.success(several ? 'Signed contracts sent' : 'Signed contract sent');
    } catch (err: any) {
      setEmailError(err.response?.data?.detail || "Couldn't send the email. Try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <PageHeader title="Signed" meta={several ? `${contracts.length} contracts` : contracts[0]?.title} />

      {noPdf.length > 0 && (
        <div className="os-warning" role="alert">
          {several
            ? `The signatures are saved, but the PDF for ${noPdf.map(c => c.title).join(', ')} couldn't be made.`
            : 'The signature is saved, but the PDF couldn’t be made.'}
          {' '}Let the office know.
        </div>
      )}
      {!result.office_notified && (
        <div className="os-warning" role="alert">
          The office wasn&apos;t notified automatically.
          {' '}Let them know {several ? 'these contracts need' : 'this contract needs'} a claim.
        </div>
      )}

      <PropertyList
        labelWidth={120}
        items={[
          {
            key: 'client',
            label: 'Client',
            value: (
              <>
                {canAccessPath('/clients')
                  ? <Link className="ui-ink-link" to={`/clients/${result.client_id}`}>{result.client_name}</Link>
                  : result.client_name}
                {result.client_created && <Pill tone="blue" style={{ marginLeft: 8 }}>New client</Pill>}
              </>
            ),
          },
          { key: 'signer', label: 'Signed by', value: signerName },
          ...contracts.map((contract, index) => ({
            key: contract.contract_id,
            label: several ? `Contract ${index + 1}` : 'Contract',
            value: several ? `${contract.contract_number ?? ''} · ${contract.title ?? ''}` : contract.contract_number,
          })),
        ]}
      />
      {result.office_notified && (
        <p className="os-note">
          A todo to put {several ? 'these contracts' : 'this contract'} on a claim is on your board,
          and the office has been told.
        </p>
      )}

      <div className="os-done-actions">
        {contracts.filter(c => c.pdf_ready).map(contract => (
          <Button
            key={contract.contract_id}
            icon={<FilePdfOutlined />}
            href={`${api.defaults.baseURL || ''}${contract.pdf_url}`}
            target="_blank"
          >
            {several ? contract.title : 'View signed PDF'}
          </Button>
        ))}
        <Button onClick={onStartOver}>Start another</Button>
      </div>

      <section className="ui-section os-email">
        <div className="ui-section-head">
          <h2 className="ui-section-title">{several ? 'Email copies' : 'Email a copy'}</h2>
        </div>
        {missing.length > 0 ? (
          <p className="os-note">
            Email is only available when every field is filled. Skipped: {missing.join(', ')}.
          </p>
        ) : noPdf.length > 0 ? (
          <p className="os-note">Email will be available once the PDFs are made.</p>
        ) : sentTo ? (
          <p className="os-note">Sent to {sentTo.join(', ')}.</p>
        ) : (
          <>
            {several && <p className="os-lead">The {contracts.length} signed PDFs go in one email.</p>}
            <div className="os-email-row">
              <Input
                type="email"
                inputMode="email"
                autoCapitalize="off"
                aria-label="Email address"
                placeholder="customer@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onPressEnter={send}
                disabled={sending}
              />
              <Button type="primary" loading={sending} onClick={send}>Send</Button>
            </div>
            {emailError && <div className="os-error" role="alert">{emailError}</div>}
          </>
        )}
      </section>
    </>
  );
};

export default DoneStep;
