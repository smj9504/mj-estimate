import React, { useState } from 'react';
import {
  Steps,
  Button,
  Modal,
  Input,
  Tag,
  Space,
  Typography,
  Alert,
  InputNumber,
  message,
  Tooltip,
} from 'antd';
import {
  ToolOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
  SendOutlined,
  PhoneOutlined,
  DollarOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { claimFollowUpService } from '../../services/claimFollowUpService';
import type { FollowUpTask } from '../../types/claimFollowUp';
import {
  DEPRECIATION_PHASE_ORDER,
  DEPRECIATION_PHASE_LABELS,
  DEPRECIATION_PHASE_COLORS,
  type DepreciationPhase,
} from '../../types/claimFollowUp';
import {
  SUPPLEMENT_STATUS_LABELS,
  SUPPLEMENT_STATUS_COLORS,
  type SupplementStatus,
} from '../../types/supplement';

const { Text } = Typography;
const { TextArea } = Input;

// Steps display merges docs_sent_pa and docs_sent_insurance into one visual step
const DISPLAY_STEPS = [
  { key: 'in_construction', icon: <ToolOutlined />, title: 'Construction' },
  { key: 'construction_done', icon: <CheckCircleOutlined />, title: 'Complete' },
  { key: 'preparing_docs', icon: <FileTextOutlined />, title: 'Preparing Docs' },
  { key: 'docs_sent', icon: <SendOutlined />, title: 'Docs Sent' },
  { key: 'following_up', icon: <PhoneOutlined />, title: 'Follow-up' },
  { key: 'payment_received', icon: <DollarOutlined />, title: 'Payment' },
];

function getDisplayStepIndex(phase?: DepreciationPhase): number {
  if (!phase) return 0;
  const map: Record<string, number> = {
    in_construction: 0,
    construction_done: 1,
    preparing_docs: 2,
    docs_sent_pa: 3,
    docs_sent_insurance: 3,
    following_up: 4,
    payment_received: 5,
  };
  return map[phase] ?? 0;
}

// Maps a directly-clickable display step to the concrete phase it sets.
// Index 3 ("Docs Sent") and index 5 ("Payment") are excluded — they open a
// modal instead, since setting them needs extra input (PA vs. insurance,
// payment amount).
const STEP_INDEX_TO_PHASE: Record<number, DepreciationPhase> = {
  0: 'in_construction',
  1: 'construction_done',
  2: 'preparing_docs',
  4: 'following_up',
};

function SupplementStatusTags({ statuses }: { statuses?: Record<string, number> }) {
  const entries = Object.entries(statuses || {}).filter(([, count]) => count > 0);
  if (entries.length === 0) return null;
  return (
    <>
      {entries.map(([status, count]) => (
        <Tag key={status} color={SUPPLEMENT_STATUS_COLORS[status as SupplementStatus] || 'default'}>
          Supplement: {SUPPLEMENT_STATUS_LABELS[status as SupplementStatus] || status}
          {count > 1 ? ` ×${count}` : ''}
        </Tag>
      ))}
    </>
  );
}

function getNextPhase(current?: DepreciationPhase): DepreciationPhase | null {
  if (!current) return 'construction_done';
  const idx = DEPRECIATION_PHASE_ORDER.indexOf(current);
  // docs_sent_pa / docs_sent_insurance -> following_up
  if (current === 'docs_sent_pa' || current === 'docs_sent_insurance') {
    return 'following_up';
  }
  // preparing_docs -> needs modal to choose PA or insurance
  if (current === 'preparing_docs') return null; // handled by modal
  if (idx < 0 || idx >= DEPRECIATION_PHASE_ORDER.length - 1) return null;
  return DEPRECIATION_PHASE_ORDER[idx + 1];
}

interface DepreciationPhaseTrackerProps {
  task: FollowUpTask;
  compact?: boolean;
  onUpdated?: () => void;
}

const DepreciationPhaseTracker: React.FC<DepreciationPhaseTrackerProps> = ({
  task,
  compact = false,
  onUpdated,
}) => {
  const queryClient = useQueryClient();
  const [sendModal, setSendModal] = useState(false);
  const [paymentModal, setPaymentModal] = useState(false);
  const [advanceNotes, setAdvanceNotes] = useState('');
  const [paymentAmount, setPaymentAmount] = useState<number | null>(null);

  const currentPhase = task.depreciation_phase;
  const currentStep = getDisplayStepIndex(currentPhase);
  const isResolved = task.status === 'resolved' || currentPhase === 'payment_received';
  const hasPendingSupps = task.has_pending_supplements && !task.has_appraisal_task;

  const advanceMutation = useMutation({
    mutationFn: (args: { phase: string; sentTo?: string; notes?: string }) =>
      claimFollowUpService.advanceDepreciationPhase(
        task.id, args.phase, args.sentTo, args.notes,
      ),
    onSuccess: () => {
      message.success('Phase updated');
      queryClient.invalidateQueries({ queryKey: ['followup-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['followup-task', task.id] });
      setAdvanceNotes('');
      setSendModal(false);
      setPaymentModal(false);
      onUpdated?.();
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail || err?.message || 'Failed to advance phase';
      message.error(detail);
    },
  });

  const handleAdvance = () => {
    if (!currentPhase) {
      advanceMutation.mutate({ phase: 'construction_done', notes: advanceNotes });
      return;
    }
    if (currentPhase === 'preparing_docs') {
      setSendModal(true);
      return;
    }
    const next = getNextPhase(currentPhase);
    if (!next) return;
    if (next === 'payment_received') {
      setPaymentAmount(task.depreciation_amount || null);
      setPaymentModal(true);
      return;
    }
    advanceMutation.mutate({ phase: next, notes: advanceNotes });
  };

  const handleSendTo = (target: 'pa' | 'insurance') => {
    const phase = target === 'pa' ? 'docs_sent_pa' : 'docs_sent_insurance';
    advanceMutation.mutate({ phase, sentTo: target, notes: advanceNotes });
  };

  const handlePaymentReceived = () => {
    const notes = paymentAmount
      ? `Depreciation payment received: $${paymentAmount.toLocaleString()}`
      : 'Depreciation payment received';
    advanceMutation.mutate({
      phase: 'payment_received',
      notes: advanceNotes ? `${notes}. ${advanceNotes}` : notes,
    });
  };

  // Direct stage change: clicking any step jumps straight to that phase,
  // instead of only being able to advance one step at a time.
  const handleStepClick = (idx: number) => {
    if (idx === currentStep) return;
    if (idx === 3) {
      setSendModal(true);
      return;
    }
    if (idx === 5) {
      setPaymentAmount(task.depreciation_amount || null);
      setPaymentModal(true);
      return;
    }
    const phase = STEP_INDEX_TO_PHASE[idx];
    if (!phase) return;
    Modal.confirm({
      title: `Change stage to "${DISPLAY_STEPS[idx].title}"?`,
      content: idx < currentStep
        ? 'This moves the claim back to an earlier stage.'
        : undefined,
      onOk: () => advanceMutation.mutate({ phase, notes: advanceNotes }),
    });
  };

  // Compact mode: just show a tag with current phase
  if (compact) {
    const label = currentPhase
      ? DEPRECIATION_PHASE_LABELS[currentPhase]
      : 'Not Started';
    const color = currentPhase
      ? DEPRECIATION_PHASE_COLORS[currentPhase]
      : 'default';
    return (
      <Space size={4} wrap>
        <Tag color={color}>{label}</Tag>
        {task.depreciation_amount != null && task.depreciation_amount > 0 && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            ${task.depreciation_amount.toLocaleString()}
          </Text>
        )}
        <SupplementStatusTags statuses={task.supplement_statuses} />
      </Space>
    );
  }

  const getStepStatus = (idx: number) => {
    if (idx < currentStep) return 'finish' as const;
    if (idx === currentStep) {
      if (isResolved && idx === 5) return 'finish' as const;
      return 'process' as const;
    }
    return 'wait' as const;
  };

  // Button label for current phase
  const getButtonLabel = (): string => {
    if (isResolved) return '';
    if (!currentPhase) return 'Start: Construction';
    switch (currentPhase) {
      case 'in_construction': return 'Mark Complete';
      case 'construction_done': return 'Start Preparing Docs';
      case 'preparing_docs': return 'Send Documents';
      case 'docs_sent_pa':
      case 'docs_sent_insurance': return 'Start Follow-up';
      case 'following_up': return 'Payment Received';
      default: return '';
    }
  };

  const buttonLabel = getButtonLabel();

  return (
    <div>
      {/* Depreciation amount */}
      {task.depreciation_amount != null && task.depreciation_amount > 0 && (
        <div style={{ marginBottom: 12, textAlign: 'center' }}>
          <Text strong style={{ fontSize: 16 }}>
            <DollarOutlined /> Recoverable Depreciation: ${task.depreciation_amount.toLocaleString()}
          </Text>
        </div>
      )}

      {/* Supplement status — shown alongside construction/depreciation stage so
          e.g. "construction in progress + supplement in progress" is visible at once */}
      {task.supplement_statuses && Object.keys(task.supplement_statuses).length > 0 && (
        <div style={{ marginBottom: 12, textAlign: 'center' }}>
          <Space size={4} wrap>
            <SupplementStatusTags statuses={task.supplement_statuses} />
          </Space>
        </div>
      )}

      {/* Supplement blocking warning */}
      {hasPendingSupps && currentPhase === 'preparing_docs' && (
        <Alert
          type="warning"
          showIcon
          icon={<ExclamationCircleOutlined />}
          message="Supplement negotiations in progress"
          description="All supplements must be resolved before sending depreciation documents."
          style={{ marginBottom: 12 }}
        />
      )}

      {/* Steps — click any step to jump directly to that stage */}
      <Steps
        current={currentStep}
        size="small"
        style={{ marginBottom: 16 }}
        onChange={handleStepClick}
        items={DISPLAY_STEPS.map((step, idx) => {
          let desc: string | undefined;
          if (idx === 3 && (currentPhase === 'docs_sent_pa' || currentPhase === 'docs_sent_insurance')) {
            desc = currentPhase === 'docs_sent_pa' ? 'To PA' : 'To Insurance';
          }
          return {
            title: step.title,
            icon: step.icon,
            status: getStepStatus(idx),
            description: desc,
          };
        })}
      />

      {/* Action area */}
      {buttonLabel && (
        <div style={{ textAlign: 'center' }}>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Tooltip
              title={
                hasPendingSupps && currentPhase === 'preparing_docs'
                  ? 'Complete all supplement negotiations first'
                  : undefined
              }
            >
              <Button
                type="primary"
                onClick={handleAdvance}
                loading={advanceMutation.isPending}
                disabled={hasPendingSupps && currentPhase === 'preparing_docs'}
              >
                {buttonLabel}
              </Button>
            </Tooltip>
          </Space>
        </div>
      )}

      {/* Send destination modal (PA vs Insurance) */}
      <Modal
        title="Send Documents To"
        open={sendModal}
        onCancel={() => { setSendModal(false); setAdvanceNotes(''); }}
        footer={null}
        width={420}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <TextArea
            placeholder="Notes (optional)"
            value={advanceNotes}
            onChange={e => setAdvanceNotes(e.target.value)}
            rows={2}
          />
          <Space style={{ width: '100%', justifyContent: 'center' }}>
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={() => handleSendTo('pa')}
              loading={advanceMutation.isPending}
            >
              Send to PA
            </Button>
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={() => handleSendTo('insurance')}
              loading={advanceMutation.isPending}
            >
              Send to Insurance
            </Button>
          </Space>
        </Space>
      </Modal>

      {/* Payment received modal */}
      <Modal
        title="Depreciation Payment Received"
        open={paymentModal}
        onCancel={() => { setPaymentModal(false); setAdvanceNotes(''); }}
        onOk={handlePaymentReceived}
        confirmLoading={advanceMutation.isPending}
        okText="Confirm Payment"
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            <Text>Payment Amount:</Text>
            <InputNumber
              style={{ width: '100%', marginTop: 4 }}
              prefix="$"
              value={paymentAmount}
              onChange={v => setPaymentAmount(v)}
              formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
              parser={v => Number(v?.replace(/[,$]/g, '') || 0)}
              min={0}
            />
          </div>
          <TextArea
            placeholder="Notes (optional)"
            value={advanceNotes}
            onChange={e => setAdvanceNotes(e.target.value)}
            rows={2}
          />
        </Space>
      </Modal>
    </div>
  );
};

export default DepreciationPhaseTracker;
