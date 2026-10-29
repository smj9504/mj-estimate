/**
 * A claim's lifecycle stage, and the construction running alongside it.
 * Shared by the client list and the claim rows so a stage reads the same
 * everywhere.
 */

import React from 'react';
import { ToolOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';
import { Pill } from '../common/ui';
import { CLAIM_STAGE_CONFIG } from '../../types/client';
import type { ClaimStage, ConstructionState } from '../../types/client';

// Construction only finishes on the way into these, so they say it already
const AFTER_CONSTRUCTION: ClaimStage[] = ['construction', 'depreciation', 'settlement', 'closed', 'denied'];

interface ClaimStagePillProps {
  stage?: ClaimStage | null;
  detail?: string | null;
  source?: 'auto' | 'manual' | null;
  construction?: ConstructionState | null;
}

export const ClaimStagePill: React.FC<ClaimStagePillProps> = ({ stage, detail, source, construction }) => {
  const cfg = stage ? CLAIM_STAGE_CONFIG[stage] : undefined;
  if (!cfg) return null;
  const tip = [
    cfg.description,
    detail,
    source === 'manual' && 'Set by hand',
  ].filter(Boolean).join(' · ');
  const showConstruction = construction === 'in_progress' && !AFTER_CONSTRUCTION.includes(stage!);
  return (
    <span className="cl-stage">
      <Tooltip title={tip || undefined}>
        <span><Pill tone={cfg.tone}>{cfg.label}{source === 'manual' ? '*' : ''}</Pill></span>
      </Tooltip>
      {showConstruction && (
        <Tooltip title="Rebuild construction in progress">
          <span><Pill tone="yellow" icon={<ToolOutlined />}>Building</Pill></span>
        </Tooltip>
      )}
    </span>
  );
};

export default ClaimStagePill;
