import React, { useMemo, useRef } from 'react';
import { useIsFetching, useQuery, useQueryClient, type Query } from '@tanstack/react-query';
import { Button, Grid, List, Table, Tooltip } from 'antd';
import {
  ArrowRightOutlined, CheckCircleOutlined, CheckOutlined, MailOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import type { ColumnsType } from 'antd/es/table';
import { lifecycleService } from '../services/lifecycleService';
import type { PaymentGap, PendingEstimate, WMDocPrep, SupplementWork } from '../services/lifecycleService';
import type { FollowUpTask } from '../types/claimFollowUp';
import type { RebuildProject } from '../types/rebuild';
import { PageHeader, Pill, humanize } from '../components/common/ui';
import { WMStatusPill } from '../components/water-mitigation/wmStatus';
import { SupplementStatusPill, formatSignedCurrency } from '../components/supplement/supplementUi';
import { getStageLabel } from '../components/claim-followup/claimProgress';
import '../components/lifecycle/lifecycle.css';

const formatCurrency = (val?: number) => {
  if (val == null) return '$0.00';
  return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const wholeDollars = (v?: number | null) => `$${Math.round(v || 0).toLocaleString('en-US')}`;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Whole calendar days from a date to today (never negative) */
const daysSince = (date?: string | null) =>
  date ? Math.max(0, dayjs().startOf('day').diff(dayjs(date).startOf('day'), 'day')) : null;

const agoText = (days: number) => (days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`);

/** How long the oldest item in a queue has been waiting */
const oldestNote = (dates: (string | null | undefined)[]) => {
  const ages = dates.map(daysSince).filter((d): d is number => d != null);
  if (!ages.length) return undefined;
  const max = Math.max(...ages);
  return max === 0 ? 'All from today' : `Oldest ${plural(max, 'day')}`;
};

// A task is overdue on its next follow-up date (what the server filters on), else its due date
const followUpDate = (t: FollowUpTask) => t.next_followup_date || t.due_date;
const daysLate = (t: FollowUpTask) => daysSince(followUpDate(t)) ?? 0;
const lateText = (days: number) => (days === 0 ? 'Due today' : `${plural(days, 'day')} late`);

const isLifecycleQuery = (q: Query) => String(q.queryKey[0]).startsWith('lifecycle-');

type StageKey = 'docprep' | 'estimates' | 'followups' | 'payments' | 'supplements' | 'rebuilds';
const STAGE_KEYS: StageKey[] = ['docprep', 'estimates', 'followups', 'payments', 'supplements', 'rebuilds'];
// The list people act on first; the stage bar shows every other count beside it
const DEFAULT_STAGE: StageKey = 'followups';

interface StageView<T> {
  key: StageKey;
  /** Short name in the stage bar */
  label: React.ReactNode;
  count: number;
  /** One fact under the count: how old or how big the queue is */
  note?: string;
  /** The count needs someone now, so it takes the red tone */
  alert?: boolean;
  meta: React.ReactNode;
  link?: { to: string; label: string };
  emptyText: string;
  emptyIsGood?: boolean;
  rows: T[];
  rowKey: string;
  pathOf: (r: T) => string | undefined;
  columns: ColumnsType<T>;
  renderRow: (r: T) => React.ReactNode;
  scrollX?: number;
  loading: boolean;
  error: boolean;
  retry: () => void;
}

const NoValue = () => <span className="ui-props-empty">—</span>;

const TitleLink: React.FC<{ to?: string; children: React.ReactNode }> = ({ to, children }) =>
  to ? <Link className="ui-ink-link" to={to}>{children}</Link> : <span className="lc-title">{children}</span>;

/** Grey line under a table cell's value; parts join with a middle dot */
const CellMeta: React.FC<{ parts: React.ReactNode[] }> = ({ parts }) => {
  const shown = parts.filter(Boolean);
  if (!shown.length) return null;
  return (
    <span className="ui-cell-meta">
      {shown.map((p, i) => <React.Fragment key={i}>{i > 0 && ' · '}{p}</React.Fragment>)}
    </span>
  );
};

const DaysAgo: React.FC<{ date?: string | null; missing?: string }> = ({ date, missing }) => {
  const days = daysSince(date);
  if (days == null) return missing ? <span className="ui-props-empty">{missing}</span> : <NoValue />;
  return (
    <Tooltip title={dayjs(date).format('MM/DD/YYYY')}>
      <span className="lc-nowrap">{agoText(days)}</span>
    </Tooltip>
  );
};

const Money: React.FC<{ value?: number; strong?: boolean }> = ({ value, strong }) => (
  <span className={`lc-num${!value ? ' lc-num--muted' : ''}${strong ? ' lc-num--strong' : ''}`}>
    {formatCurrency(value)}
  </span>
);

const SignedDifference: React.FC<{ value: number }> = ({ value }) =>
  value ? (
    <span className={value > 0 ? 'sup-diff-up' : 'sup-diff-down'}>{formatSignedCurrency(value)}</span>
  ) : <NoValue />;

/** Urgent and high carry state; normal and low stay plain text */
const PriorityValue: React.FC<{ priority?: string }> = ({ priority }) => {
  if (priority === 'urgent') return <Pill tone="red">Urgent</Pill>;
  if (priority === 'high') return <Pill tone="orange">High</Pill>;
  return priority ? <span className="lc-muted">{humanize(priority)}</span> : <NoValue />;
};

const docsSentCount = (p: RebuildProject) => [p.coc_sent, p.invoice_sent, p.photos_sent].filter(Boolean).length;

/** Completion documents sent out of three; green only once all three are out */
const DocsSent: React.FC<{ sent: number; prefix?: string }> = ({ sent, prefix }) =>
  sent === 3 ? (
    <Pill tone="green" icon={<CheckOutlined />}>{prefix}3/3</Pill>
  ) : (
    <span className="lc-num">{prefix}{sent}/3</span>
  );

/** Phone row: optional pills, the record title, grey meta lines, a figure on the right */
const PhoneRow: React.FC<{
  to?: string;
  tags?: React.ReactNode;
  title: React.ReactNode;
  lines?: React.ReactNode[][];
  end?: React.ReactNode;
  action?: React.ReactNode;
}> = ({ to, tags, title, lines = [], end, action }) => {
  const body = (
    <>
      <div className="ui-row-body">
        {tags && <div className="ui-row-tags">{tags}</div>}
        <span className="ui-row-title">{title}</span>
        {lines.map((parts, i) => {
          const shown = parts.filter(Boolean);
          return shown.length ? (
            <div className="ui-row-meta" key={i}>
              {shown.map((p, j) => <span key={j}>{p}</span>)}
            </div>
          ) : null;
        })}
      </div>
      {end && <div className="lc-row-end">{end}</div>}
    </>
  );
  return (
    <div className="ui-row lc-row">
      {to ? <Link className="lc-row-link" to={to}>{body}</Link> : <div className="lc-row-link">{body}</div>}
      {action && <div className="lc-row-action">{action}</div>}
    </div>
  );
};

const StagePanel: React.FC<{ stage: StageView<any>; isPhone: boolean }> = ({ stage, isPhone }) => {
  const navigate = useNavigate();
  const rows = stage.error ? [] : stage.rows;

  const empty = stage.error ? (
    <div className="lc-empty">
      Could not load this list.
      <Button type="link" size="small" onClick={stage.retry}>Try again</Button>
    </div>
  ) : (
    <div className="lc-empty">
      {stage.emptyIsGood && <CheckCircleOutlined className="lc-empty-icon" aria-hidden="true" />}
      {stage.emptyText}
    </div>
  );

  return (
    <>
      <div className="lc-panel-head">
        <p className="lc-panel-meta">{stage.meta}</p>
        {stage.link && (
          <Link className="lc-panel-link" to={stage.link.to}>
            {stage.link.label} <ArrowRightOutlined aria-hidden="true" />
          </Link>
        )}
      </div>

      {isPhone ? (
        <List
          className="ui-row-list"
          dataSource={rows}
          rowKey={stage.rowKey}
          loading={stage.loading}
          renderItem={stage.renderRow}
          locale={{ emptyText: empty }}
          pagination={rows.length > 20 ? { pageSize: 20, size: 'small', align: 'center' } : false}
        />
      ) : (
        <Table
          dataSource={rows}
          columns={stage.columns}
          rowKey={stage.rowKey}
          loading={stage.loading}
          size="middle"
          scroll={stage.scrollX ? { x: stage.scrollX } : undefined}
          locale={{ emptyText: empty }}
          pagination={{ pageSize: 20, hideOnSinglePage: true, size: 'small', showSizeChanger: false }}
          onRow={(r) => {
            const path = stage.pathOf(r);
            return {
              // Links and buttons inside the row handle their own click
              onClick: (e: React.MouseEvent) => {
                if (!path || (e.target as HTMLElement).closest('a, button')) return;
                navigate(path);
              },
              style: path ? { cursor: 'pointer' } : undefined,
            };
          }}
        />
      )}
    </>
  );
};

const ClaimsLifecycleDashboard: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const screens = Grid.useBreakpoint();
  const isPhone = !screens.md;
  const [searchParams, setSearchParams] = useSearchParams();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const statsQ = useQuery({
    queryKey: ['lifecycle-stats'],
    queryFn: () => lifecycleService.getStats(),
  });
  const overdueQ = useQuery({
    queryKey: ['lifecycle-overdue'],
    queryFn: () => lifecycleService.getOverdueItems(),
  });
  const gapsQ = useQuery({
    queryKey: ['lifecycle-payment-gaps'],
    queryFn: () => lifecycleService.getPaymentGaps(0),
  });
  const estimatesQ = useQuery({
    queryKey: ['lifecycle-pending-estimates'],
    queryFn: () => lifecycleService.getPendingEstimates(),
  });
  const rebuildsQ = useQuery({
    queryKey: ['lifecycle-active-rebuilds'],
    queryFn: () => lifecycleService.getActiveRebuilds(),
  });
  const docPrepQ = useQuery({
    queryKey: ['lifecycle-wm-doc-prep'],
    queryFn: () => lifecycleService.getWMDocPrep(),
  });
  const suppWorkQ = useQuery({
    queryKey: ['lifecycle-supplement-work'],
    queryFn: () => lifecycleService.getSupplementWork(),
  });

  const fetchingCount = useIsFetching({ predicate: isLifecycleQuery });
  const refreshAll = () => queryClient.refetchQueries({ predicate: isLifecycleQuery });

  const f = statsQ.data?.followup;
  const s = statsQ.data?.supplement;
  const r = statsQ.data?.rebuild;

  const docPrep = docPrepQ.data ?? [];
  const estimates = estimatesQ.data ?? [];
  const paymentGaps = gapsQ.data ?? [];
  const suppWork = suppWorkQ.data ?? [];
  const rebuilds = rebuildsQ.data ?? [];
  // Most overdue first
  const overdue = useMemo(
    () => [...(overdueQ.data ?? [])].sort((a, b) => daysLate(b) - daysLate(a)),
    [overdueQ.data],
  );

  const owedTotal = paymentGaps.reduce((sum, g) => sum + g.difference, 0);
  const contractTotal = rebuilds.reduce((sum, p) => sum + (p.contract_amount || 0), 0);
  const maxLate = overdue.length ? daysLate(overdue[0]) : 0;

  const taskPath = (t: FollowUpTask) =>
    t.wm_job_id ? `/water-mitigation/${t.wm_job_id}` : t.claim_id ? `/claim-followup/claim/${t.claim_id}` : undefined;

  const emailButton = (t: FollowUpTask) => (
    <Tooltip title="Write follow-up email">
      <Button
        type="text"
        className="ui-icon-btn"
        icon={<MailOutlined />}
        aria-label="Write follow-up email"
        onClick={() => navigate(`/claim-followup/${t.id}/email`)}
      />
    </Tooltip>
  );

  const docPrepStage: StageView<WMDocPrep> = {
    key: 'docprep',
    label: 'Doc prep',
    count: docPrep.length,
    note: oldestNote(docPrep.map(j => j.created_at)),
    meta: 'Lead or Doc prepping · oldest first',
    link: { to: '/water-mitigation', label: 'Water Mitigation' },
    emptyText: 'All documents prepared',
    emptyIsGood: true,
    rows: docPrep,
    rowKey: 'job_id',
    pathOf: j => `/water-mitigation/${j.job_id}`,
    scrollX: 680,
    loading: docPrepQ.isLoading,
    error: docPrepQ.isError,
    retry: () => docPrepQ.refetch(),
    columns: [
      {
        title: 'Property', key: 'property', ellipsis: true,
        render: (_, j) => (
          <>
            <TitleLink to={`/water-mitigation/${j.job_id}`}>{j.property_address || 'No address'}</TitleLink>
            <CellMeta parts={[j.homeowner_name]} />
          </>
        ),
      },
      { title: 'Status', dataIndex: 'status', width: 150, render: (v: string) => <WMStatusPill status={v} /> },
      {
        title: 'Insurance', key: 'insurance', width: 200, ellipsis: true,
        render: (_, j) => (
          <>
            {j.insurance_company || <NoValue />}
            <CellMeta parts={[j.claim_number]} />
          </>
        ),
      },
      { title: 'Created', dataIndex: 'created_at', width: 130, render: (v?: string) => <DaysAgo date={v} /> },
    ],
    renderRow: j => {
      const age = daysSince(j.created_at);
      return (
        <PhoneRow
          to={`/water-mitigation/${j.job_id}`}
          tags={<WMStatusPill status={j.status} />}
          title={j.property_address || 'No address'}
          lines={[
            [j.homeowner_name, j.insurance_company],
            [age != null && `Created ${agoText(age).toLowerCase()}`],
          ]}
        />
      );
    },
  };

  const estimatesStage: StageView<PendingEstimate> = {
    key: 'estimates',
    label: 'Awaiting estimate',
    count: estimates.length,
    note: oldestNote(estimates.map(j => j.documents_sent_date)),
    meta: 'Sent to adjuster, waiting on the insurance estimate · oldest first',
    emptyText: 'All estimates received',
    emptyIsGood: true,
    rows: estimates,
    rowKey: 'job_id',
    pathOf: j => `/water-mitigation/${j.job_id}`,
    scrollX: 720,
    loading: estimatesQ.isLoading,
    error: estimatesQ.isError,
    retry: () => estimatesQ.refetch(),
    columns: [
      {
        title: 'Property', key: 'property', ellipsis: true,
        render: (_, j) => (
          <>
            <TitleLink to={`/water-mitigation/${j.job_id}`}>{j.property_address || 'No address'}</TitleLink>
            <CellMeta parts={[j.homeowner_name]} />
          </>
        ),
      },
      {
        title: 'Insurance', key: 'insurance', width: 200, ellipsis: true,
        render: (_, j) => (
          <>
            {j.insurance_company || <NoValue />}
            <CellMeta parts={[j.claim_number]} />
          </>
        ),
      },
      {
        title: 'Adjuster', key: 'adjuster', width: 200, ellipsis: true,
        render: (_, j) => (
          <>
            {j.adjuster_name || <NoValue />}
            <CellMeta parts={[j.adjuster_email]} />
          </>
        ),
      },
      {
        title: 'Docs Sent', dataIndex: 'documents_sent_date', width: 130,
        render: (v?: string) => <DaysAgo date={v} missing="Not recorded" />,
      },
    ],
    renderRow: j => {
      const age = daysSince(j.documents_sent_date);
      return (
        <PhoneRow
          to={`/water-mitigation/${j.job_id}`}
          title={j.property_address || 'No address'}
          lines={[
            [j.homeowner_name, j.insurance_company],
            [j.adjuster_name, age != null ? `Docs sent ${agoText(age).toLowerCase()}` : 'Docs sent date not recorded'],
          ]}
        />
      );
    },
  };

  const followupStage: StageView<FollowUpTask> = {
    key: 'followups',
    // Wraps between the words, never at the hyphen
    label: <>Overdue <span className="lc-nowrap">follow-ups</span></>,
    count: overdue.length,
    note: overdue.length ? (maxLate === 0 ? 'Due today' : `Up to ${plural(maxLate, 'day')} late`) : undefined,
    alert: overdue.length > 0,
    meta: (
      <>
        {overdue.length >= 50 && 'Showing the 50 most overdue · '}
        {f
          ? `${f.pending} pending · ${f.awaiting_response} awaiting response · ${f.resolved_this_week} resolved this week`
          : 'Most overdue first'}
      </>
    ),
    link: { to: '/claim-followup', label: 'Claim Follow-up' },
    emptyText: 'No overdue tasks',
    emptyIsGood: true,
    rows: overdue,
    rowKey: 'id',
    pathOf: taskPath,
    scrollX: 640,
    loading: overdueQ.isLoading,
    error: overdueQ.isError,
    retry: () => overdueQ.refetch(),
    columns: [
      {
        title: 'Task', key: 'task', ellipsis: true,
        render: (_, t) => (
          <>
            <TitleLink to={taskPath(t)}>{t.title}</TitleLink>
            <CellMeta parts={[t.property_address, t.claim_number]} />
          </>
        ),
      },
      {
        title: 'Type', dataIndex: 'task_type', width: 170, ellipsis: true,
        render: (v: string) => getStageLabel(v),
      },
      {
        title: 'Due', key: 'due', width: 130,
        render: (_, t) => (
          <Tooltip title={dayjs(followUpDate(t)).format('MM/DD/YYYY')}>
            <span className="lc-late">{lateText(daysLate(t))}</span>
          </Tooltip>
        ),
      },
      {
        title: <span className="ui-sr-only">Email</span>, key: 'email', width: 56, align: 'center',
        render: (_, t) => emailButton(t),
      },
    ],
    renderRow: t => (
      <PhoneRow
        to={taskPath(t)}
        title={t.title}
        lines={[
          [t.property_address, t.claim_number],
          [getStageLabel(t.task_type), <span className="lc-late">{lateText(daysLate(t))}</span>],
        ]}
        action={emailButton(t)}
      />
    ),
  };

  const paymentStage: StageView<PaymentGap> = {
    key: 'payments',
    label: 'Payment gaps',
    count: paymentGaps.length,
    note: paymentGaps.length ? `${wholeDollars(owedTotal)} owed` : undefined,
    alert: paymentGaps.length > 0,
    meta: `${formatCurrency(owedTotal)} owed after deductibles · largest first`,
    emptyText: 'All payments up to date',
    emptyIsGood: true,
    rows: paymentGaps,
    rowKey: 'claim_id',
    pathOf: g => `/claim-followup/claim/${g.claim_id}`,
    scrollX: 760,
    loading: gapsQ.isLoading,
    error: gapsQ.isError,
    retry: () => gapsQ.refetch(),
    columns: [
      {
        title: 'Claim', key: 'claim', ellipsis: true,
        render: (_, g) => (
          <>
            <TitleLink to={`/claim-followup/claim/${g.claim_id}`}>{g.property_address || g.claim_number}</TitleLink>
            {g.needs_supplement && <Pill tone="orange" className="lc-title-pill">Needs supplement</Pill>}
            <CellMeta parts={[g.property_address ? g.claim_number : null, g.insurance_company]} />
          </>
        ),
      },
      {
        title: 'Expected', dataIndex: 'expected_amount', width: 130, align: 'right',
        render: (v: number) => <Money value={v} />,
      },
      {
        title: 'Deductible', dataIndex: 'deductible', width: 120, align: 'right',
        render: (v: number) => (v > 0 ? <Money value={v} /> : <NoValue />),
      },
      {
        title: 'Paid', dataIndex: 'insurance_paid', width: 120, align: 'right',
        render: (v: number) => <Money value={v} />,
      },
      {
        title: 'Owed', dataIndex: 'difference', width: 130, align: 'right',
        render: (v: number) => <Money value={v} strong />,
        sorter: (a, b) => a.difference - b.difference,
        defaultSortOrder: 'descend',
      },
    ],
    renderRow: g => (
      <PhoneRow
        to={`/claim-followup/claim/${g.claim_id}`}
        tags={g.needs_supplement ? <Pill tone="orange">Needs supplement</Pill> : undefined}
        title={g.property_address || g.claim_number}
        lines={[
          [g.property_address ? g.claim_number : null, g.insurance_company],
          [
            `Paid ${formatCurrency(g.insurance_paid)} of ${formatCurrency(g.expected_amount)}`,
            g.deductible > 0 && `Deductible ${formatCurrency(g.deductible)}`,
          ],
        ]}
        end={<Money value={g.difference} strong />}
      />
    ),
  };

  const supplementStage: StageView<SupplementWork> = {
    key: 'supplements',
    label: 'Supplement work',
    count: suppWork.length,
    note: oldestNote(suppWork.map(w => w.created_at)),
    meta: s
      ? `Identified or in progress · ${(s.identified || 0) + (s.in_progress || 0) + (s.submitted || 0)} active, ${s.approved || 0} approved in all`
      : 'Identified or in progress · oldest first',
    link: { to: '/supplements', label: 'Supplements' },
    emptyText: 'No pending supplement work',
    emptyIsGood: true,
    rows: suppWork,
    rowKey: 'supplement_id',
    pathOf: w => `/supplements/${w.supplement_id}`,
    scrollX: 680,
    loading: suppWorkQ.isLoading,
    error: suppWorkQ.isError,
    retry: () => suppWorkQ.refetch(),
    columns: [
      {
        title: 'Property', key: 'property', ellipsis: true,
        render: (_, w) => (
          <>
            <TitleLink to={`/supplements/${w.supplement_id}`}>{w.property_address || w.title}</TitleLink>
            <CellMeta parts={[w.claim_number, w.property_address ? w.title : null]} />
          </>
        ),
      },
      { title: 'Status', dataIndex: 'status', width: 130, render: (v: string) => <SupplementStatusPill status={v} /> },
      { title: 'Priority', dataIndex: 'priority', width: 100, render: (v: string) => <PriorityValue priority={v} /> },
      {
        title: 'Difference', dataIndex: 'difference', width: 140, align: 'right',
        render: (v: number) => <SignedDifference value={v} />,
      },
    ],
    renderRow: w => (
      <PhoneRow
        to={`/supplements/${w.supplement_id}`}
        tags={(
          <>
            <SupplementStatusPill status={w.status} />
            {(w.priority === 'urgent' || w.priority === 'high') && <PriorityValue priority={w.priority} />}
          </>
        )}
        title={w.property_address || w.title}
        lines={[[w.claim_number, w.property_address ? w.title : null]]}
        end={w.difference ? <SignedDifference value={w.difference} /> : undefined}
      />
    ),
  };

  const rebuildStage: StageView<RebuildProject> = {
    key: 'rebuilds',
    label: 'Active rebuilds',
    count: rebuilds.length,
    note: contractTotal ? `${wholeDollars(contractTotal)} contracted` : undefined,
    meta: r ? `${r.in_progress} in progress · ${r.completed} completed` : 'In progress',
    link: { to: '/rebuild-projects', label: 'Rebuild Projects' },
    emptyText: 'No active projects',
    rows: rebuilds,
    rowKey: 'id',
    pathOf: p => `/rebuild-projects?project=${p.id}`,
    scrollX: 680,
    loading: rebuildsQ.isLoading,
    error: rebuildsQ.isError,
    retry: () => rebuildsQ.refetch(),
    columns: [
      {
        title: 'Project', key: 'project', ellipsis: true,
        render: (_, p) => (
          <>
            <TitleLink to={`/rebuild-projects?project=${p.id}`}>{p.title}</TitleLink>
            <CellMeta parts={[p.property_address, p.claim_number]} />
          </>
        ),
      },
      {
        title: 'Contractor', key: 'contractor', width: 180, ellipsis: true,
        render: (_, p) => p.contractor_name || <span className="ui-props-empty">Unassigned</span>,
      },
      {
        title: 'Contract $', dataIndex: 'contract_amount', width: 130, align: 'right',
        render: (v: number) => <Money value={v} />,
      },
      {
        title: 'Docs', key: 'docs', width: 80, align: 'center',
        render: (_, p) => <DocsSent sent={docsSentCount(p)} />,
      },
    ],
    renderRow: p => (
      <PhoneRow
        to={`/rebuild-projects?project=${p.id}`}
        title={p.title}
        lines={[
          [p.contractor_name || 'Unassigned', p.claim_number],
          [<DocsSent sent={docsSentCount(p)} prefix="Docs " />],
        ]}
        end={<Money value={p.contract_amount} />}
      />
    ),
  };

  const stages = [
    docPrepStage, estimatesStage, followupStage, paymentStage, supplementStage, rebuildStage,
  ] as StageView<any>[];

  const stageParam = searchParams.get('stage') as StageKey | null;
  const activeKey = stageParam && STAGE_KEYS.includes(stageParam) ? stageParam : DEFAULT_STAGE;
  const active = stages.find(st => st.key === activeKey)!;

  const selectStage = (key: StageKey) => {
    const next = new URLSearchParams(searchParams);
    if (key === DEFAULT_STAGE) next.delete('stage');
    else next.set('stage', key);
    setSearchParams(next, { replace: true });
  };

  // Arrow keys move along the stage bar, as in any tab list
  const onStageKeyDown = (e: React.KeyboardEvent, index: number) => {
    const last = stages.length - 1;
    const target =
      e.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : e.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : null;
    if (target == null) return;
    e.preventDefault();
    selectStage(stages[target].key);
    tabRefs.current[target]?.focus();
  };

  // What needs someone today, in one line under the title
  const attention = [
    overdue.length ? plural(overdue.length, 'overdue follow-up') : null,
    paymentGaps.length ? `${wholeDollars(owedTotal)} owed on ${plural(paymentGaps.length, 'claim')}` : null,
  ].filter(Boolean).join(' · ');
  const headerMeta = overdueQ.isLoading || gapsQ.isLoading
    ? undefined
    : <span>{attention || 'Nothing overdue and all payments up to date'}</span>;

  return (
    <div className="lc-page">
      <PageHeader
        title="Claims Lifecycle Dashboard"
        meta={headerMeta}
        actions={
          <Tooltip title="Refresh">
            <Button
              icon={<ReloadOutlined spin={fetchingCount > 0} />}
              onClick={refreshAll}
              aria-label="Refresh"
            />
          </Tooltip>
        }
      />

      <div className="lc-stages-wrap">
        <div className="lc-stages" role="tablist" aria-label="Claim stages">
          {stages.map((st, i) => {
            const selected = st.key === active.key;
            const valueClass = st.loading ? '' : st.alert ? ' is-alert' : st.count === 0 ? ' is-zero' : '';
            return (
              <button
                key={st.key}
                ref={el => { tabRefs.current[i] = el; }}
                type="button"
                role="tab"
                id={`lc-tab-${st.key}`}
                aria-selected={selected}
                aria-controls="lc-panel"
                tabIndex={selected ? 0 : -1}
                className="lc-stage"
                onClick={() => selectStage(st.key)}
                onKeyDown={e => onStageKeyDown(e, i)}
              >
                <span className="lc-stage-label">{st.label}</span>
                <span className={`lc-stage-value${valueClass}`}>
                  {st.loading ? <span className="lc-stage-skel" aria-label="Loading" /> : st.count}
                </span>
                <span className="lc-stage-note">{st.loading ? '' : st.note}</span>
              </button>
            );
          })}
        </div>
      </div>

      <section id="lc-panel" role="tabpanel" aria-labelledby={`lc-tab-${active.key}`}>
        <StagePanel key={active.key} stage={active} isPhone={isPhone} />
      </section>
    </div>
  );
};

export default ClaimsLifecycleDashboard;
