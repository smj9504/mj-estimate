/**
 * Which of the job's bathrooms a PDF shows, when the job has several.
 *
 * Every bathroom: one PDF, each bathroom on its own pages, then the job
 * total; the dumpster, permit, trip and lead RRP once, on the bathroom that
 * carries them, as the estimates are saved. One bathroom: priced on its
 * own, as if it were the only one (its own dumpster, permit, trip and lead
 * RRP), to see what that bathroom alone would cost. Nothing is saved.
 * Each bathroom is shown by one of its estimates: its restoration or an
 * option.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Radio, Select, Skeleton, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { bathroomEstimateService } from '../../services/bathroomEstimateService';
import type { JobBathroom, JobBathroomEstimate } from '../../types/bathroomEstimate';
import { memberName } from '../../types/bathroomEstimate';

const { Text } = Typography;

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type PdfBathroomsMode = 'all' | 'one';

export interface PdfBathroomsPick {
  mode: PdfBathroomsMode;
  /** One estimate per bathroom, the job's order */
  estimateIds: string[];
  /** The bathroom (and option) each one is, by estimate id */
  names: Record<string, string>;
}

interface BEPdfBathroomsModalProps {
  open: boolean;
  /** What kind of PDF, e.g. "Detailed, with signature" */
  variant: string;
  /** The estimate open on the page */
  estimateId: string;
  bathrooms: JobBathroom[];
  onCancel: () => void;
  onExport: (pick: PdfBathroomsPick) => Promise<void> | void;
}

const priced = (b: JobBathroom) => (b.estimates ?? []).filter((e) => e.calculated);

/** The bathrooms that share the job's costs: priced, and not priced on their own */
export const sharingBathrooms = (bathrooms: JobBathroom[]) =>
  bathrooms.filter((b) => !b.alone && priced(b).length > 0);

/** The estimate a bathroom is shown by unless picked otherwise: the one open
 *  on the page, else the one its tab opens (restoration, else first option) */
const defaultPick = (b: JobBathroom, openId: string): string | undefined => {
  const choices = priced(b);
  return (choices.find((e) => e.id === openId)
    ?? choices.find((e) => e.id === b.estimate_id)
    ?? choices[0])?.id;
};

const estimateLabel = (e: JobBathroomEstimate) => memberName(e);

