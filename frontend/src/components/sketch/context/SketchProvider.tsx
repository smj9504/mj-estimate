import React, { createContext, useContext, ReactNode, useState, useMemo, useCallback } from 'react';
import { useSketch } from '../hooks/useSketch';
import { SketchDocument, SketchTool, WallFixtureCategory, RoomFixtureCategory, DoorType, WindowType, CabinetType, VanityType, ApplianceType, WallFixture, RoomFixture, Point, FixtureVariant, Dimensions } from '../../../types/sketch';

interface SketchContextValue {
  // Sketch data
  sketch: SketchDocument | null;
  loading: boolean;
  error: string | null;

  // Basic operations
  updateSketch: (updates: Partial<SketchDocument>) => void;
  saveSketch: () => Promise<void>;
  exportSketch: (options: any) => Promise<any>;

  // UI state
  currentTool: SketchTool;
  setCurrentTool: (tool: SketchTool) => void;

  // Fixture placement state
  selectedFixture: FixtureVariant | null;
  fixtureDimensions: Dimensions | null;
  placementMode: 'wall' | 'room' | null;
  setFixturePlacement: (fixture: FixtureVariant | null, dimensions: Dimensions | null, mode: 'wall' | 'room' | null) => void;

  // Wall fixture management
  addWallFixture: (
    wallId: string,
    category: WallFixtureCategory,
    type: DoorType | WindowType,
    dimensions: { width: number; height: number },
    preferredPosition?: number
  ) => { success: boolean; fixtureId?: string; error?: string };
  removeWallFixture: (fixtureId: string) => { success: boolean; error?: string };
  updateWallFixtureDimensions: (
    fixtureId: string,
    newDimensions: { width: number; height: number }
  ) => { success: boolean; error?: string };
  moveWallFixture: (
    fixtureId: string,
    newPosition: number
  ) => { success: boolean; error?: string };
  changeWallFixtureWall: (
    fixtureId: string,
    newWallId: string,
    newPosition: number
  ) => { success: boolean; error?: string };
  rotateWallFixture: (
    fixtureId: string,
    rotation: number,
    forceUpdate?: boolean
  ) => { success: boolean; error?: string };
  getWallFixtureById: (fixtureId: string) => WallFixture | undefined;
  getWallFixturesByWall: (wallId: string) => WallFixture[];

  // Room fixture management
  addRoomFixture: (
    roomId: string,
    category: RoomFixtureCategory,
    type: CabinetType | VanityType | ApplianceType,
    dimensions: { width: number; height: number },
    position: Point
  ) => { success: boolean; fixtureId?: string; error?: string };
  removeRoomFixture: (fixtureId: string) => { success: boolean; error?: string };
  updateRoomFixtureDimensions: (
    fixtureId: string,
    newDimensions: { width: number; height: number }
  ) => { success: boolean; error?: string };
  moveRoomFixture: (
    fixtureId: string,
    newPosition: Point
  ) => { success: boolean; error?: string };
  rotateRoomFixture: (
    fixtureId: string,
    rotation: number
  ) => { success: boolean; error?: string };
  getRoomFixtureById: (fixtureId: string) => RoomFixture | undefined;
  getRoomFixturesByRoom: (roomId: string) => RoomFixture[];

  // Wall segment adjustment
  adjustWallFixtureSegmentLength: (
    fixtureId: string,
    side: 'before' | 'after',
    newLengthFeet: number
  ) => { success: boolean; error?: string };
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
  const [selectedFixture, setSelectedFixture] = useState<FixtureVariant | null>(null);
  const [fixtureDimensions, setFixtureDimensions] = useState<Dimensions | null>(null);
  const [placementMode, setPlacementMode] = useState<'wall' | 'room' | null>(null);

  const setFixturePlacement = useCallback((fixture: FixtureVariant | null, dimensions: Dimensions | null, mode: 'wall' | 'room' | null) => {
    setSelectedFixture(fixture);
    setFixtureDimensions(dimensions);
    setPlacementMode(mode);
  }, []);

  const value: SketchContextValue = useMemo(() => ({
    // Spread sketch hook values
    ...sketchHook,

    // UI state
    currentTool,
    setCurrentTool,

    // Fixture placement state
    selectedFixture,
    fixtureDimensions,
    placementMode,
    setFixturePlacement,
  }), [
    sketchHook,
    currentTool,
    selectedFixture,
    fixtureDimensions,
    placementMode,
    setFixturePlacement
  ]);

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
