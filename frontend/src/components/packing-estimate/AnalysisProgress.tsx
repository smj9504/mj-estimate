/**
 * What a photo analysis is doing and for how long. The server says nothing until
 * a room is done, so this shows the steps that can actually be told apart and a
 * running clock, never a made-up percentage.
 */
import React, { useEffect, useState } from 'react';
import { LoadingOutlined } from '@ant-design/icons';
import type { PhotoRoom } from '../../types/packing-estimate';

/** A room still going after this gets a word on why */
const LONG_ANALYSIS_SECONDS = 60;

/** Analyze All while it runs */
export interface AnalysisBatch {
  ids: string[];
  startedAt: number;
  stopping: boolean;
}

/** Ticks every second, only in the component showing the clock */
function useSecondsSince(since?: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return since ? Math.max(0, Math.floor((now - since) / 1000)) : 0;
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

const stageText = (room: PhotoRoom): string => {
  const single = room.photos.length === 1;
  switch (room.analysis_stage) {
    case 'uploading':
      return `Sending ${single ? 'the photo' : 'the photos'} to the AI.`;
    case 'reading':
      return single
        ? 'The AI is listing each item in the photo with its size, weight and fragility.'
        : 'The AI is comparing the photos, listing each item once with its size, weight and fragility.';
    default:
      return 'Starts when a room in progress finishes.';
  }
};

/** One room's step, under its name */
export const RoomAnalysisProgress: React.FC<{ room: PhotoRoom }> = ({ room }) => {
  const seconds = useSecondsSince(room.analysis_started_at);
  return (
    <span className="pk-room-progress">
      {stageText(room)}
      {room.analysis_started_at && ` ${clock(seconds)}`}
      {seconds >= LONG_ANALYSIS_SECONDS && '. A room with many items takes longer.'}
    </span>
  );
};

/** Analyze All as a whole, above the rooms */
export const BatchAnalysisProgress: React.FC<{
  batch: AnalysisBatch;
  rooms: PhotoRoom[];
  parallel: number;
}> = ({ batch, rooms, parallel }) => {
  const seconds = useSecondsSince(batch.startedAt);
  const inBatch = rooms.filter(r => batch.ids.includes(r.id));
  const running = inBatch.filter(r => r.analysis_stage === 'uploading' || r.analysis_stage === 'reading').length;
  const waiting = inBatch.filter(r => r.analysis_stage === 'waiting').length;
  const done = inBatch.length - running - waiting;

  return (
    <div className="pk-analysis-status" role="status">
      <LoadingOutlined aria-hidden="true" />
      <div>
        {batch.stopping ? (
          <div>Stopping: finishing the {running} room{running === 1 ? '' : 's'} in progress.</div>
        ) : (
          <>
            <div>
              {done} of {inBatch.length} rooms done, {running} in progress, {waiting} waiting
              {/* The clock stays out of the live region, or it's read out every second */}
              <span className="pk-analysis-clock" aria-hidden="true">{clock(seconds)}</span>
            </div>
            <div className="pk-analysis-note">
              Up to {parallel} rooms run at once, usually under a minute each.
            </div>
          </>
        )}
      </div>
    </div>
  );
};
