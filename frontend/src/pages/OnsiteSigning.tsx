/**
 * On-site Signing: find the client or start from an address, pick what the
 * document is for and which company it's from, fill in what the template maps,
 * and have the customer sign. Nothing is saved before that last step.
 *
 * The step lives in the URL so a phone's back gesture steps back through the
 * flow instead of leaving it, and the state lives here so going back keeps what
 * was entered. The visit is drafted to this tab's storage so a reload or a
 * discarded tab doesn't lose it (signatures aren't kept: the customer signs
 * again), and leaving for another page asks first.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, ConfigProvider, Modal, Skeleton } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useBlocker, useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import DoneStep from '../components/onsite-signing/DoneStep';
import FieldsStep, { type Answers } from '../components/onsite-signing/FieldsStep';
import { ClientStep, CompanyStep, DocumentStep, LoadError, PurposeStep } from '../components/onsite-signing/PickSteps';
import SignStep from '../components/onsite-signing/SignStep';
import { useSheetModal } from '../components/common/ui';
import '../components/onsite-signing/onsite.css';
import { onsiteSigningService } from '../services/contractService';
import { comfortTheme } from '../styles/antTheme';
import { SIGNING_PURPOSES } from '../types/contract';
import type { ClientListItem } from '../types/client';
import type { OnsiteAddress, OnsiteCompany, OnsiteSignedContract, SigningPurpose } from '../types/contract';

type Step = 'client' | 'purpose' | 'company' | 'document' | 'fields' | 'sign';

type Subject =
  | { kind: 'client'; client: ClientListItem }
  | { kind: 'address'; address: OnsiteAddress };

interface Draft {
  subject: Subject | null;
  purpose: SigningPurpose | null;
  company: OnsiteCompany | null;
  templateId: string | null;
  answers: Answers;
}

const DRAFT_KEY = 'onsite-signing-draft';

const readDraft = (): Partial<Draft> => {
  try {
    return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '{}');
  } catch {
    return {};
  }
};

const writeDraft = (draft: Draft | null) => {
  try {
    if (draft) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Storage is off or full; the visit just won't survive a reload
  }
};

const OnsiteSigning: React.FC = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { isPhone, sheetProps } = useSheetModal();

  // A step in the URL means this tab was already mid-visit; otherwise it's a new one
  const [draft] = useState<Partial<Draft>>(() => (params.get('step') ? readDraft() : {}));
  const [subject, setSubject] = useState<Subject | null>(draft.subject ?? null);
  const [purpose, setPurpose] = useState<SigningPurpose | null>(draft.purpose ?? null);
  const [company, setCompany] = useState<OnsiteCompany | null>(draft.company ?? null);
  const [templateId, setTemplateId] = useState<string | null>(draft.templateId ?? null);
  const [answers, setAnswers] = useState<Answers>(draft.answers ?? {});
  const [result, setResult] = useState<OnsiteSignedContract | null>(null);
  const [signerName, setSignerName] = useState('');
  // The device's date: an evening signing must not be dated tomorrow in UTC
  const today = useMemo(() => dayjs().format('MM/DD/YYYY'), []);

  useEffect(() => {
    writeDraft(subject && !result ? { subject, purpose, company, templateId, answers } : null);
  }, [subject, purpose, company, templateId, answers, result]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => (
    !!subject && !result && currentLocation.pathname !== nextLocation.pathname
  ));

  const clientId = subject?.kind === 'client' ? subject.client.id : undefined;
  const address = subject?.kind === 'address' ? subject.address : undefined;

  const requested = (params.get('step') as Step | null) ?? 'client';
  const available: Record<Step, boolean> = {
    client: true,
    purpose: !!subject,
    company: !!subject && !!purpose,
    document: !!subject && !!company,
    fields: !!subject && !!templateId,
    sign: !!subject && !!templateId,
  };
  const step: Step = available[requested] ? requested : 'client';

  const go = (next: Step, extra: Record<string, string> = {}) => setParams({ step: next, ...extra });
  const back = () => navigate(-1);

  const form = useQuery({
    queryKey: ['onsite-form', templateId, company?.id, clientId, address],
    queryFn: () => onsiteSigningService.getForm({
      template_id: templateId as string,
      company_id: (company as OnsiteCompany).id,
      client_id: clientId,
      address,
    }),
    enabled: !!templateId && !!company && !!subject,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  // Start from what's on record, keeping anything already typed for this visit
  const questions = form.data?.questions;
  useEffect(() => {
    if (!questions) return;
    setAnswers(prev => Object.fromEntries(questions.map(q => [q.key, prev[q.key] ?? q.value ?? ''])));
  }, [questions]);

  const pickClient = (client: ClientListItem) => {
    setSubject({ kind: 'client', client });
    setAnswers({});
    go('purpose');
  };
  const pickAddress = (next: OnsiteAddress) => {
    setSubject({ kind: 'address', address: next });
    setAnswers({});
    go('purpose');
  };
  const pickPurpose = (next: SigningPurpose) => {
    setPurpose(next);
    setCompany(null);
    setTemplateId(null);
    go('company');
  };
  const pickCompany = (next: OnsiteCompany) => {
    setCompany(next);
    if (next.templates.length === 1) {
      setTemplateId(next.templates[0].id);
      go('fields');
    } else {
      setTemplateId(null);
      go('document');
    }
  };
  const pickTemplate = (id: string) => {
    setTemplateId(id);
    go('fields');
  };

  const startOver = () => {
    setSubject(null);
    setPurpose(null);
    setCompany(null);
    setTemplateId(null);
    setAnswers({});
    setResult(null);
    setSignerName('');
    setParams({}, { replace: true });
  };

  // What's been chosen so far, so the person can see they're on the right visit
  const subjectLabel = subject?.kind === 'client' ? subject.client.display_name : subject?.address.street;
  const templateName = company?.templates.find(t => t.id === templateId)?.name;
  const trail = (
    <span className="os-trail">
      {[
        subjectLabel,
        SIGNING_PURPOSES.find(p => p.value === purpose)?.label,
        step === 'company' ? null : company?.name,
        step === 'document' ? null : templateName,
      ].filter(Boolean).join(' · ')}
    </span>
  );

  // One Back on a phone, in the row of actions under the work, within reach
  const backButton = isPhone
    ? undefined
    : <Button type="text" icon={<ArrowLeftOutlined />} aria-label="Back" onClick={back} />;
  const backRow = isPhone ? <div className="os-actions"><Button onClick={back}>Back</Button></div> : null;

  // Each screen starts at the top; a long document leaves the page far down
  const screenKey = `${result ? 'done' : step}:${params.get('q') ?? ''}`;
  const lastScreen = useRef(screenKey);
  useEffect(() => {
    if (lastScreen.current === screenKey) return;
    lastScreen.current = screenKey;
    window.scrollTo(0, 0);
  }, [screenKey]);

  const screen = params.get('q');

  const renderStep = () => {
    if (result) {
      return <DoneStep result={result} signerName={signerName} onStartOver={startOver} />;
    }
    switch (step) {
      case 'purpose':
        return <PurposeStep leading={backButton} trail={trail} backRow={backRow} onPick={pickPurpose} />;
      case 'company':
        return (
          <CompanyStep
            leading={backButton}
            trail={trail}
            backRow={backRow}
            purpose={purpose as SigningPurpose}
            onPick={pickCompany}
          />
        );
      case 'document':
        return (
          <DocumentStep
            leading={backButton}
            trail={trail}
            backRow={backRow}
            company={company as OnsiteCompany}
            onPick={pickTemplate}
          />
        );
      case 'fields':
      case 'sign':
        if (form.isLoading) return <Skeleton active paragraph={{ rows: 4 }} />;
        if (form.isError || !form.data) {
          return <LoadError what="the contract's fields" onRetry={() => form.refetch()} />;
        }
        if (step === 'fields') {
          return (
            <FieldsStep
              questions={form.data.questions}
              answers={answers}
              onAnswers={setAnswers}
              trail={trail}
              screen={screen === 'review' ? 'review' : Number(screen ?? 0) || 0}
              fromReview={params.get('from') === 'review'}
              onShow={(next, fromReview) => go('fields', {
                q: String(next),
                ...(fromReview ? { from: 'review' } : {}),
              })}
              onBack={back}
              onDone={() => setParams({ step: 'sign' }, { replace: form.data.questions.length === 0 })}
            />
          );
        }
        return (
          <SignStep
            leading={backButton}
            onBack={back}
            form={form.data}
            companyId={(company as OnsiteCompany).id}
            clientId={clientId}
            address={address}
            answers={answers}
            today={today}
            onSigned={(signed, name) => {
              setSignerName(name);
              setResult(signed);
            }}
          />
        );
      default:
        return <ClientStep onClient={pickClient} onAddress={pickAddress} />;
    }
  };

  return (
    <ConfigProvider theme={comfortTheme} componentSize="large">
      <div className={`os-page${step === 'sign' && !result ? ' os-page--wide' : ''}`}>
        {renderStep()}
      </div>
      <Modal
        {...sheetProps}
        open={blocker.state === 'blocked'}
        title="Leave this signing?"
        okText="Leave"
        cancelText="Stay"
        okButtonProps={{ danger: true }}
        onOk={() => {
          writeDraft(null);
          blocker.proceed?.();
        }}
        onCancel={() => blocker.reset?.()}
      >
        What you&apos;ve entered is lost, because nothing is saved until the customer signs.
      </Modal>
    </ConfigProvider>
  );
};

export default OnsiteSigning;
