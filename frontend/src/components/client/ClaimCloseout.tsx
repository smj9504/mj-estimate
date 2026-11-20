/**
 * Closing or denying a claim wraps up the work linked to it; opening it
 * again puts that work back (backend/app/domains/client/claim_closeout.py).
 *
 * CloseoutChoices lists the claim's rebuild projects, supplements,
 * follow-ups and WM jobs with a picker each, preset to the suggestion for
 * the item's state; items with no suggestion must be picked. It is shown in
 * ClaimCloseoutModal (claim edit) and inside the follow-up Resolve form
 * (Denied, Close the claim). ClaimReopenModal ticks what to put back.
 */

import React from 'react';
import { Alert, Checkbox, Modal, Select } from 'antd';
import { Pill, useSheetModal } from '../common/ui';
import type {
  CloseoutChoice,
  CloseoutItem,
  ReopenItem,
} from '../../types/client';
import './claimCloseout.css';

/** "Rebuild Kitchen" — or just the title when it already says what it is ("Supplement 2") */
export const closeoutItemName = (item: { group: string; label: string }) =>
  item.label.toLowerCase().startsWith(item.group.toLowerCase()) ? item.label : `${item.group} ${item.label}`;

/** The picks the items start with: each one's suggestion, none where there isn't one */
export const initialCloseoutPicks = (items: CloseoutItem[]): Record<string, string | undefined> =>
  Object.fromEntries(
    items.filter(i => !i.done).map(i => [`${i.kind}:${i.id}`, i.default ?? undefined]),
  );

/** Items still to pick, by label; empty when everything is picked */
export const missingCloseoutPicks = (
  items: CloseoutItem[], picks: Record<string, string | undefined>,
): string[] =>
  items.filter(i => !i.done && !picks[`${i.kind}:${i.id}`]).map(closeoutItemName);

export const closeoutChoices = (
  items: CloseoutItem[], picks: Record<string, string | undefined>,
): CloseoutChoice[] =>
  items
    .filter(i => !i.done && picks[`${i.kind}:${i.id}`])
    .map(i => ({ kind: i.kind, id: i.id, to: picks[`${i.kind}:${i.id}`] as string }));

interface CloseoutChoicesProps {
  items: CloseoutItem[];
  picks: Record<string, string | undefined>;
  onPick: (key: string, value: string) => void;
  /** Outline unpicked must-picks after a save was tried */
  showMissing?: boolean;
}