const BEPdfBathroomsModal: React.FC<BEPdfBathroomsModalProps> = ({
  open, variant, estimateId, bathrooms, onCancel, onExport,
}) => {
  const sharing = useMemo(() => sharingBathrooms(bathrooms), [bathrooms]);
  const left = bathrooms.filter((b) => !sharing.includes(b));
  // Every bathroom that can be in a PDF on its own (one priced on its own too)
  const pricedAny = bathrooms.filter((b) => priced(b).length > 0);

  const [mode, setMode] = useState<PdfBathroomsMode>('all');
  // The estimate picked for each bathroom, by its group
  const [picks, setPicks] = useState<Record<string, string>>({});
  // One bathroom: the estimate picked
  const [single, setSingle] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode('all');
    setBusy(false);
    const next: Record<string, string> = {};
    bathrooms.forEach((b) => {
      const id = defaultPick(b, estimateId);
      if (id) next[b.group_id] = id;
    });
    setPicks(next);
    const current = bathrooms.find((b) => b.current);
    setSingle((current && defaultPick(current, estimateId)) ?? next[pricedAny[0]?.group_id]);
    // Reset each time it opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const chosen: string[] = mode === 'all'
    ? sharing.map((b) => picks[b.group_id]).filter(Boolean)
    : (single ? [single] : []);

  const { data: preview, isFetching, error } = useQuery({
    queryKey: ['bathroom-pdf-preview', estimateId, chosen],
    queryFn: () => bathroomEstimateService.previewBathroomsPdf(estimateId, chosen),
    enabled: open && chosen.length > 0,
  });
  const totalOf = (id: string) => preview?.bathrooms.find((r) => r.estimate_id === id);

  const names: Record<string, string> = {};
  bathrooms.forEach((b) => (b.estimates ?? []).forEach((e) => {
    names[e.id] = e.kind === 'option' ? `${b.name} · ${estimateLabel(e)}` : b.name;
  }));

  const singleRow = single ? totalOf(single) : undefined;
  const singleBathroom = bathrooms.find((b) => (b.estimates ?? []).some((e) => e.id === single));
  const extra = singleRow ? Math.round((singleRow.total - singleRow.saved_total) * 100) / 100 : 0;

  const submit = async () => {
    setBusy(true);
    try {
      await onExport({ mode, estimateIds: chosen, names });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`PDF — ${variant}`}
      open={open}
      onCancel={onCancel}
      onOk={submit}
      okText="Make PDF"
      okButtonProps={{ disabled: chosen.length === 0 || !!error, loading: busy }}
      destroyOnHidden
      width={560}
    >
      <Radio.Group
        value={mode}
        onChange={(e) => setMode(e.target.value)}
        style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}
        aria-label="Which bathrooms"
      >
        <Radio value="all">
          <div style={{ fontWeight: 600 }}>All bathrooms ({sharing.length})</div>
          <Text type="secondary" style={{ fontSize: 13 }}>
            One PDF, each bathroom on its own pages, then the job total. The dumpster, permit,
            trip and lead RRP once, on the bathroom that carries them.
          </Text>
        </Radio>
        <Radio value="one">
          <div style={{ fontWeight: 600 }}>One bathroom on its own</div>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Priced as if it were the only bathroom: its own dumpster, permit, trip and lead RRP.
            The estimate stays as it is.
          </Text>
        </Radio>
      </Radio.Group>

      {mode === 'all' && (
        <div role="list" aria-label="Bathrooms in the PDF">
          {sharing.map((b) => {
            const choices = priced(b);
            const id = picks[b.group_id];
            const row = id ? totalOf(id) : undefined;
            return (
              <div
                key={b.group_id}
                role="listitem"
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0',
                  borderBottom: '1px solid var(--color-neutral-200, #e5e7eb)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>{b.name}</div>
                  {choices.length > 1 ? (
                    <Select
                      size="small"
                      aria-label={`Estimate for the ${b.name}`}
                      style={{ minWidth: 160, marginTop: 4 }}
                      value={id}
                      onChange={(v) => setPicks((p) => ({ ...p, [b.group_id]: v }))}
                      options={choices.map((e) => ({ value: e.id, label: estimateLabel(e) }))}
                    />
                  ) : (
                    choices[0]?.kind === 'option' && (
                      <Text type="secondary" style={{ fontSize: 12 }}>{estimateLabel(choices[0])}</Text>
                    )
                  )}
                </div>
                <div style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right', minWidth: 96 }}>
                  {row ? money(row.total) : isFetching ? <Skeleton.Input size="small" active style={{ width: 80 }} /> : ''}
                </div>
              </div>
            );
          })}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0', fontWeight: 600 }}>
            <span>Job total</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{preview ? money(preview.total) : ''}</span>
          </div>
          {preview?.carrier && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              Dumpster, permit, trip and lead RRP on the {preview.carrier}.
            </Text>
          )}
          {left.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Not in it: {left.map((b) => `${b.name} (${b.alone ? 'priced on its own' : 'not calculated'})`).join(', ')}
              </Text>
            </div>
          )}
        </div>
      )}

      {mode === 'one' && (
        <div>
          <Select
            aria-label="Bathroom"
            style={{ width: '100%' }}
            value={single}
            onChange={setSingle}
            options={pricedAny.map((b) => ({
              label: b.name,
              title: b.name,
              options: priced(b).map((e) => ({ value: e.id, label: names[e.id] })),
            }))}
          />
          {singleRow && singleBathroom && (
            <div style={{ marginTop: 12, lineHeight: 1.7 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                <span>On its own</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(singleRow.total)}</span>
              </div>
              {!singleBathroom.alone && extra !== 0 && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Text type="secondary">With the job, as saved</Text>
                    <Text type="secondary" style={{ fontVariantNumeric: 'tabular-nums' }}>{money(singleRow.saved_total)}</Text>
                  </div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {extra > 0
                      ? `${money(extra)} more on its own: the job costs another bathroom carries, or a dumpster sized for this one alone.`
                      : `${money(-extra)} less on its own: the dumpster it carries for the job is sized for this bathroom alone.`}
                  </Text>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 12 }}
          message={(error as any)?.response?.data?.detail || 'Could not price these bathrooms'}
        />
      )}
    </Modal>
  );
};

export default BEPdfBathroomsModal;
