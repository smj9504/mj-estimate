/**
 * Pill — a borderless pastel tag for status and category values.
 * Use it only for values that carry state; plain facts stay plain text.
 */

import React from 'react';
import { tagTones, type TagTone } from '../../../styles/tokens';

export type { TagTone };

interface PillProps {
  tone?: TagTone;
  icon?: React.ReactNode;
  children: React.ReactNode;
  title?: string;
  style?: React.CSSProperties;
  className?: string;
}

const Pill: React.FC<PillProps> = ({ tone = 'gray', icon, children, title, style, className }) => {
  const t = tagTones[tone];
  return (
    <span
      className={`ui-pill${className ? ` ${className}` : ''}`}
      title={title}
      style={{ background: t.bg, color: t.text, ...style }}
    >
      {icon && <span className="ui-pill-icon" aria-hidden="true">{icon}</span>}
      <span className="ui-pill-text">{children}</span>
    </span>
  );
};

/** Same key always lands on the same tone (grey reads as "empty" and red as an error, so neither is used) */
const HASH_TONES: TagTone[] = ['blue', 'green', 'orange', 'purple', 'pink', 'brown', 'yellow'];
export const toneFromKey = (key: string): TagTone => {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return HASH_TONES[Math.abs(hash) % HASH_TONES.length];
};

/** Sentence-case a SNAKE_CASE or UPPER value: "awaiting_response" → "Awaiting response" */
export const humanize = (value: string): string => {
  const s = value.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export default Pill;
