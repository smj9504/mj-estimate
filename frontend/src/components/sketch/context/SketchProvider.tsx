import React, { createContext, useContext, ReactNode } from 'react';
import { useSketch, SketchDocument } from '../hooks/useSketch';

interface SketchContextValue {
  sketch: SketchDocument | null;
  loading: boolean;
  error: string | null;
  updateSketch: (updates: Partial<SketchDocument>) => void;
  saveSketch: () => Promise<void>;
  exportSketch: (options: any) => Promise<any>;
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

  return (
    <SketchContext.Provider value={sketchHook}>
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
