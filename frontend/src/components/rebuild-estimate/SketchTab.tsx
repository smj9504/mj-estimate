/**
 * The rebuild estimate's own sketch, drawn with the flooring estimate's
 * editor. Each room drawn is a room of the estimate, measured from the
 * drawing (floor, ceiling, walls less their doors and windows, outside walls,
 * perimeter, height); the server keeps the rooms in step with it.
 *
 * While nothing is drawn, it can start from a flooring estimate's sketch on
 * the same claim: the rooms that estimate brought in become the rooms drawn.
 */

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Select, Space, Typography } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import FlooringSketchEditor from '../flooring-estimate/sketch/FlooringSketchEditor';
import type { SketchSave } from '../flooring-estimate/sketch/hooks/useSketchAutosave';
import rebuildEstimateService from '../../services/rebuildEstimateService';
import type { FlooringSketch } from '../../types/flooringEstimate';
import type { RebuildEstimate } from '../../types/rebuildEstimate';

const { Text } = Typography;

/** Rooms drawn (an outline of three corners or more) */
export const drawnRoomCount = (sketch: FlooringSketch | null | undefined): number =>
  (sketch?.levels || []).reduce((n, l) => n + (l.rooms || []).filter((r) => (r.points || []).length >= 3).length, 0);

interface Props {
  estimateId: string;
  /** The sketch the editor starts from (it reads it once: key it to start again) */
  initialSketch: FlooringSketch | null | undefined;
  /** The sketch as the server last saved it */
  savedSketch: FlooringSketch | null | undefined;
  sourceCount: number;
  save: SketchSave<RebuildEstimate>;
  onSaved: (saved: RebuildEstimate) => void;
  saveRef: React.MutableRefObject<(() => Promise<void>) | null>;
  copying: boolean;
  onCopy: (flooringEstimateId: string) => void;
}

const SketchTab: React.FC<Props> = ({
  estimateId, initialSketch, savedSketch, sourceCount, save, onSaved, saveRef, copying, onCopy,
}) => {
  const empty = drawnRoomCount(savedSketch) === 0;
  // (the same list the import card shows)
  const { data: offered } = useQuery({
    queryKey: ['rebuild-importable', estimateId, sourceCount],
    queryFn: () => rebuildEstimateService.importable(estimateId),
    enabled: empty,
  });
  const floors = (offered || []).filter((o) => o.kind === 'flooring' && (o.sketch_rooms || 0) > 0);
  const [picked, setPicked] = useState<string | undefined>();
  const chosen = picked ?? floors[0]?.estimate_id;

  return (
    <div data-testid="rebuild-sketch">
      <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>
        Each room drawn is a room of the estimate, measured from the drawing: floor, ceiling, walls less their doors,
        openings and windows, outside walls, perimeter and height. Rename or resize a room here and its repairs follow.
      </Text>
      {empty && floors.length > 0 && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 8 }}
          message="Start from the flooring estimate's sketch"
          description="Its rooms are copied here to change as you need; the rooms it brought in become the rooms drawn."
          action={(
            <Space direction="vertical" size={4} style={{ alignItems: 'flex-end' }}>
              {floors.length > 1 && (
                <Select size="small" value={chosen} onChange={setPicked} style={{ width: 240 }} aria-label="Flooring estimate"
                  options={floors.map((o) => ({ value: o.estimate_id, label: `${o.label} (${o.sketch_rooms} rooms)` }))} />
              )}
              <Button size="small" type="primary" icon={<CopyOutlined />} loading={copying} disabled={!chosen}
                onClick={() => chosen && onCopy(chosen)}>
                Copy its sketch
              </Button>
            </Space>
          )}
        />
      )}
      <FlooringSketchEditor<RebuildEstimate>
        estimateId={estimateId}
        initialSketch={initialSketch}
        save={save}
        onSaved={onSaved}
        saveRef={saveRef}
      />
    </div>
  );
};

export default SketchTab;
