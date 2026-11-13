/**
 * Rebuild estimate: the job, the estimates brought in, and each room with
 * its lines (the floor, the cabinets, a bathroom's phases from those
 * estimates; the walls and ceiling and anything else added here).
 *
 * What is typed saves as it is typed; bringing an estimate in, refreshing
 * or removing one saves first, then answers with the estimate as it is.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Button, Card, Collapse, Empty, Grid, Input, Skeleton, Space, Tag, Typography, message,
} from 'antd';
import { FilePdfOutlined, PlusOutlined } from '@ant-design/icons';
import FlooringProjectPanel, { type ProjectDraft } from '../components/flooring-estimate/FlooringProjectPanel';
import { useAutosave, type SaveStatus } from '../components/flooring-estimate/hooks/useAutosave';
import RoomBody from '../components/rebuild-estimate/RoomBody';
import SourcesCard from '../components/rebuild-estimate/SourcesCard';
import { asWording, measureText, money, newRoom, withWording } from '../components/rebuild-estimate/lineEdit';
import rebuildEstimateService from '../services/rebuildEstimateService';
import type { RebuildEstimate, RebuildLine, RebuildRoom, SourceKind } from '../types/rebuildEstimate';

const { Title, Text } = Typography;

interface Draft extends ProjectDraft {
  rooms: RebuildRoom[];
  lines: RebuildLine[];
}

const draftOf = (e: RebuildEstimate): Draft => ({
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
  rooms: e.rooms || [],
  lines: e.lines || [],
});

const SAVE_TEXT: Record<SaveStatus, string> = {
  saved: 'Saved', pending: 'Unsaved changes', saving: 'Saving…', error: 'Not saved',
};

const Workspace: React.FC<{ initial: RebuildEstimate }> = ({ initial }) => {
  const id = initial.id;
  const queryClient = useQueryClient();
  const isMobile = !Grid.useBreakpoint().md;
  const { data: estimate = initial } = useQuery({
    queryKey: ['rebuild-estimate', id],
    queryFn: () => rebuildEstimateService.getById(id),
    initialData: initial,
    refetchOnWindowFocus: false,
  });

  const [draft, setDraft] = useState<Draft>(() => draftOf(initial));
  const change = useCallback((patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch })), []);
  const showSaved = useCallback((saved: RebuildEstimate) => {
    queryClient.setQueryData(['rebuild-estimate', id], saved);
  }, [queryClient, id]);
  const saveDraft = useCallback((d: Draft) => rebuildEstimateService.update(id, d), [id]);
  const { status, saveNow } = useAutosave(draft, saveDraft, { delay: 700, onSaved: showSaved });

  // Bringing an estimate in (refreshing, moving, removing one): save what is
  // typed first, then take the rooms and lines as the server has them
  const sourceOp = useMutation({
    mutationFn: async (op: () => Promise<RebuildEstimate>) => {
      await saveNow();
      return op();
    },
    onSuccess: (saved) => {
      showSaved(saved);
      setDraft((d) => ({ ...d, rooms: saved.rooms, lines: saved.lines }));
      queryClient.invalidateQueries({ queryKey: ['rebuild-estimates'] });
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || "That couldn't be done"),
  });
  const run = (op: () => Promise<RebuildEstimate>) => sourceOp.mutateAsync(op).catch(() => undefined);

  const pdf = useMutation({
    mutationFn: async () => {
      await saveNow();
      await rebuildEstimateService.downloadPdf(id);
    },
    onError: (err: any) => message.error(err?.response?.status === 400
      ? 'Nothing to print yet: import an estimate or add a repair.' : "The PDF couldn't be made"),
  });

  // The sets a room can take, worded as the company words them
  const { data: assemblies } = useQuery({
    queryKey: ['rebuild-assemblies', id, estimate.company_id ?? null],
    queryFn: () => rebuildEstimateService.assemblies(id),
    staleTime: 5 * 60 * 1000,
  });
  // A line's words kept for its item: this estimate's lines of it take them now,
  // the company's next estimates when they add it
  const keepWording = useMutation({
    mutationFn: (line: RebuildLine) => rebuildEstimateService.saveWording(id, {
      code: line.code!, activity: line.activity!, text: asWording(line.description, line.section),
    }),
    onSuccess: (_, line) => {
      setDraft((d) => ({ ...d, lines: withWording(d.lines, line.code!, line.activity!, asWording(line.description, line.section)) }));
      queryClient.invalidateQueries({ queryKey: ['rebuild-assemblies', id] });
      queryClient.invalidateQueries({ queryKey: ['rebuild-xactimate-search'] });
      message.success(`Kept: ${line.code} is worded this way from now on`);
    },
    onError: () => message.error("The wording couldn't be kept"),
  });

  const [roomName, setRoomName] = useState('');
  const assembled = estimate.assembled;
  const byId = useMemo(() => new Map(assembled.rooms.map((r) => [r.id, r])), [assembled]);
  const setLines = (lines: RebuildLine[]) => change({ lines });
  const setRoom = (roomId: string, patch: Partial<RebuildRoom>) =>
    change({ rooms: draft.rooms.map((r) => (r.id === roomId ? { ...r, ...patch } : r)) });
  const address = [draft.property_address, draft.city, draft.state].filter(Boolean).join(', ');

  return (
    <div style={{ padding: isMobile ? 0 : 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
        <Space align="baseline" wrap>
          <Title level={4} style={{ margin: 0 }}>Rebuild Estimate</Title>
          {address && <Text type="secondary">{address}</Text>}
          {estimate.claim_number && <Tag>#{estimate.claim_number}</Tag>}
        </Space>
        <Space wrap>
          <Text type="secondary" data-testid="rebuild-save-status">{SAVE_TEXT[status]}</Text>
          <Text strong data-testid="rebuild-total">{money(assembled.total)}</Text>
          <Button icon={<FilePdfOutlined />} loading={pdf.isPending} onClick={() => pdf.mutate()}>PDF</Button>
        </Space>
      </div>
      {status === 'error' && (
        <Alert type="error" showIcon style={{ marginBottom: 8 }} message="Your last changes weren't saved"
          action={<Button size="small" onClick={() => void saveNow()}>Try again</Button>} />
      )}

      <Collapse
        size="small"
        style={{ marginBottom: 12 }}
        defaultActiveKey={initial.claim_id || initial.property_address ? [] : ['project']}
        items={[{
          key: 'project',
          label: <Text>Project <Text type="secondary">— claim, company, address, O&amp;P on the repairs added here</Text></Text>,
          children: <FlooringProjectPanel value={draft} clientName={estimate.client_name} onChange={change} />,
        }]}
      />

      <SourcesCard
        estimateId={id}
        sources={estimate.sources}
        rooms={draft.rooms}
        busy={sourceOp.isPending}
        onImport={(kind: SourceKind, estimateId: string) => run(() => rebuildEstimateService.importEstimate(id, kind, estimateId))}
        onRefresh={(sourceId) => void run(() => rebuildEstimateService.refresh(id, sourceId))}
        onMove={(sourceId, roomId) => void run(() => rebuildEstimateService.moveSource(id, sourceId, { room_id: roomId }))}
        onRemove={(sourceId) => void run(() => rebuildEstimateService.removeSource(id, sourceId))}
      />

      {assembled.warnings.length > 0 && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Worth a look"
          description={<ul style={{ margin: 0, paddingLeft: 18 }}>{assembled.warnings.map((w) => <li key={w}>{w}</li>)}</ul>} />
      )}

      {draft.rooms.length === 0 ? (
        <Card size="small" style={{ marginBottom: 12 }}>
          <Empty description="No rooms yet: import an estimate (its rooms come with it) or add a room." />
        </Card>
      ) : (
        <Collapse
          style={{ marginBottom: 12 }}
          defaultActiveKey={draft.rooms[0]?.id}
          items={draft.rooms.map((room) => {
            const done = byId.get(room.id);
            const words = measureText(room.measures);
            return {
              key: room.id,
              label: (
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, width: '100%' }}>
                  <Space size={8} wrap>
                    <Text strong>{room.name}</Text>
                    {words && <Text type="secondary" style={{ fontSize: 12 }}>{words}</Text>}
                  </Space>
                  <Text strong>{money(done?.total)}</Text>
                </div>
              ),
              children: (
                <RoomBody
                  estimateId={id}
                  roomId={room.id}
                  room={room}
                  assembled={done}
                  assemblies={assemblies}
                  onSaveWording={(line) => keepWording.mutate(line)}
                  lines={draft.lines}
                  onLines={setLines}
                  onRoom={(patch) => setRoom(room.id, patch)}
                  onDelete={() => change({
                    rooms: draft.rooms.filter((r) => r.id !== room.id),
                    lines: draft.lines.filter((l) => l.room_id !== room.id),
                  })}
                />
              ),
            };
          })}
        />
      )}

      <Space.Compact style={{ marginBottom: 16 }}>
        <Input size="small" placeholder="Room name" value={roomName} onChange={(e) => setRoomName(e.target.value)}
          style={{ width: 200 }} aria-label="New room name"
          onPressEnter={() => {
            if (roomName.trim()) {
              change({ rooms: newRoom(draft.rooms, roomName.trim()) });
              setRoomName('');
            }
          }} />
        <Button size="small" icon={<PlusOutlined />} disabled={!roomName.trim()}
          onClick={() => {
            change({ rooms: newRoom(draft.rooms, roomName.trim()) });
            setRoomName('');
          }}>
          Add a room
        </Button>
      </Space.Compact>

      <Card size="small" title={<span>General <Text type="secondary" style={{ fontWeight: 400 }}>— once for the whole job</Text></span>}
        extra={<Text strong>{money(byId.get(null)?.total)}</Text>}>
        <RoomBody estimateId={id} roomId={null} assembled={byId.get(null)} lines={draft.lines} onLines={setLines}
          onSaveWording={(line) => keepWording.mutate(line)} />
      </Card>
      <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 8 }}>
        A repair from Xactimate is written in our words and priced at the price list +10%, with material tax and
        (when it is on) O&amp;P in its unit price. A price typed in is used as typed. Lines brought in keep the prices
        of the estimate they came from.
      </Text>
    </div>
  );
};

const RebuildEstimateDetail: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const { data: estimate, isLoading, error } = useQuery({
    queryKey: ['rebuild-estimate', id],
    queryFn: () => rebuildEstimateService.getById(id),
    enabled: !!id,
    refetchOnWindowFocus: false,
  });
  if (isLoading) return <Skeleton active />;
  if (error || !estimate) return <Alert type="error" showIcon message="This rebuild estimate couldn't be opened." />;
  return <Workspace key={estimate.id} initial={estimate} />;
};

export default RebuildEstimateDetail;