export const CloseoutChoices: React.FC<CloseoutChoicesProps> = ({ items, picks, onPick, showMissing }) => {
  const open = items.filter(i => !i.done);
  const done = items.filter(i => i.done);
  return (
    <div className="cco">
      {open.length > 0 && (
        <ul className="cco-list">
          {open.map(item => {
            const key = `${item.kind}:${item.id}`;
            const mustPick = item.default === null;
            const missing = showMissing && mustPick && !picks[key];
            return (
              <li key={key} className={`cco-row${missing ? ' is-missing' : ''}`}>
                <div className="cco-what">
                  <div className="cco-label">
                    <span className="cco-group">{item.group}</span>
                    <span className="cco-name">{item.label}</span>
                  </div>
                  <div className="cco-state">
                    {item.state}
                    {item.task_type && item.task_type !== item.label && <> · {item.task_type}</>}
                    {mustPick && <span className="cco-must"> · Pick one</span>}
                  </div>
                </div>
                <Select
                  className="cco-select"
                  aria-label={closeoutItemName(item)}
                  placeholder="Pick one"
                  status={missing ? 'error' : undefined}
                  value={picks[key]}
                  onChange={(v) => onPick(key, v)}
                  options={item.options}
                  popupMatchSelectWidth={false}
                />
              </li>
            );
          })}
        </ul>
      )}
      {open.length === 0 && <div className="cco-none">Nothing linked to this claim is still open.</div>}
      {done.length > 0 && (
        <div className="cco-done">
          <span className="cco-done-head">Already finished:</span>{' '}
          {done.map((i, n) => (
            <span key={`${i.kind}:${i.id}`}>
              {n > 0 && ', '}
              {closeoutItemName(i)} ({i.status_label})
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

interface ClaimCloseoutModalProps {
  open: boolean;
  toStatus: 'closed' | 'denied';
  noun: string;
  items: CloseoutItem[];
  saving: boolean;
  onCancel: () => void;
  onConfirm: (choices: CloseoutChoice[]) => void;
}

export const ClaimCloseoutModal: React.FC<ClaimCloseoutModalProps> = ({
  open, toStatus, noun, items, saving, onCancel, onConfirm,
}) => {
  const { sheetProps } = useSheetModal('tall');
  const [picks, setPicks] = React.useState<Record<string, string | undefined>>({});
  const [tried, setTried] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setPicks(initialCloseoutPicks(items));
      setTried(false);
    }
  }, [open, items]);

  const missing = missingCloseoutPicks(items, picks);
  const label = toStatus === 'denied' ? 'Denied' : 'Closed';

  return (
    <Modal
      title={`${noun} → ${label}: wrap up its work`}
      open={open}
      onCancel={onCancel}
      okText={`Save as ${label}`}
      okButtonProps={{ loading: saving }}
      onOk={() => {
        setTried(true);
        if (missing.length === 0) onConfirm(closeoutChoices(items, picks));
      }}
      width={680}
      destroyOnHidden
      maskClosable={false}
      {...sheetProps}
    >
      <p className="cco-intro">
        Each item below is set as picked when the {noun.toLowerCase()} is saved. Suggestions follow
        where each one is; the ones marked <b>Pick one</b> need your call. Opening
        the {noun.toLowerCase()} again offers to put these back.
      </p>
      <CloseoutChoices
        items={items}
        picks={picks}
        onPick={(key, value) => setPicks(p => ({ ...p, [key]: value }))}
        showMissing={tried}
      />
      {tried && missing.length > 0 && (
        <Alert
          className="cco-alert"
          type="error"
          showIcon
          message={`Pick what happens to: ${missing.join('; ')}`}
        />
      )}
    </Modal>
  );
};

interface ClaimReopenModalProps {
  open: boolean;
  noun: string;
  closedAs: 'closed' | 'denied' | null;
  items: ReopenItem[];
  saving: boolean;
  onCancel: () => void;
  onConfirm: (keys: { kind: ReopenItem['kind']; id: string }[]) => void;
}

export const ClaimReopenModal: React.FC<ClaimReopenModalProps> = ({
  open, noun, closedAs, items, saving, onCancel, onConfirm,
}) => {
  const { sheetProps } = useSheetModal('tall');
  const [ticked, setTicked] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    if (open) setTicked(Object.fromEntries(items.map(i => [`${i.kind}:${i.id}`, i.default])));
  }, [open, items]);

  return (
    <Modal
      title={`Reopen ${noun.toLowerCase()}: put its work back?`}
      open={open}
      onCancel={onCancel}
      okText="Save"
      okButtonProps={{ loading: saving }}
      onOk={() => onConfirm(items
        .filter(i => ticked[`${i.kind}:${i.id}`])
        .map(i => ({ kind: i.kind, id: i.id })))}
      width={620}
      destroyOnHidden
      maskClosable={false}
      {...sheetProps}
    >
      <p className="cco-intro">
        When this {noun.toLowerCase()} was {closedAs === 'denied' ? 'denied' : 'closed'}, these items
        were wrapped up. Ticked ones go back to where they were; the rest stay as they are now.
      </p>
      <ul className="cco-list">
        {items.map(item => {
          const key = `${item.kind}:${item.id}`;
          return (
            <li key={key} className="cco-row">
              <Checkbox
                checked={!!ticked[key]}
                onChange={(e) => setTicked(t => ({ ...t, [key]: e.target.checked }))}
              >
                <span className="cco-group">{item.group}</span>{' '}
                <span className="cco-name">{item.label}</span>
              </Checkbox>
              <div className="cco-back">
                <Pill tone="gray">{item.status_label}</Pill>
                <span aria-hidden="true">→</span>
                <Pill tone="blue">{item.before_label}</Pill>
              </div>
              {item.changed_since && (
                <div className="cco-state cco-changed">Changed since the claim was closed</div>
              )}
            </li>
          );
        })}
      </ul>
    </Modal>
  );
};
