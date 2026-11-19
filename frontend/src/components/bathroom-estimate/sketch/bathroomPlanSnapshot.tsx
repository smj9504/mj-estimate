/**
 * Each bathroom's plan as its Sketch tab draws it, for a PDF: the real plan
 * canvas mounted off screen with the saved sketch, captured once it has
 * settled (the rooms its walls close and its tile zones are worked out after
 * it loads), then taken down. The PDF of a bathroom that isn't open, or
 * whose Sketch tab was never opened, gets its plan this way rather than the
 * server's rough outline. Loaded on demand (bathroomPdf.ts).
 */

import React, { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import type { BESketchData } from '../../../types/bathroomSketch';
import BESketchCanvas from './BESketchCanvas';
import { tubGlassPanelOf } from './bathroom3dModel';
import { useBESketchState } from './hooks/useBESketchState';
import { captureSketchImage } from './sketchCapture';

const WIDTH = 1200;
const HEIGHT = 900;
// Give up on a plan that won't settle (the PDF goes with the server's)
const TIMEOUT_MS = 8000;

export interface PlanSnapshotItem {
  key: string;
  sketch: BESketchData | null | undefined;
  /** Its estimate, for what the plan draws from it (a tub's glass panel) */
  estimate?: Record<string, any> | null;
}

const hasContent = (s: BESketchData | null | undefined): s is BESketchData =>
  !!s && ((s.rooms?.length ?? 0) > 0 || (s.walls?.length ?? 0) > 0 || (s.fixtures?.length ?? 0) > 0);

const PlanSnapshot: React.FC<{
  sketch: BESketchData;
  estimate?: Record<string, any> | null;
  onDone: (png?: string) => void;
}> = ({ sketch, estimate, onDone }) => {
  const api = useBESketchState();
  const stageRef = useRef<any>(null);
  const loaded = useRef(false);
  const done = useRef(false);
  const latest = useRef(api.data);
  latest.current = api.data;

  useEffect(() => {
    api.loadSketch(sketch);
    loaded.current = true;
    // Once, with the sketch it was given
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Two frames after the last change: the plan has drawn what it worked out
  useEffect(() => {
    if (!loaded.current || done.current) return undefined;
    let cancelled = false;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        // Not before the sketch it was given is in (its load is a change too)
        if (cancelled || done.current || !hasContent(latest.current)) return;
        done.current = true;
        onDone(captureSketchImage(stageRef.current, latest.current));
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [api.data, onDone]);

  return (
    <BESketchCanvas
      api={api}
      width={WIDTH}
      height={HEIGHT}
      stageRef={stageRef}
      zoom={1}
      tubGlassPanel={tubGlassPanelOf(estimate)}
    />
  );
};

/** PNG base64 by key, for each item with something drawn; one that fails is left out */
export async function renderPlanSnapshots(items: PlanSnapshotItem[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const todo = items.filter((i) => hasContent(i.sketch));
  if (!todo.length) return out;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, {
    position: 'fixed', left: '-20000px', top: '0', width: `${WIDTH}px`, height: `${HEIGHT}px`,
    overflow: 'hidden', pointerEvents: 'none',
  });
  document.body.appendChild(host);
  try {
    for (const item of todo) {
      const root = createRoot(host);
      try {
        const png = await new Promise<string | undefined>((resolve) => {
          const timer = window.setTimeout(() => resolve(undefined), TIMEOUT_MS);
          const finish = (p?: string) => {
            window.clearTimeout(timer);
            resolve(p);
          };
          root.render(<PlanSnapshot sketch={item.sketch as BESketchData} estimate={item.estimate} onDone={finish} />);
        });
        if (png) out[item.key] = png;
      } finally {
        root.unmount();
      }
    }
  } finally {
    host.remove();
  }
  return out;
}
