import React, { useState, useCallback } from 'react';
import {
  SketchDocument,
  Wall,
  WallFixture,
  RoomFixture,
  WallFixtureCategory,
  RoomFixtureCategory,
  SketchExportOptions,
  SketchExportResult,
  Point,
  WallSegment,
  Measurement,
  FixtureCategory,
  DoorType,
  WindowType,
  CabinetType,
  BathroomType,
  BoundingBox,
  AreaCalculation
} from '../../../types/sketch';
import { generateId } from '../utils/idUtils';

// Import utility functions
import {
  calculateWallSegments,
  canPlaceFixtureAt,
  findBestPositionForFixture,
  adjustWallForFixtureSizeChange,
  moveFixtureAlongWall,
  calculateFixtureRotation,
  calculateAutoRotationForWallFixture,
  mergeWallSegments,
  shouldMergeWall,
  createMeasurement,
  pixelsToFeet,
  findWallById,
  findWallForFixture,
  calculateDistance,
  adjustWallSegmentLength,
  getSegmentsForFixture
} from '../../../utils/wallUtils';
import { DEFAULT_FIXTURE_STYLES } from '../../../constants/fixtures';

// Basic sketch hook for initial implementation
export const useSketch = (instanceId: string, initialSketch?: SketchDocument) => {
  const [sketch, setSketch] = useState<SketchDocument | null>(initialSketch || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize with a basic sketch if none provided
  const initializeSketch = useCallback(() => {
    if (!sketch) {
      const defaultSketch: SketchDocument = {
        id: instanceId,
        name: 'New Sketch',
        documentType: 'standalone',
        rooms: [],
        walls: [],
        wallFixtures: [],
        roomFixtures: [],
        metadata: {
          version: '1.0.0',
          scale: {
            pixelsPerFoot: 50,
            gridSize: 1
          },
          bounds: { minX: 0, minY: 0, maxX: 800, maxY: 600 },
          totalAreas: {
            floorArea: 0,
            ceilingArea: 0,
            wallArea: 0,
            netWallArea: 0,
            volume: 0,
            perimeter: 0
          }
        },
        settings: {
          display: {
            showGrid: true,
            showDimensions: true,
            showAreaLabels: true,
            showFixtures: true,
            snapToGrid: true,
            snapTolerance: 10
          },
          measurements: {
            unit: 'imperial',
            precision: 2,
            showInches: true
          },
          defaultStyles: {
            wall: {
              strokeColor: '#333333',
              strokeWidth: 3,
              opacity: 1,
              fillColor: '#f0f0f0'
            },
            room: {
              fillColor: '#e6f3ff',
              strokeColor: '#0066cc',
              strokeWidth: 1,
              opacity: 0.3
            },
            fixtures: DEFAULT_FIXTURE_STYLES as any
          }
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      setSketch(defaultSketch);
    }
  }, [instanceId, sketch]);

  const updateSketch = useCallback((updates: Partial<SketchDocument>) => {
    setSketch(prev => {
      if (!prev) {
        // Create initial sketch if it doesn't exist
        const initialSketch: SketchDocument = {
          id: generateId(),
          name: 'Untitled Sketch',
          walls: [],
          rooms: [],
          wallFixtures: [],
          roomFixtures: [],
          metadata: {
            version: '1.0',
            scale: {
              pixelsPerFoot: 50,
              gridSize: 1
            },
            bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 },
            totalAreas: {
              floorArea: 0,
              ceilingArea: 0,
              wallArea: 0,
              netWallArea: 0,
              volume: 0,
              perimeter: 0
            }
          },
          settings: {
            display: {
              showGrid: true,
              showDimensions: true,
              showAreaLabels: true,
              showFixtures: true,
              snapToGrid: true,
              snapTolerance: 10
            },
            measurements: {
              unit: 'imperial',
              precision: 2,
              showInches: true
            },
            defaultStyles: {
              wall: {
                strokeColor: '#333333',
                strokeWidth: 3,
                fillColor: '#f0f0f0',
                opacity: 1
              },
              room: {
                fillColor: '#f8f8f8',
                strokeColor: '#cccccc',
                strokeWidth: 1,
                opacity: 0.8
              },
              fixtures: {
                door: {
                  fillColor: '#8B4513',
                  strokeColor: '#654321',
                  strokeWidth: 2,
                  opacity: 1
                },
                window: {
                  fillColor: '#87CEEB',
                  strokeColor: '#4682B4',
                  strokeWidth: 2,
                  opacity: 1
                },
                cabinet: {
                  fillColor: '#D2691E',
                  strokeColor: '#A0522D',
                  strokeWidth: 2,
                  opacity: 1
                },
                bathroom: {
                  fillColor: '#E0F7FA',
                  strokeColor: '#00838F',
                  strokeWidth: 2,
                  opacity: 0.8
                },
                electrical: {
                  fillColor: '#FFD700',
                  strokeColor: '#FFA500',
                  strokeWidth: 2,
                  opacity: 1
                },
                plumbing: {
                  fillColor: '#4169E1',
                  strokeColor: '#000080',
                  strokeWidth: 2,
                  opacity: 1
                }
              }
            }
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        return { ...initialSketch, ...updates };
      }

      return { ...prev, ...updates, updatedAt: new Date().toISOString() };
    });
  }, []);

  // ===================
  // Fixture Management
  // ===================

  const addWallFixture = useCallback((
    wallId: string,
    category: WallFixtureCategory,
    type: DoorType | WindowType,
    dimensions: { width: number; height: number },
    preferredPosition?: number
  ): { success: boolean; fixtureId?: string; error?: string } => {
    let resultId: string | undefined;
    let resultError: string | undefined;

    setSketch(prev => {
      if (!prev) {
        resultError = 'No sketch available';
        return null;
      }

      const wall = findWallById(prev.walls, wallId);
      if (!wall) {
        resultError = `Wall not found for ID: ${wallId}`;
        return prev;
      }

      // Convert dimensions from inches to feet for wall utilities
      const fixtureWidthFeet = dimensions.width / 12;
      const fixtureHeightFeet = dimensions.height / 12;

      // Find best position for the fixture
      const position = findBestPositionForFixture(wall, prev.wallFixtures, fixtureWidthFeet, preferredPosition);

      // Check if placement is valid
      const canPlace = canPlaceFixtureAt(wall, prev.wallFixtures, fixtureWidthFeet, position);
      if (!canPlace.canPlace) {
        resultError = canPlace.reason;
        return prev;
      }

      // Prepare default properties based on fixture category
      const defaultProperties: any = {};
      if (category === 'window') {
        // Default sill height of 3 feet for windows
        defaultProperties.sillHeight = {
          feet: 3,
          inches: 0,
          totalInches: 36,
          display: "3' 0\""
        };
      }

      // Create new fixture with dimensions in feet and auto-rotation
      let newFixture: WallFixture = {
        id: generateId(),
        category,
        type,
        position,
        dimensions: { width: fixtureWidthFeet, height: fixtureHeightFeet },
        rotation: calculateAutoRotationForWallFixture(wall), // Auto-align with wall (always 0 for wall fixtures)
        wallId,
        properties: defaultProperties,
        style: DEFAULT_FIXTURE_STYLES[category] || DEFAULT_FIXTURE_STYLES.door,
        isOpening: category === 'door' || category === 'window',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      resultId = newFixture.id;

      // Get only fixtures for this specific wall (filter by exact wallId match)
      const wallSpecificFixtures = prev.wallFixtures.filter(f => f.wallId === wallId);

      // Update wall segments (for visual representation only, no splitting)
      const updatedSegments = calculateWallSegments(wall, [...wallSpecificFixtures, newFixture]);

      // Just update the existing wall with new segments and fixtures array (no splitting)
      const updatedWall: Wall = {
        ...wall,
        segments: updatedSegments,
        fixtures: [...wall.fixtures, newFixture.id], // Add new fixture to fixtures array
        updatedAt: new Date().toISOString()
      };

      const updatedWalls = prev.walls.map(w => w.id === wallId ? updatedWall : w);

      return {
        ...prev,
        wallFixtures: [...prev.wallFixtures, newFixture],
        walls: updatedWalls,
        updatedAt: new Date().toISOString()
      };
    });

    if (resultError) {
      return { success: false, error: resultError };
    }
    return { success: true, fixtureId: resultId };
  }, []);

  const removeWallFixture = useCallback((fixtureId: string): { success: boolean; error?: string } => {
    let resultError: string | undefined;

    setSketch(prev => {
      if (!prev) {
        resultError = 'No sketch available';
        return null;
      }

      const fixture = prev.wallFixtures.find(f => f.id === fixtureId);
      if (!fixture) {
        resultError = 'Fixture not found';
        return prev;
      }

      const wall = findWallForFixture(prev.walls, fixture);
      if (!wall) {
        resultError = `Wall not found for fixture ${fixture.id.slice(0,8)} with wallId: ${fixture.wallId}`;
        return prev;
      }

      // Update wall segments (removing this fixture)
      const remainingFixtures = prev.wallFixtures.filter(f => f.id !== fixtureId);
      const remainingWallFixtures = remainingFixtures.filter(f => f.wallId === wall.id);

      let updatedWalls: Wall[] = prev.walls;

      // Check if wall should be merged after fixture removal
      if (shouldMergeWall(wall, fixture, remainingFixtures)) {
        // console.log(`Merging wall segments for ${wall.id} after removing fixture ${fixtureId}`);

        // Find all wall segments that were created from this original wall
        const originalWallSegments = prev.walls.filter(w =>
          w.id.startsWith(wall.id.split('_segment_')[0]) || w.id === wall.id
        );

        // Merge segments back into original wall
        const originalWall = originalWallSegments.find(w => !w.id.includes('_segment_')) || wall;
        const mergedWall = mergeWallSegments(originalWallSegments, originalWall);

        // Remove all segments and replace with merged wall
        updatedWalls = prev.walls
          .filter(w => !originalWallSegments.some(seg => seg.id === w.id))
          .concat([{
            ...mergedWall,
            segments: calculateWallSegments(mergedWall, remainingWallFixtures),
            fixtures: wall.fixtures.filter(id => id !== fixtureId),
            updatedAt: new Date().toISOString()
          }]);
      } else {
        // Just update the existing wall with new segments
        const updatedSegments = calculateWallSegments(wall, remainingWallFixtures);
        const updatedWall: Wall = {
          ...wall,
          segments: updatedSegments,
          fixtures: wall.fixtures.filter(id => id !== fixtureId),
          updatedAt: new Date().toISOString()
        };
        updatedWalls = prev.walls.map(w => w.id === wall.id ? updatedWall : w);
      }

      return {
        ...prev,
        wallFixtures: remainingFixtures,
        walls: updatedWalls,
        updatedAt: new Date().toISOString()
      };
    });

    if (resultError) {
      return { success: false, error: resultError };
    }
    return { success: true };
  }, []);

  const updateWallFixtureDimensions = useCallback((
    fixtureId: string,
    newDimensions: { width: number; height: number }
  ): { success: boolean; error?: string } => {
    if (!sketch) return { success: false, error: 'No sketch available' };

    const fixture = sketch.wallFixtures.find(f => f.id === fixtureId);
    if (!fixture) return { success: false, error: 'Fixture not found' };

    const wall = findWallForFixture(sketch.walls, fixture);
    if (!wall) return { success: false, error: `Wall not found for fixture ${fixture.id.slice(0,8)} with wallId: ${fixture.wallId}` };

    // Adjust wall and fixture for size change
    const { updatedWall, updatedFixture } = adjustWallForFixtureSizeChange(
      wall,
      fixture,
      newDimensions,
      sketch.wallFixtures
    );

    // Update sketch
    setSketch(prev => {
      if (!prev) return null;
      return {
        ...prev,
        wallFixtures: prev.wallFixtures.map(f => f.id === fixtureId ? updatedFixture : f),
        walls: prev.walls.map(w => w.id === wall.id ? updatedWall : w),
        updatedAt: new Date().toISOString()
      };
    });

    return { success: true };
  }, [sketch]);

  const moveWallFixture = useCallback((
    fixtureId: string,
    newPosition: number
  ): { success: boolean; error?: string } => {
    if (!sketch) return { success: false, error: 'No sketch available' };

    const fixture = sketch.wallFixtures.find(f => f.id === fixtureId);
    if (!fixture) return { success: false, error: 'Fixture not found' };

    const wall = findWallForFixture(sketch.walls, fixture);
    if (!wall) return { success: false, error: `Wall not found for fixture ${fixture.id.slice(0,8)} with wallId: ${fixture.wallId}` };

    // Move fixture along wall with isDragging=true for smooth movement
    const { updatedWall, updatedFixture, canMove, reason } = moveFixtureAlongWall(
      wall,
      fixture,
      newPosition,
      sketch.wallFixtures,
      true // Allow smooth dragging with tolerance
    );

    if (!canMove) {
      return { success: false, error: reason };
    }

    // For door/window fixtures, ensure they maintain auto-rotation alignment
    let finalUpdatedFixture = updatedFixture;
    if (fixture.category === 'door' || fixture.category === 'window') {
      const correctRotation = calculateAutoRotationForWallFixture(wall);
      if (updatedFixture.rotation !== correctRotation) {
        // console.log(`🔧 Auto-correcting rotation for moved ${fixture.category} fixture ${fixture.id.slice(0,8)} from ${updatedFixture.rotation}° to ${correctRotation}°`);
        finalUpdatedFixture = {
          ...updatedFixture,
          rotation: correctRotation
        };
      }
    }

    // Update sketch
    setSketch(prev => {
      if (!prev) return null;
      return {
        ...prev,
        wallFixtures: prev.wallFixtures.map(f => f.id === fixtureId ? finalUpdatedFixture : f),
        walls: prev.walls.map(w => w.id === wall.id ? updatedWall : w),
        updatedAt: new Date().toISOString()
      };
    });

    return { success: true };
  }, [sketch]);

  const changeWallFixtureWall = useCallback((
    fixtureId: string,
    newWallId: string,
    newPosition: number
  ): { success: boolean; error?: string } => {
    if (!sketch) return { success: false, error: 'No sketch available' };

    const fixture = sketch.wallFixtures.find(f => f.id === fixtureId);
    if (!fixture) return { success: false, error: 'Fixture not found' };

    console.log(`🔍 changeWallFixtureWall called:`, {
      fixtureId: fixtureId.slice(0,8),
      fixtureCategory: fixture.category,
      oldWallId: fixture.wallId,
      newWallId: newWallId,
      newPosition: newPosition.toFixed(2),
      fixtureWidth: fixture.dimensions.width
    });

    const oldWall = findWallForFixture(sketch.walls, fixture);
    const newWall = findWallById(sketch.walls, newWallId);

    console.log(`   Wall lookup:`, {
      oldWallFound: !!oldWall,
      newWallFound: !!newWall,
      oldWallId: oldWall?.id,
      newWallId: newWall?.id,
      oldWallCoords: oldWall ? `start=(${oldWall.start.x.toFixed(1)},${oldWall.start.y.toFixed(1)}) end=(${oldWall.end.x.toFixed(1)},${oldWall.end.y.toFixed(1)})` : 'N/A',
      newWallCoords: newWall ? `start=(${newWall.start.x.toFixed(1)},${newWall.start.y.toFixed(1)}) end=(${newWall.end.x.toFixed(1)},${newWall.end.y.toFixed(1)})` : 'N/A'
    });

    if (!oldWall || !newWall) return { success: false, error: `Wall not found - old: ${fixture.wallId}, new: ${newWallId}` };

    // Check if fixture can be placed at the new position
    const wallLength = Math.sqrt(
      Math.pow(newWall.end.x - newWall.start.x, 2) +
      Math.pow(newWall.end.y - newWall.start.y, 2)
    );
    console.log(`   New wall info:`, {
      wallId: newWall.id.slice(0,12),
      wallStart: newWall.start,
      wallEnd: newWall.end,
      wallLength: wallLength.toFixed(2),
      fixtureWidthPixels: (fixture.dimensions.width * 20).toFixed(2),
      position: newPosition.toFixed(2),
      positionPlusWidth: (newPosition + fixture.dimensions.width * 20).toFixed(2)
    });

    const canPlace = canPlaceFixtureAt(newWall, sketch.wallFixtures.filter(f => f.wallId === newWallId), fixture.dimensions.width, newPosition);
    console.log(`   canPlaceFixtureAt result:`, canPlace);

    if (!canPlace.canPlace) {
      // If position is invalid but clampedPosition is provided, use it
      if (canPlace.clampedPosition !== undefined) {
        console.log(`⚠️ Position out of bounds, using clamped position: ${newPosition.toFixed(2)} → ${canPlace.clampedPosition.toFixed(2)}`);
        newPosition = canPlace.clampedPosition;
      } else {
        console.error(`❌ Cannot place fixture: ${canPlace.reason}`);
        return { success: false, error: canPlace.reason };
      }
    }

    // Calculate old and new wall angles for debugging
    const oldWallAngle = Math.atan2(oldWall.end.y - oldWall.start.y, oldWall.end.x - oldWall.start.x) * (180 / Math.PI);
    const newWallAngle = Math.atan2(newWall.end.y - newWall.start.y, newWall.end.x - newWall.start.x) * (180 / Math.PI);

    console.log(`🔄 Moving fixture ${fixtureId.slice(0,8)} from wall ${oldWall.id.slice(0,8)} to wall ${newWallId.slice(0,8)}`);
    console.log(`   Old wall: start=(${oldWall.start.x.toFixed(1)},${oldWall.start.y.toFixed(1)}) end=(${oldWall.end.x.toFixed(1)},${oldWall.end.y.toFixed(1)}) angle=${oldWallAngle.toFixed(1)}°`);
    console.log(`   New wall: start=(${newWall.start.x.toFixed(1)},${newWall.start.y.toFixed(1)}) end=(${newWall.end.x.toFixed(1)},${newWall.end.y.toFixed(1)}) angle=${newWallAngle.toFixed(1)}°`);

    // Update fixture to new wall with auto-rotation for wall fixtures
    const newRotation = (fixture.category === 'door' || fixture.category === 'window')
      ? calculateAutoRotationForWallFixture(newWall)
      : calculateFixtureRotation(newWall, fixture.rotation);

    console.log(`🔄 Fixture ${fixtureId.slice(0,8)} rotation updated: ${fixture.rotation}° → ${newRotation}° (category: ${fixture.category})`);
    console.log(`   Expected visual rotation: oldWall=${oldWallAngle.toFixed(1)}° newWall=${newWallAngle.toFixed(1)}° difference=${(newWallAngle - oldWallAngle).toFixed(1)}°`);

    const updatedFixture: WallFixture = {
      ...fixture,
      wallId: newWallId,
      position: newPosition,
      rotation: newRotation,
      updatedAt: new Date().toISOString()
    };

    // Handle wall splitting/merging when fixture moves between walls
    // Get fixtures that will remain on old wall (excluding moved fixture) - exact wallId match only
    const oldWallFixtures = sketch.wallFixtures.filter(f =>
      f.wallId === oldWall.id && f.id !== fixtureId
    );

    // Get fixtures that will be on new wall (including moved fixture) - exact wallId match only
    const newWallFixtures = sketch.wallFixtures.filter(f =>
      f.wallId === newWall.id
    );
    newWallFixtures.push(updatedFixture);

    let updatedWalls: Wall[] = sketch.walls;

    // Handle old wall - merge if needed and update fixtures array
    if (shouldMergeWall(oldWall, fixture, sketch.wallFixtures.filter(f => f.id !== fixtureId))) {
      // console.log(`🔗 Merging old wall ${oldWall.id} after fixture moved`);

      // Find all wall segments that were created from this original wall
      const originalWallSegments = sketch.walls.filter(w =>
        w.id.startsWith(oldWall.id.split('_segment_')[0]) || w.id === oldWall.id
      );

      // Merge segments back into original wall
      const originalWall = originalWallSegments.find(w => !w.id.includes('_segment_')) || oldWall;
      const mergedOldWall = mergeWallSegments(originalWallSegments, originalWall);

      // Remove all old segments and replace with merged wall
      updatedWalls = updatedWalls
        .filter(w => !originalWallSegments.some(seg => seg.id === w.id))
        .concat([{
          ...mergedOldWall,
          segments: calculateWallSegments(mergedOldWall, oldWallFixtures),
          fixtures: oldWallFixtures.map(f => f.id), // Update fixtures array
          updatedAt: new Date().toISOString()
        }]);
    } else {
      // Just update the existing old wall with new segments and fixtures array
      const oldWallSegments = calculateWallSegments(oldWall, oldWallFixtures);
      const updatedOldWall: Wall = {
        ...oldWall,
        segments: oldWallSegments,
        fixtures: oldWallFixtures.map(f => f.id), // Remove moved fixture from fixtures array
        updatedAt: new Date().toISOString()
      };
      updatedWalls = updatedWalls.map(w => w.id === oldWall.id ? updatedOldWall : w);
    }

    // Update new wall with segments and fixtures array (no splitting)
    const newWallSegments = calculateWallSegments(newWall, newWallFixtures);
    const updatedNewWall: Wall = {
      ...newWall,
      segments: newWallSegments,
      fixtures: newWallFixtures.map(f => f.id), // Add moved fixture to fixtures array
      updatedAt: new Date().toISOString()
    };
    updatedWalls = updatedWalls.map(w => w.id === newWall.id ? updatedNewWall : w);

    // Update sketch
    setSketch(prev => {
      if (!prev) return null;
      return {
        ...prev,
        wallFixtures: prev.wallFixtures.map(f => f.id === fixtureId ? updatedFixture : f),
        walls: updatedWalls,
        updatedAt: new Date().toISOString()
      };
    });

    // console.log(`✅ Fixture ${fixtureId.slice(0,8)} successfully moved to wall ${updatedFixture.wallId.slice(0,12)}`);
    return { success: true };
  }, [sketch]);

  const getWallFixtureById = useCallback((fixtureId: string): WallFixture | undefined => {
    return sketch?.wallFixtures.find(f => f.id === fixtureId);
  }, [sketch]);

  const getWallFixturesByWall = useCallback((wallId: string): WallFixture[] => {
    return sketch?.wallFixtures.filter(f => f.wallId === wallId) || [];
  }, [sketch]);


  const rotateWallFixture = useCallback((
    fixtureId: string,
    rotation: number,
    forceUpdate: boolean = false
  ): { success: boolean; error?: string } => {
    // console.log('rotateWallFixture called:', { fixtureId, rotation, forceUpdate });
    if (!sketch) return { success: false, error: 'No sketch available' };

    const fixture = sketch.wallFixtures.find(f => f.id === fixtureId);
    if (!fixture) return { success: false, error: 'Wall fixture not found' };

    // Allow manual rotation for all fixtures
    // Door/window fixtures can now be rotated manually by the user

    // console.log('Current fixture rotation:', fixture.rotation, '-> New rotation:', rotation);

    const updatedFixture: WallFixture = {
      ...fixture,
      rotation: rotation % 360, // Normalize rotation
      updatedAt: new Date().toISOString()
    };

    // Update sketch
    setSketch(prev => {
      if (!prev) return null;
      return {
        ...prev,
        wallFixtures: prev.wallFixtures.map(f => f.id === fixtureId ? updatedFixture : f),
        updatedAt: new Date().toISOString()
      };
    });

    return { success: true };
  }, [sketch]);

  // Helper function to auto-rotate door/window fixtures when their wall changes
  const updateAutoRotationForWallFixtures = useCallback((wallId: string) => {
    if (!sketch) return;

    const wall = findWallById(sketch.walls, wallId);
    if (!wall) {
      console.warn(`❌ Auto-rotation: Wall not found for ID: ${wallId}`);
      return;
    }

    // Find fixtures that belong to this wall or its segments
    const wallFixtures = sketch.wallFixtures.filter(f => {
      if (f.category !== 'door' && f.category !== 'window') return false;

      // Direct match
      if (f.wallId === wallId) return true;

      // Check if fixture's wallId is a segment of this wall
      if (f.wallId.includes('_segment_') && f.wallId.startsWith(wallId + '_segment_')) return true;

      // Check if wallId is a segment and fixture belongs to the original wall
      if (wallId.includes('_segment_')) {
        const originalWallId = wallId.split('_segment_')[0];
        if (f.wallId === originalWallId) return true;
      }

      return false;
    });

    if (wallFixtures.length === 0) return;

    // console.log(`🔄 Auto-updating rotation for ${wallFixtures.length} door/window fixtures on wall ${wallId.slice(0,8)}`);

    wallFixtures.forEach(fixture => {
      const newRotation = calculateAutoRotationForWallFixture(wall);
      if (fixture.rotation !== newRotation) {
        // console.log(`📐 Auto-rotating fixture ${fixture.id.slice(0,8)} from ${fixture.rotation}° to ${newRotation}°`);
        // Use forceUpdate=true to bypass manual rotation protection
        rotateWallFixture(fixture.id, newRotation, true);
      }
    });
  }, [sketch, rotateWallFixture]);

  // Adjust wall segment length (before or after a fixture)
  const adjustWallFixtureSegmentLength = useCallback((
    fixtureId: string,
    side: 'before' | 'after',
    newLengthFeet: number
  ): { success: boolean; error?: string } => {
    console.log(`📏 adjustWallFixtureSegmentLength called: fixtureId=${fixtureId}, side=${side}, newLengthFeet=${newLengthFeet}`);

    if (!sketch) return { success: false, error: 'No sketch available' };

    const fixture = sketch.wallFixtures.find(f => f.id === fixtureId);
    if (!fixture) {
      console.log('❌ Fixture not found');
      return { success: false, error: 'Fixture not found' };
    }

    const wall = findWallForFixture(sketch.walls, fixture);
    if (!wall) {
      console.log('❌ Wall not found for fixture');
      return { success: false, error: 'Wall not found for fixture' };
    }

    console.log(`📐 Original wall: start=(${wall.start.x}, ${wall.start.y}), end=(${wall.end.x}, ${wall.end.y})`);

    // Convert feet to pixels (20 pixels = 1 foot)
    const newLengthPixels = newLengthFeet * 20;

    // Adjust the wall segment length
    const result = adjustWallSegmentLength(
      wall,
      fixtureId,
      side,
      newLengthPixels,
      sketch.wallFixtures
    );

    if (!result.success) {
      console.log(`❌ adjustWallSegmentLength failed: ${result.error}`);
      return { success: false, error: result.error };
    }

    console.log(`📐 Updated wall: start=(${result.updatedWall.start.x}, ${result.updatedWall.start.y}), end=(${result.updatedWall.end.x}, ${result.updatedWall.end.y})`);

    // Update sketch with new wall
    setSketch(prev => {
      if (!prev) return null;
      return {
        ...prev,
        walls: prev.walls.map(w => w.id === wall.id ? result.updatedWall : w),
        updatedAt: new Date().toISOString()
      };
    });

    console.log('✅ Sketch updated with new wall');
    return { success: true };
  }, [sketch]);

  // ===================
  // Room Fixture Management
  // ===================

  const addRoomFixture = useCallback((
    roomId: string,
    category: RoomFixtureCategory,
    type: CabinetType | BathroomType | string,
    dimensions: { width: number; height: number },
    position: Point
  ): { success: boolean; fixtureId?: string; error?: string } => {
    if (!sketch) return { success: false, error: 'No sketch available' };

    const room = sketch.rooms.find(r => r.id === roomId);
    if (!room) return { success: false, error: 'Room not found' };

    // Convert dimensions from inches to feet for storage
    const dimensionsFeet = {
      width: dimensions.width / 12,
      height: dimensions.height / 12
    };

    // Create new room fixture
    const newFixture: RoomFixture = {
      id: generateId(),
      category,
      type,
      position,
      dimensions: dimensionsFeet,
      rotation: 0, // Default rotation
      roomId,
      properties: {},
      style: DEFAULT_FIXTURE_STYLES[category] || DEFAULT_FIXTURE_STYLES.cabinet,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Update sketch
    setSketch(prev => {
      if (!prev) return null;
      return {
        ...prev,
        roomFixtures: [...prev.roomFixtures, newFixture],
        updatedAt: new Date().toISOString()
      };
    });

    return { success: true, fixtureId: newFixture.id };
  }, [sketch]);

  const removeRoomFixture = useCallback((fixtureId: string): { success: boolean; error?: string } => {
    if (!sketch) return { success: false, error: 'No sketch available' };

    const fixture = sketch.roomFixtures.find(f => f.id === fixtureId);
    if (!fixture) return { success: false, error: 'Room fixture not found' };

    // Update sketch
    setSketch(prev => {
      if (!prev) return null;
      return {
        ...prev,
        roomFixtures: prev.roomFixtures.filter(f => f.id !== fixtureId),
        updatedAt: new Date().toISOString()
      };
    });

    return { success: true };
  }, [sketch]);

  const updateRoomFixtureDimensions = useCallback((
    fixtureId: string,
    newDimensions: { width: number; height: number }
  ): { success: boolean; error?: string } => {
    if (!sketch) return { success: false, error: 'No sketch available' };

    const fixture = sketch.roomFixtures.find(f => f.id === fixtureId);
    if (!fixture) return { success: false, error: 'Room fixture not found' };

    const updatedFixture: RoomFixture = {
      ...fixture,
      dimensions: newDimensions,
      updatedAt: new Date().toISOString()
    };

    // Update sketch
    setSketch(prev => {
      if (!prev) return null;
      return {
        ...prev,
        roomFixtures: prev.roomFixtures.map(f => f.id === fixtureId ? updatedFixture : f),
        updatedAt: new Date().toISOString()
      };
    });

    return { success: true };
  }, [sketch]);

  const updateRoomFixture = useCallback((
    fixtureId: string,
    updates: Partial<RoomFixture>
  ): { success: boolean; error?: string } => {
    if (!sketch) return { success: false, error: 'No sketch available' };

    const fixture = sketch.roomFixtures.find(f => f.id === fixtureId);
    if (!fixture) return { success: false, error: 'Room fixture not found' };

    const updatedFixture: RoomFixture = {
      ...fixture,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    // Update sketch
    setSketch(prev => {
      if (!prev) return null;
      return {
        ...prev,
        roomFixtures: prev.roomFixtures.map(f => f.id === fixtureId ? updatedFixture : f),
        updatedAt: new Date().toISOString()
      };
    });

    return { success: true };
  }, [sketch]);

  const moveRoomFixture = useCallback((
    fixtureId: string,
    newPosition: Point
  ): { success: boolean; error?: string } => {
    if (!sketch) return { success: false, error: 'No sketch available' };

    const fixture = sketch.roomFixtures.find(f => f.id === fixtureId);
    if (!fixture) return { success: false, error: 'Room fixture not found' };

    const updatedFixture: RoomFixture = {
      ...fixture,
      position: newPosition,
      updatedAt: new Date().toISOString()
    };

    // Update sketch
    setSketch(prev => {
      if (!prev) return null;
      return {
        ...prev,
        roomFixtures: prev.roomFixtures.map(f => f.id === fixtureId ? updatedFixture : f),
        updatedAt: new Date().toISOString()
      };
    });

    return { success: true };
  }, [sketch]);

  const rotateRoomFixture = useCallback((
    fixtureId: string,
    rotation: number
  ): { success: boolean; error?: string } => {
    if (!sketch) return { success: false, error: 'No sketch available' };

    const fixture = sketch.roomFixtures.find(f => f.id === fixtureId);
    if (!fixture) return { success: false, error: 'Room fixture not found' };

    const updatedFixture: RoomFixture = {
      ...fixture,
      rotation: rotation % 360, // Normalize rotation
      updatedAt: new Date().toISOString()
    };

    // Update sketch
    setSketch(prev => {
      if (!prev) return null;
      return {
        ...prev,
        roomFixtures: prev.roomFixtures.map(f => f.id === fixtureId ? updatedFixture : f),
        updatedAt: new Date().toISOString()
      };
    });

    return { success: true };
  }, [sketch]);

  const getRoomFixtureById = useCallback((fixtureId: string): RoomFixture | undefined => {
    return sketch?.roomFixtures.find(f => f.id === fixtureId);
  }, [sketch]);

  const getRoomFixturesByRoom = useCallback((roomId: string): RoomFixture[] => {
    return sketch?.roomFixtures.filter(f => f.roomId === roomId) || [];
  }, [sketch]);

  const exportSketch = useCallback(async (options: SketchExportOptions): Promise<SketchExportResult> => {
    if (!sketch) throw new Error('No sketch to export');

    setLoading(true);
    try {
      // Basic export implementation
      const result: SketchExportResult = {
        data: JSON.stringify(options.includeAreas ? sketch : { rooms: sketch.rooms }),
        filename: `${sketch.name || 'sketch'}.${options.format}`,
        mimeType: options.format === 'json' ? 'application/json' : 'text/plain'
      };
      return result;
    } finally {
      setLoading(false);
    }
  }, [sketch]);

  const saveSketch = useCallback(async () => {
    if (!sketch) throw new Error('No sketch to save');

    setLoading(true);
    try {
      // TODO: Implement actual API call
      // console.log('Saving sketch:', sketch);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate API call
    } finally {
      setLoading(false);
    }
  }, [sketch]);

  // Initialize sketch on first mount
  React.useEffect(() => {
    initializeSketch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]); // Only depend on instanceId, not initializeSketch or sketch

  return {
    // Sketch data
    sketch,
    loading,
    error,

    // Basic operations
    updateSketch,
    saveSketch,
    exportSketch,

    // Wall fixture management
    addWallFixture,
    removeWallFixture,
    updateWallFixtureDimensions,
    moveWallFixture,
    changeWallFixtureWall,
    rotateWallFixture,
    adjustWallFixtureSegmentLength,
    getWallFixtureById,
    getWallFixturesByWall,

    // Room fixture management
    addRoomFixture,
    removeRoomFixture,
    updateRoomFixtureDimensions,
    updateRoomFixture,
    moveRoomFixture,
    rotateRoomFixture,
    getRoomFixtureById,
    getRoomFixturesByRoom
  };
};
