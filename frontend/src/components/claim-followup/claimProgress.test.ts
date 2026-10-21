import { describe, expect, it } from 'vitest';
import { buildClaimProgress, type ClaimProgressInput } from './claimProgress';
import type { FollowUpTask } from '../../types/claimFollowUp';

const task = (fields: Partial<FollowUpTask>): FollowUpTask => ({
  id: fields.task_type || 'task',
  claim_id: 'claim-1',
  title: 'Task',
  status: 'pending',
  assigned_to_role: 'adjuster',
  ...fields,
} as FollowUpTask);

const progress = (input: Partial<ClaimProgressInput>) => {
  const { track } = buildClaimProgress({
    tasks: [],
    supplementStatuses: {},
    bidEstimateSummary: {},
    hasInsuranceEstimate: false,
    wmCostStatus: '',
    ...input,
  });
  return Object.fromEntries(track.map(s => [s.key, s]));
};

describe('buildClaimProgress estimate paths', () => {
  it('shows a WM invoice paid as billed without waiting on a WM estimate', () => {
    const steps = progress({
      tasks: [task({ task_type: 'wm_docs_sent', status: 'resolved' })],
      wmCostStatus: 'paid_per_invoice',
    });
    expect(steps.wm_payment.state).toBe('todo');
    expect(steps.wm_payment.detail).toBe('Invoice approved');
    expect(steps.wm_payment.note).toBe('Paid per our invoice, no WM estimate');
    // Only the rebuild estimate is still to come
    expect(steps.estimate.state).toBe('waiting');
    expect(steps.estimate.detail).toBe('Awaiting rebuild estimate');
  });

  it('keeps the payment note over the paid-per-invoice note', () => {
    const steps = progress({
      tasks: [task({ task_type: 'wm_payment_check', payment_note: 'Check mailed 10/20' })],
      wmCostStatus: 'paid_per_invoice',
    });
    expect(steps.wm_payment.note).toBe('Check mailed 10/20');
  });

  it('puts a requested rebuild estimate on us, naming the company that writes it', () => {
    const steps = progress({
      estimateOrigin: 'contractor_prepared',
      contractorEstimateStage: 'requested',
      rebuildEstimateCompanyName: 'Build Right',
    });
    expect(steps.estimate.state).toBe('active');
    expect(steps.estimate.detail).toBe('We write it');
    expect(steps.estimate.note).toBe('Rebuild estimate by Build Right');
  });

  it('waits on the carrier once the requested estimate is sent', () => {
    const steps = progress({
      estimateOrigin: 'contractor_prepared',
      contractorEstimateStage: 'awaiting_approval',
    });
    expect(steps.estimate.state).toBe('waiting');
    expect(steps.estimate.note).toBe('Pick the company that writes it (not the WM company)');
  });
});
