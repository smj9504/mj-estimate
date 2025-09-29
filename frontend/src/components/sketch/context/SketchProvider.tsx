import React, { createContext, useContext, ReactNode, useState } from 'react';
import { useSketch, SketchDocument } from '../hooks/useSketch';

type SketchTool = 'select' | 'wall' | 'room' | 'fixture' | 'measure';

interface SketchContextValue {
  sketch: SketchDocument | null;
  loading: boolean;
  error: string | null;
  updateSketch: (updates: Partial<SketchDocument>) => void;
  saveSketch: () => Promise<void>;
  exportSketch: (options: any) => Promise<any>;
  currentTool: SketchTool;
  setCurrentTool: (tool: SketchTool) => void;
}

const SketchContext = createContext<SketchContextValue | undefined>(undefined);

interface SketchProviderProps {
  instanceId: string;
  initialSketch?: SketchDocument;
  children: ReactNode;
}

export const SketchProvider: React.FC<SketchProviderProps> = ({
  instanceId,
  initialSketch,
  children
}) => {
  const sketchHook = useSketch(instanceId, initialSketch);
  const [currentTool, setCurrentTool] = useState<SketchTool>('select');

  const value: SketchContextValue = {
    ...sketchHook,
    currentTool,
    setCurrentTool,
  };

  return (
    <SketchContext.Provider value={value}>
      {children}
    </SketchContext.Provider>
  );
};

export const useSketchContext = (): SketchContextValue => {
  const context = useContext(SketchContext);
  if (!context) {
    throw new Error('useSketchContext must be used within a SketchProvider');
  }
  return context;
};
