/**
 * What the template maps. A phone asks one thing per screen, with a list at the
 * end to check it and jump back to any line; anything bigger gets one form.
 * Anything can be left blank, and it says so up front, because a skipped field
 * is what later keeps the signed copy from being emailed.
 */

import React, { useEffect, useRef } from 'react';
import { Button, DatePicker, Input } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import AddressAutocomplete, { type ParsedAddress } from '../common/AddressAutocomplete';
import { PageHeader, Pill, useSheetModal } from '../common/ui';
import type { OnsiteQuestion } from '../../types/contract';

const DATE_FORMAT = 'MM/DD/YYYY';

export type Answers = Record<string, string>;

const formatAddress = (a: ParsedAddress) =>
  [a.streetAddress, a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');

/** Picking an address fills its other parts where the template asks for them */
const withAddress = (answers: Answers, key: string, address: ParsedAddress): Answers => {
  const next = { ...answers, [key]: key === 'client.address' ? address.streetAddress : formatAddress(address) };
  if (key.startsWith('client.')) {
    const parts: Answers = {
      'client.full_address': formatAddress(address),
      'client.address': address.streetAddress,
      'client.city': address.city,
      'client.state': address.state,
      'client.zipcode': address.zip,
    };
    Object.entries(parts).forEach(([part, value]) => {
      if (part in answers) next[part] = value;
    });
  }
  return next;
};

const QuestionInput: React.FC<{
  id: string;
  question: OnsiteQuestion;
  answers: Answers;
  autoFocus?: boolean;
  onAnswers: (answers: Answers) => void;
  onEnter?: () => void;
}> = ({ id, question, answers, autoFocus, onAnswers, onEnter }) => {
  const { key, kind, label } = question;
  const value = answers[key] ?? '';
  const set = (next: string) => onAnswers({ ...answers, [key]: next });

  if (kind === 'date') {
    const parsed = value ? dayjs(value, DATE_FORMAT) : null;
    return (
      <DatePicker
        id={id}
        className="os-control"
        format={DATE_FORMAT}
        value={parsed?.isValid() ? parsed : null}
        onChange={date => set(date ? date.format(DATE_FORMAT) : '')}
        inputReadOnly
        autoFocus={autoFocus}
      />
    );
  }
  if (kind === 'address') {
    return (
      <AddressAutocomplete
        id={id}
        value={value}
        onChange={set}
        onSelect={address => onAnswers(withAddress(answers, key, address))}
        placeholder={label}
        size="large"
        autoFocus={autoFocus}
        onPressEnter={onEnter}
      />
    );
  }
  return (
    <Input
      id={id}
      value={value}
      onChange={e => set(e.target.value)}
      onPressEnter={onEnter}
      autoFocus={autoFocus}
      {...(kind === 'phone' ? { type: 'tel', inputMode: 'tel' as const, autoComplete: 'tel' } : {})}
      {...(kind === 'email' ? { type: 'email', inputMode: 'email' as const, autoCapitalize: 'off', autoComplete: 'email' } : {})}
    />
  );
};

const SkippedNote: React.FC<{ count: number }> = ({ count }) => (
  count > 0 ? (
    <p className="os-note">
      {count === 1 ? '1 field is blank and stays' : `${count} fields are blank and stay`} blank on the document.
      The signed copy can only be emailed from here when every field is filled.
    </p>
  ) : null
);

interface FieldsStepProps {
  questions: OnsiteQuestion[];
  answers: Answers;
  onAnswers: (answers: Answers) => void;
  trail: React.ReactNode;
  /** The screen within this step on a phone: a question's index, or the review list */
  screen: number | 'review';
  fromReview: boolean;
  onShow: (screen: number | 'review', fromReview?: boolean) => void;
  onBack: () => void;
  onDone: () => void;
}

const FieldsStep: React.FC<FieldsStepProps> = ({
  questions, answers, onAnswers, trail, screen, fromReview, onShow, onBack, onDone,
}) => {
  const { isPhone } = useSheetModal();
  const blank = questions.filter(q => !(answers[q.key] ?? '').trim()).length;

  // A template that needs nothing typed has nothing to show here
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (questions.length === 0) done.current();
  }, [questions.length]);
  if (questions.length === 0) return null;

  if (!isPhone) {
    return (
      <>
        <PageHeader
          leading={<Button type="text" icon={<ArrowLeftOutlined />} aria-label="Back" onClick={onBack} />}
          title="Fill in the contract"
          meta={trail}
        />
        <p className="os-lead">Leave anything you don&apos;t have yet blank.</p>
        {questions.map((question, index) => (
          <div key={question.key} className="os-field">
            <label className="os-field-label" htmlFor={`os-q-${question.key}`}>{question.label}</label>
            <QuestionInput
              id={`os-q-${question.key}`}
              question={question}
              answers={answers}
              onAnswers={onAnswers}
              autoFocus={index === 0}
            />
          </div>
        ))}
        <SkippedNote count={blank} />
        <div className="os-actions">
          <div className="os-actions-end">
            <Button type="primary" onClick={onDone}>Review and sign</Button>
          </div>
        </div>
      </>
    );
  }

  if (screen === 'review') {
    return (
      <>
        <PageHeader title="Check the details" meta="Tap a line to change it." />
        <div className="os-review">
          {questions.map((question, index) => {
            const value = (answers[question.key] ?? '').trim();
            return (
              <button
                key={question.key}
                type="button"
                className="os-review-row"
                onClick={() => onShow(index, true)}
              >
                <span className="os-review-label">{question.label}</span>
                <span className="os-review-value">
                  {value || <Pill tone="yellow">Skipped</Pill>}
                </span>
              </button>
            );
          })}
        </div>
        <SkippedNote count={blank} />
        <div className="os-actions">
          <Button onClick={onBack}>Back</Button>
          <div className="os-actions-end">
            <Button type="primary" onClick={onDone}>Review and sign</Button>
          </div>
        </div>
      </>
    );
  }

  const index = Math.min(screen, questions.length - 1);
  const question = questions[index];
  const hasValue = !!(answers[question.key] ?? '').trim();

  const next = () => {
    // Back to the list they came from, without stacking up another copy of it
    if (fromReview) onBack();
    else onShow(index + 1 < questions.length ? index + 1 : 'review');
  };

  return (
    <div key={question.key}>
      <PageHeader
        title={<label htmlFor={`os-q-${question.key}`}>{question.label}</label>}
        meta={<span className="os-count">{index + 1} of {questions.length}</span>}
      />
      <QuestionInput
        id={`os-q-${question.key}`}
        question={question}
        answers={answers}
        onAnswers={onAnswers}
        autoFocus={question.kind !== 'date'}
        onEnter={hasValue ? next : undefined}
      />
      <div className="os-actions">
        {/* From the list, Done is the way back and keeps the edit */}
        {!fromReview && <Button onClick={onBack}>Back</Button>}
        <div className="os-actions-end">
          <Button type={hasValue || fromReview ? 'primary' : 'default'} onClick={next}>
            {fromReview ? 'Done' : hasValue ? 'Next' : 'Skip'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default FieldsStep;
