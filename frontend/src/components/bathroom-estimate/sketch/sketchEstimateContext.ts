/**
 * What the sketch's side panel needs from the estimate it's drawn for: the
 * tub's fixed glass panel, set on the estimate, placed on the plan. The plan
 * itself takes it as a prop (react-konva's stage is its own React tree).
 */

import React from 'react';

export interface SketchEstimate {
  /** The tub's fixed glass panel, inches; null without one (bathroom3dModel tubGlassPanelOf) */
  tubGlassPanel: { widthIn: number; heightIn: number } | null;
}

export const SketchEstimateContext = React.createContext<SketchEstimate>({ tubGlassPanel: null });
