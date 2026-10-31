/**
 * One content item in a Photo AI room. Reads as a line: what it is, its category,
 * size, weight, packing method, quantity and labor. Opening it edits those. An
 * item the AI wasn't sure about starts open with the doubtful fields marked, and
 * deciding one settles it.
 */
import React, { useEffect, useState } from 'react';
import { Button, Checkbox, Input, InputNumber, Select } from 'antd';
import { DeleteOutlined, RightOutlined } from '@ant-design/icons';
import { Pill } from '../common/ui';
import { ITEM_CATEGORIES } from '../../types/packing-estimate';
import type { DetectedContentItem, ItemReviewField } from '../../types/packing-estimate';
import {
  ITEM_SIZE_OPTIONS, ITEM_WEIGHT_OPTIONS, PACKING_METHOD_OPTIONS,
} from './constants';
import { isUnconfirmed, needsReview } from './itemEdits';
import { itemSizeLabel, itemWeightLabel, packingMethodLabel } from './packingUi';

const REVIEW_LABELS: Record<ItemReviewField, string> = {
  presence: 'whether it is there',
  name: 'what it is',
  quantity: 'quantity',
  category: 'category',
  size: 'size',
  weight: 'weight',
  fragile: 'fragile',
  disassembly: 'disassembly',
};

const AUTO_METHOD = '__auto__';

const METHOD_OPTIONS = [
  { value: AUTO_METHOD, label: 'Auto', hint: 'Follows the item' },
  ...PACKING_METHOD_OPTIONS,
];

/** An option with its explanation; a closed select shows only the name */
const optionWithHint = (option: { label?: React.ReactNode; data: { hint?: string } }) => (
  <span className="pk-option">
    {option.label}
    {option.data.hint && <span className="pk-option-hint">{option.data.hint}</span>}
  </span>
);

const categoryOptions = ITEM_CATEGORIES.map(c => ({ value: c, label: c }));

interface DetectedItemRowProps {
  item: DetectedContentItem;
  onChange: (patch: Partial<DetectedContentItem>) => void;
  onConfirm: () => void;
  onRemove: () => void;
}

