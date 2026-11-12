/**
 * Flooring estimate: the job, its sketch, each room's floors and the work
 * around them, and the priced result.
 *
 * What the estimator picks saves as it is picked; the sketch saves as it is
 * drawn. Calculate saves anything still waiting, then prices the estimate.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Grid, Skeleton, Space, Tabs, Tag, Typography, message } from 'antd';
import { CalculatorOutlined } from '@ant-design/icons';
import FlooringSketchEditor from '../components/flooring-estimate/sketch/FlooringSketchEditor';
import FlooringScopePanel from '../components/flooring-estimate/FlooringScopePanel';
import FlooringProjectPanel, { type ProjectDraft } from '../components/flooring-estimate/FlooringProjectPanel';
import FlooringResult from '../components/flooring-estimate/FlooringResult';
import { useAutosave, type SaveStatus } from '../components/flooring-estimate/hooks/useAutosave';
import flooringEstimateService from '../services/flooringEstimateService';
import type { FlooringEstimate, FlooringPricingInfo, JobScope, RoomScope } from '../types/flooringEstimate';
import { STATUS_COLORS } from './FlooringEstimateList';

const { Title, Text } = Typography;

const TABS = ['project', 'sketch', 'rooms', 'result'] as const;
type Tab = typeof TABS[number];

interface Draft extends ProjectDraft {
  room_scopes: Record<string, RoomScope>;
  job_scope: JobScope;
}

const draftOf = (e: FlooringEstimate): Draft => ({
  company_id: e.company_id,
  claim_id: e.claim_id,
  property_address: e.property_address,
  city: e.city,
  state: e.state,
  zip_code: e.zip_code,
  include_overhead_profit: !!e.include_overhead_profit,
  overhead_pct: e.overhead_pct ?? 0.1,
  profit_pct: e.profit_pct ?? 0.1,
  notes: e.notes,
  room_scopes: e.room_scopes || {},
  job_scope: e.job_scope || {},
});

const SAVE_TEXT: Record<SaveStatus, string> = {
  saved: 'Saved', pending: 'Unsaved changes', saving: 'Saving…', error: 'Not saved',
};

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const Workspace: React.FC<{ initial: FlooringEstimate }> = ({ initial }) => {
  const id = initial.id;
  const queryClient = useQueryClient();
  const screens = Grid.useBreakpoint();
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') || '') ? (params.get('tab') as Tab) : 'rooms';
  const setTab = (next: string) => setParams((p) => {
    p.set('tab', next);
    return p;
  }, { replace: true });

  const { data: estimate = initial } = useQuery({
    queryKey: ['flooring-estimate', id],
    queryFn: () => flooringEstimateService.getById(id),
    initialData: initial,
    refetchOnWindowFocus: false,
  });
  const { data: pricing } = useQuery<FlooringPricingInfo>({
    queryKey: ['flooring-pricing-info', id, estimate.price_book?.id ?? null, estimate.company_id],
    queryFn: () => flooringEstimateService.pricingInfo(id),
  });

  // The estimator's choices, kept here: the server's copy may be a save behind
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial));
  const [stale, setStale] = useState(false);
  const change = useCallback((patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setStale(true);
  }, []);

  const showSaved = useCallback((saved: FlooringEstimate) => {
    queryClient.setQueryData(['flooring-estimate', id], saved);
  }, [queryClient, id]);
  const saveDraft = useCallback((d: Draft) => flooringEstimateService.update(id, d), [id]);
  const { status, saveNow } = useAutosave(draft, saveDraft, { delay: 700, onSaved: showSaved });

  const sketchSave = useRef<(() => Promise<void>) | null>(null);
  const onSketchSaved = useCallback((saved: FlooringEstimate) => {
    showSaved(saved);
    setStale(true);
  }, [showSaved]);

  const calculate = useMutation({
    mutationFn: async () => {
      await sketchSave.current?.();
      await saveNow();
      return flooringEstimateService.calculate(id);
    },
    onSuccess: (est) => {
      showSaved(est);
      setStale(false);
      setTab('result');
      queryClient.invalidateQueries({ queryKey: ['flooring-estimates'] });
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || "It couldn't be calculated"),
  });

  const pdf = useMutation({
    mutationFn: async () => {
      // The PDF prints the last calculation: bring it up to date first
      if (stale) {
        await sketchSave.current?.();
        await saveNow();
        showSaved(await flooringEstimateService.calculate(id));
        setStale(false);
      }
      await flooringEstimateService.downloadPdf(id);
    },
    onError: () => message.error("The PDF couldn't be made"),
  });

  // Opened on a calculated estimate, the result is current
  useEffect(() => {
    setStale(initial.status !== 'calculated' && (initial.line_items || []).length > 0);
  }, [initial]);

  const address = [draft.property_address, draft.city, draft.state].filter(Boolean).join(', ');
  const rooms = estimate.takeoff?.rooms || [];

  return (
    <div style={{ padding: screens.md ? 16 : 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <Space align="baseline" wrap>
          <Title level={4} style={{ margin: 0 }}>Flooring Estimate</Title>
          {address && <Text type="secondary">{address}</Text>}
          <Tag color={STATUS_COLORS[estimate.status] || 'default'}>{estimate.status}</Tag>
        </Space>
        <Space wrap>
          <Text type="secondary" data-testid="scope-save-status">{SAVE_TEXT[status]}</Text>
          {(estimate.line_items || []).length > 0 && (
            <Text strong>{money(estimate.total || 0)}{stale ? ' (before changes)' : ''}</Text>
          )}
          <Button type="primary" icon={<CalculatorOutlined />} loading={calculate.isPending}
            onClick={() => calculate.mutate()} data-testid="calculate-header">
            Calculate
          </Button>
        </Space>
      </div>
      {status === 'error' && (
        <Alert type="error" showIcon style={{ marginBottom: 8 }} message="Your last changes weren't saved"
          action={<Button size="small" onClick={() => void saveNow()}>Try again</Button>} />
      )}

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'project',
            label: 'Project',
            children: (
              <FlooringProjectPanel value={draft} clientName={estimate.client_name} onChange={change} />
            ),
          },
          {
            key: 'sketch',
            label: 'Sketch',
            children: (
              <FlooringSketchEditor
                estimateId={id}
                initialSketch={initial.sketch_data}
                onSaved={onSketchSaved}
                saveRef={sketchSave}
              />
            ),
          },
          {
            key: 'rooms',
            label: `Rooms & Materials${rooms.length ? ` (${rooms.length})` : ''}`,
            children: (
              <FlooringScopePanel
                rooms={rooms}
                generalItems={estimate.takeoff?.general_items || []}
                pricing={pricing}
                roomScopes={draft.room_scopes}
                jobScope={draft.job_scope}
                onRoomScopes={(room_scopes) => change({ room_scopes })}
                onJobScope={(job_scope) => change({ job_scope })}
                onGoToSketch={() => setTab('sketch')}
              />
            ),
          },
          {
            key: 'result',
            label: 'Result',
            children: (
              <FlooringResult estimate={estimate} stale={stale} calculating={calculate.isPending}
                onCalculate={() => calculate.mutate()} downloading={pdf.isPending} onPdf={() => pdf.mutate()} />
            ),
          },
        ]}
      />
    </div>
  );
};

const FlooringEstimateDetail: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const { data: estimate, isLoading, error } = useQuery({
    queryKey: ['flooring-estimate', id],
    queryFn: () => flooringEstimateService.getById(id),
    enabled: !!id,
    refetchOnWindowFocus: false,
  });

  if (isLoading) return <Skeleton active />;
  if (error || !estimate) {
    return <Alert type="error" showIcon message="This flooring estimate couldn't be opened." />;
  }
  // Keyed by estimate: another one starts with its own choices and sketch
  return <Workspace key={estimate.id} initial={estimate} />;
};

export default FlooringEstimateDetail;