const DetectedItemRow: React.FC<DetectedItemRowProps> = ({ item, onChange, onConfirm, onRemove }) => {
  const uncertain = item.uncertain_fields ?? [];
  const unconfirmed = isUnconfirmed(item);
  const [open, setOpen] = useState(needsReview(item) || !item.name);
  // The name saves when you leave the field: each save re-prices the item
  const [name, setName] = useState(item.name);
  useEffect(() => setName(item.name), [item.name]);

  const status = (field: ItemReviewField) => (uncertain.includes(field) ? 'warning' as const : undefined);
  const commitName = () => {
    const trimmed = name.trim();
    if (trimmed !== item.name) onChange({ name: trimmed });
  };

  const summary = [
    item.category,
    itemSizeLabel(item.size),
    itemWeightLabel(item.weight),
    packingMethodLabel(item.packing_method),
  ].filter(Boolean).join(' · ');
  const label = item.name || 'New item';
  const others = uncertain.filter(f => f !== 'presence').map(f => REVIEW_LABELS[f]);

  return (
    <li className={`pk-item-row${unconfirmed ? ' is-unconfirmed' : ''}`}>
      <div className="pk-item-line">
        <button
          type="button"
          className="pk-item-toggle"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          aria-label={`${open ? 'Close' : 'Edit'} ${label}`}
        >
          <RightOutlined className={`pk-items-caret${open ? ' is-open' : ''}`} aria-hidden="true" />
          <span className="pk-item-text">
            <span className="pk-item-name">
              {label}
              {item.is_fragile && <Pill tone="orange">Fragile</Pill>}
              {item.is_high_value && <Pill tone="yellow">High Value</Pill>}
              {item.needs_disassembly && <Pill tone="purple">Disassembly</Pill>}
              {unconfirmed && <Pill tone="red">Not counted</Pill>}
              {!unconfirmed && uncertain.length > 0 && <Pill tone="yellow">To review</Pill>}
            </span>
            <span className="pk-item-meta">{summary}</span>
          </span>
          <span className="pk-item-figure">×{item.quantity}</span>
          <span className="pk-item-figure pk-item-hours">
            {unconfirmed || item.estimated_labor_hours == null ? '-' : `${item.estimated_labor_hours.toFixed(2)} hr`}
          </span>
        </button>
        <Button
          size="small" type="text"
          className="ui-icon-btn ui-icon-btn--danger"
          icon={<DeleteOutlined />}
          onClick={onRemove}
          aria-label={`Remove ${label}`}
        />
      </div>

      {open && (
        <div className="pk-item-editor">
          {uncertain.length > 0 && (
            <div className="pk-item-review" role="status">
              <span>
                {unconfirmed
                  ? "The AI isn't sure this is here. It isn't counted until you keep it."
                  : `The AI wasn't sure about ${others.join(', ')}.`}
                {unconfirmed && others.length > 0 && ` Also check ${others.join(', ')}.`}
                {item.review_note && <span className="pk-item-review-note"> {item.review_note}</span>}
              </span>
              <Button size="small" onClick={onConfirm}>{unconfirmed ? 'Keep it' : 'Looks right'}</Button>
            </div>
          )}

          <div className="pk-item-fields">
            <label className="pk-field pk-item-field--name">
              <span className="pk-field-label">Item</span>
              <Input
                size="small"
                value={name}
                status={status('name')}
                placeholder="What is it?"
                autoFocus={!item.name}
                onChange={e => setName(e.target.value)}
                onBlur={commitName}
                onPressEnter={commitName}
              />
            </label>
            <label className="pk-field">
              <span className="pk-field-label">Qty</span>
              <InputNumber
                size="small"
                min={1}
                value={item.quantity}
                status={status('quantity')}
                onChange={v => onChange({ quantity: v || 1 })}
              />
            </label>
            <label className="pk-field">
              <span className="pk-field-label">Category</span>
              <Select
                size="small"
                value={item.category}
                status={status('category')}
                options={categoryOptions}
                popupMatchSelectWidth={false}
                onChange={v => onChange({ category: v })}
              />
            </label>
            <label className="pk-field">
              <span className="pk-field-label">Size</span>
              <Select
                size="small"
                value={item.size ?? undefined}
                status={status('size')}
                options={ITEM_SIZE_OPTIONS}
                optionRender={optionWithHint}
                popupMatchSelectWidth={false}
                onChange={v => onChange({ size: v })}
              />
            </label>
            <label className="pk-field">
              <span className="pk-field-label">Weight</span>
              <Select
                size="small"
                value={item.weight ?? undefined}
                status={status('weight')}
                options={ITEM_WEIGHT_OPTIONS}
                optionRender={optionWithHint}
                popupMatchSelectWidth={false}
                onChange={v => onChange({ weight: v })}
              />
            </label>
            <label className="pk-field pk-item-field--method">
              <span className="pk-field-label">Packing</span>
              <Select
                size="small"
                value={item.packing_method ?? undefined}
                options={METHOD_OPTIONS}
                optionRender={optionWithHint}
                popupMatchSelectWidth={false}
                labelRender={({ label: chosen }) => (
                  <span className="pk-mult-label">
                    {chosen ?? packingMethodLabel(item.packing_method)}
                    {!item.packing_locked && <span className="pk-mult">Auto</span>}
                  </span>
                )}
                onChange={v => onChange(v === AUTO_METHOD
                  ? { packing_locked: false }
                  : { packing_method: v, packing_locked: true })}
              />
            </label>
          </div>

          <div className="pk-item-checks">
            <span className={uncertain.includes('fragile') ? 'pk-item-check is-unsure' : 'pk-item-check'}>
              <Checkbox checked={item.is_fragile} onChange={e => onChange({ is_fragile: e.target.checked })}>
                Fragile
              </Checkbox>
            </span>
            <span className="pk-item-check">
              <Checkbox checked={item.is_high_value} onChange={e => onChange({ is_high_value: e.target.checked })}>
                High value
              </Checkbox>
            </span>
            <span className={uncertain.includes('disassembly') ? 'pk-item-check is-unsure' : 'pk-item-check'}>
              <Checkbox checked={item.needs_disassembly} onChange={e => onChange({ needs_disassembly: e.target.checked })}>
                Disassembly
              </Checkbox>
            </span>
          </div>
        </div>
      )}
    </li>
  );
};

export default DetectedItemRow;
