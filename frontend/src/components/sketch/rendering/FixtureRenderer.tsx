/**
 * Fixture Renderer Component
 * Renders fixtures (doors, windows, cabinets, etc.) on the sketch canvas using Konva
 */

import React, { useMemo, useRef, useCallback } from 'react';
import { Group, Path, Rect, Text, Line, Shape } from 'react-konva';
import {
  WallFixture,
  RoomFixture,
  Wall,
  Point,
  SketchRoom
} from '../../../types/sketch';
import {
  calculateWallAngle,
  getPointAlongWall,
  feetToPixels,
  findWallForFixture
} from '../../../utils/wallUtils';
import { useThrottle } from '../utils/performanceUtils';

interface WallFixtureRendererProps {
  fixture: WallFixture;
  wall: Wall;
  allWalls?: Wall[]; // For snapping to nearby walls
  isSelected?: boolean;
  onSelect?: (fixtureId: string) => void;
  onDragStart?: (fixtureId: string) => void;
  onDragMove?: (fixtureId: string, position: number) => void;
  onDragEnd?: (fixtureId: string) => void;
  onWallChange?: (fixtureId: string, newWallId: string, position: number) => void;
  onRotate?: (fixtureId: string, rotation: number) => void;
  onContextMenu?: (fixtureId: string, x: number, y: number) => void;
}

interface RoomFixtureRendererProps {
  fixture: RoomFixture;
  room?: SketchRoom;
  isSelected?: boolean;
  onSelect?: (fixtureId: string) => void;
  onDragStart?: (fixtureId: string) => void;
  onDragMove?: (fixtureId: string, position: Point) => void;
  onDragEnd?: (fixtureId: string) => void;
  onRotate?: (fixtureId: string, rotation: number) => void;
  onResize?: (fixtureId: string, newDimensions: { width: number; height: number }) => void;
  onContextMenu?: (fixtureId: string, x: number, y: number) => void;
}

interface DoorSwingProps {
  position: Point;
  width: number;
  rotation: number;
  swingDirection: 'in' | 'out';
  opacity?: number;
}

const DoorSwing: React.FC<DoorSwingProps> = ({
  position,
  width,
  rotation,
  swingDirection,
  opacity = 0.3
}) => {
  // Door swing arc (quarter circle)
  const radius = feetToPixels(width);
  const direction = swingDirection === 'in' ? 1 : -1;

  return (
    <Shape
      x={position.x}
      y={position.y}
      rotation={rotation}
      sceneFunc={(context, shape) => {
        context.beginPath();
        context.arc(0, 0, radius, 0, (Math.PI / 2) * direction);
        context.lineTo(0, 0);
        context.closePath();
        context.fillStrokeShape(shape);
      }}
      fill="rgba(139, 69, 19, 0.1)"
      stroke="rgba(139, 69, 19, 0.5)"
      strokeWidth={1}
      opacity={opacity}
      dash={[5, 5]}
    />
  );
};

export const WallFixtureRenderer: React.FC<WallFixtureRendererProps> = ({
  fixture,
  wall,
  allWalls = [],
  isSelected = false,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onWallChange,
  onRotate,
  onContextMenu
}) => {
  // State for magnetic snap visual feedback
  const [isNearWall, setIsNearWall] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const [nearestWallPoint, setNearestWallPoint] = React.useState<Point | null>(null);
  const [targetWallInfo, setTargetWallInfo] = React.useState<{wallId: string; position: number} | null>(null);

  // Calculate fixture position and rotation
  const position = useMemo(() => {
    return getPointAlongWall(wall, fixture.position);
  }, [wall.start.x, wall.start.y, wall.end.x, wall.end.y, wall.id, fixture.position, fixture.wallId]);

  const rotation = useMemo(() => {
    const wallAngle = calculateWallAngle(wall.start, wall.end) * (180 / Math.PI);

    // For doors and windows, they should always be aligned with the wall
    // The fixture.rotation should already be 0 for auto-aligned fixtures
    let finalRotation;

    if (fixture.category === 'door' || fixture.category === 'window') {
      // Auto-aligned fixtures: use wall angle directly
      finalRotation = wallAngle;

      // Check if fixture.wallId matches wall.id (for debugging wall change issues)
      const wallIdMatch = fixture.wallId === wall.id ||
                         fixture.wallId.startsWith(wall.id + '_segment_') ||
                         wall.id.startsWith(fixture.wallId.split('_segment_')[0]);

      console.log(`🏠 Rendering ${fixture.category} ${fixture.id.slice(0,8)} on wall ${wall.id.slice(0,8)}: wallAngle=${wallAngle.toFixed(1)}°, fixtureRot=${fixture.rotation}°, final=${finalRotation.toFixed(1)}°`);
      console.log(`   Fixture wallId=${fixture.wallId.slice(0,12)}, Wall id=${wall.id.slice(0,12)}, Match=${wallIdMatch ? '✅' : '❌'}`);
      console.log(`   Wall coords: start=(${wall.start.x.toFixed(1)},${wall.start.y.toFixed(1)}) end=(${wall.end.x.toFixed(1)},${wall.end.y.toFixed(1)})`);

      if (!wallIdMatch) {
        console.warn(`⚠️ WARNING: Fixture wallId (${fixture.wallId}) doesn't match rendered wall id (${wall.id})!`);
      }
    } else {
      // Manual fixtures: add fixture rotation to wall angle
      finalRotation = wallAngle + fixture.rotation;
      console.log(`🔧 Rendering manual fixture ${fixture.id.slice(0,8)}: wallAngle=${wallAngle.toFixed(1)}° + fixtureRot=${fixture.rotation.toFixed(1)}° = ${finalRotation.toFixed(1)}°`);
    }

    // Normalize to 0-360 range for proper rendering
    finalRotation = finalRotation % 360;
    if (finalRotation < 0) finalRotation += 360;

    return finalRotation;
  }, [wall.start.x, wall.start.y, wall.end.x, wall.end.y, wall.id, fixture.rotation, fixture.category, fixture.id, fixture.wallId]);

  // Drag move handler with magnetic snap (throttled via useThrottle)
  const handleDragMoveInternal = useCallback((e: any) => {
    const node = e.target;
    const stage = node.getStage();
    if (!stage) return;

    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    // During drag: free movement on same wall, only snap to different walls when close
    const magneticSnapThreshold = 20; // Reduced from 35 to allow more free movement
    const strongSnapThreshold = 12; // Reduced from 20 for less aggressive snapping

    // First, calculate position on current wall
    const currentWallLength = Math.sqrt(
      Math.pow(wall.end.x - wall.start.x, 2) +
      Math.pow(wall.end.y - wall.start.y, 2)
    );

    if (currentWallLength === 0) return;

    const currentWallVector = {
      x: (wall.end.x - wall.start.x) / currentWallLength,
      y: (wall.end.y - wall.start.y) / currentWallLength
    };

    const pointerVectorFromCurrentWall = {
      x: pointer.x - wall.start.x,
      y: pointer.y - wall.start.y
    };

    const projectionOnCurrentWall =
      pointerVectorFromCurrentWall.x * currentWallVector.x +
      pointerVectorFromCurrentWall.y * currentWallVector.y;

    // Apply soft clamping with tolerance to prevent bouncing at edges
    const fixtureWidthPixels = feetToPixels(fixture.dimensions.width);
    const minPosition = 0;
    const maxPosition = currentWallLength - fixtureWidthPixels;
    const clampedPositionOnCurrentWall = Math.max(minPosition, Math.min(maxPosition, projectionOnCurrentWall));

    // Calculate distance from pointer to current wall
    const closestPointOnCurrentWall = {
      x: wall.start.x + currentWallVector.x * projectionOnCurrentWall,
      y: wall.start.y + currentWallVector.y * projectionOnCurrentWall
    };

    const distanceToCurrentWall = Math.sqrt(
      Math.pow(pointer.x - closestPointOnCurrentWall.x, 2) +
      Math.pow(pointer.y - closestPointOnCurrentWall.y, 2)
    );

    // If close to current wall, just move along it without snapping
    const sameWallThreshold = 50; // Increased from 30 to allow more freedom

    if (distanceToCurrentWall <= sameWallThreshold) {
      // Free movement on current wall - no magnetic snap during drag
      setIsNearWall(false);
      setNearestWallPoint(null);
      onDragMove?.(fixture.id, clampedPositionOnCurrentWall);
      return;
    }

    // Check other walls only when far from current wall
    let closestWall = wall;
    let closestDistance = Infinity;
    let closestPosition = 0;

    allWalls.forEach(checkWall => {
      // Skip current wall AND related segments
      if (checkWall.id === wall.id ||
          checkWall.id.startsWith(wall.id.split('_segment_')[0]) ||
          wall.id.startsWith(checkWall.id.split('_segment_')[0])) {
        return;
      }

      const wallLength = Math.sqrt(
        Math.pow(checkWall.end.x - checkWall.start.x, 2) +
        Math.pow(checkWall.end.y - checkWall.start.y, 2)
      );

      if (wallLength === 0) return;

      const wallVector = {
        x: (checkWall.end.x - checkWall.start.x) / wallLength,
        y: (checkWall.end.y - checkWall.start.y) / wallLength
      };

      const pointerVector = {
        x: pointer.x - checkWall.start.x,
        y: pointer.y - checkWall.start.y
      };

      // Project pointer onto wall vector
      const projection = pointerVector.x * wallVector.x + pointerVector.y * wallVector.y;
      const clampedProjection = Math.max(0, Math.min(wallLength, projection));

      // Calculate the closest point on this wall
      const closestPoint = {
        x: checkWall.start.x + wallVector.x * clampedProjection,
        y: checkWall.start.y + wallVector.y * clampedProjection
      };

      // Calculate distance from pointer to closest point on wall
      const distance = Math.sqrt(
        Math.pow(pointer.x - closestPoint.x, 2) +
        Math.pow(pointer.y - closestPoint.y, 2)
      );

      // Magnetic attraction: favor walls that are closer
      if (distance < closestDistance && distance < magneticSnapThreshold) {
        closestWall = checkWall;
        closestDistance = distance;
        closestPosition = clampedProjection;
      }
    });

    // Check if we should snap to another wall
    const shouldSnapToOtherWall = closestWall.id !== wall.id &&
                                   closestDistance < magneticSnapThreshold;

    // Update visual feedback (green border when near other wall)
    setIsNearWall(shouldSnapToOtherWall);

    if (shouldSnapToOtherWall) {
      const wallLength = Math.sqrt(
        Math.pow(closestWall.end.x - closestWall.start.x, 2) +
        Math.pow(closestWall.end.y - closestWall.start.y, 2)
      );
      const wallVector = {
        x: (closestWall.end.x - closestWall.start.x) / wallLength,
        y: (closestWall.end.y - closestWall.start.y) / wallLength
      };
      setNearestWallPoint({
        x: closestWall.start.x + wallVector.x * closestPosition,
        y: closestWall.start.y + wallVector.y * closestPosition
      });

      // When very close to another wall, prepare to snap but don't change wall yet
      // Wall change will happen in handleDragEnd
      if (closestDistance < strongSnapThreshold) {
        console.log(`🎯 Ready to snap fixture ${fixture.id.slice(0,8)} to new wall ${closestWall.id.slice(0,8)} at position ${closestPosition.toFixed(1)}`);
        setTargetWallInfo({ wallId: closestWall.id, position: closestPosition });
      } else {
        setTargetWallInfo(null);
      }

      // Don't update position on current wall when snapping to another wall
      // This allows free movement toward the target wall
      console.log(`   Allowing free movement toward target wall (not constraining to current wall)`);
    } else {
      // Only update position on current wall when NOT near another wall
      setNearestWallPoint(null);
      setTargetWallInfo(null);

      // Free movement along current wall
      console.log(`   Moving along current wall at position ${clampedPositionOnCurrentWall.toFixed(1)}`);
      onDragMove?.(fixture.id, clampedPositionOnCurrentWall);
    }
  }, [wall, fixture.id, onDragMove, onWallChange, allWalls]);

  // Apply throttling to drag move handler
  const handleDragMove = useThrottle(handleDragMoveInternal);

  // Snap to wall on drag end
  const handleDragEnd = useCallback((e: any) => {
    console.log(`🏁 Drag end for fixture ${fixture.id.slice(0,8)}`);

    const node = e.target;
    const stage = node.getStage();

    if (!stage) {
      setTargetWallInfo(null);
      onDragEnd?.(fixture.id);
      return;
    }

    const pointer = stage.getPointerPosition();
    if (!pointer) {
      setTargetWallInfo(null);
      onDragEnd?.(fixture.id);
      return;
    }

    // Re-check for nearby walls at drag end position (don't rely on targetWallInfo from drag move)
    // This ensures we don't miss the snap if user releases mouse slightly away
    const snapThreshold = 30; // Generous threshold for drag end
    let closestWall = wall;
    let closestDistance = Infinity;
    let closestPosition = 0;

    allWalls.forEach(checkWall => {
      // Skip current wall AND related segments
      if (checkWall.id === wall.id ||
          checkWall.id.startsWith(wall.id.split('_segment_')[0]) ||
          wall.id.startsWith(checkWall.id.split('_segment_')[0])) {
        return;
      }

      const wallLength = Math.sqrt(
        Math.pow(checkWall.end.x - checkWall.start.x, 2) +
        Math.pow(checkWall.end.y - checkWall.start.y, 2)
      );

      if (wallLength === 0) return;

      const wallVector = {
        x: (checkWall.end.x - checkWall.start.x) / wallLength,
        y: (checkWall.end.y - checkWall.start.y) / wallLength
      };

      const pointerVector = {
        x: pointer.x - checkWall.start.x,
        y: pointer.y - checkWall.start.y
      };

      const projection = pointerVector.x * wallVector.x + pointerVector.y * wallVector.y;
      const clampedProjection = Math.max(0, Math.min(wallLength, projection));

      const closestPoint = {
        x: checkWall.start.x + wallVector.x * clampedProjection,
        y: checkWall.start.y + wallVector.y * clampedProjection
      };

      const distance = Math.sqrt(
        Math.pow(pointer.x - closestPoint.x, 2) +
        Math.pow(pointer.y - closestPoint.y, 2)
      );

      if (distance < closestDistance && distance < snapThreshold) {
        closestWall = checkWall;
        closestDistance = distance;
        closestPosition = clampedProjection;
      }
    });

    // Check if we found a different wall to snap to
    const targetWallBaseId = closestWall.id.split('_segment_')[0];
    const currentWallBaseId = wall.id.split('_segment_')[0];
    const isDifferentWall = targetWallBaseId !== currentWallBaseId;

    console.log(`   Pointer at: (${pointer.x.toFixed(1)}, ${pointer.y.toFixed(1)})`);
    console.log(`   Closest wall: ${closestWall.id.slice(0,12)}, distance: ${closestDistance.toFixed(1)}px`);
    console.log(`   Current wall: ${wall.id.slice(0,12)}`);
    console.log(`   Base IDs: target="${targetWallBaseId}" vs current="${currentWallBaseId}" → different=${isDifferentWall}`);

    if (isDifferentWall && closestDistance < snapThreshold && onWallChange) {
      console.log(`✅ Changing fixture ${fixture.id.slice(0,8)} from wall ${wall.id.slice(0,12)} to wall ${closestWall.id.slice(0,12)} at position ${closestPosition.toFixed(1)}`);
      onWallChange(fixture.id, closestWall.id, closestPosition);
      setTargetWallInfo(null);
      onDragEnd?.(fixture.id);
      return;
    }

    console.log(`   No wall change: isDifferentWall=${isDifferentWall}, distance=${closestDistance.toFixed(1)}, threshold=${snapThreshold}`);

    // Calculate position on current wall for same-wall drag (reuse existing wall length calculation)
    const wallLength = Math.sqrt(
      Math.pow(wall.end.x - wall.start.x, 2) +
      Math.pow(wall.end.y - wall.start.y, 2)
    );

    if (wallLength === 0) {
      setTargetWallInfo(null);
      onDragEnd?.(fixture.id);
      return;
    }

    const wallVector = {
      x: (wall.end.x - wall.start.x) / wallLength,
      y: (wall.end.y - wall.start.y) / wallLength
    };

    const pointerVector = {
      x: pointer.x - wall.start.x,
      y: pointer.y - wall.start.y
    };

    const projection = pointerVector.x * wallVector.x + pointerVector.y * wallVector.y;
    const fixtureWidthPixels = feetToPixels(fixture.dimensions.width);
    const clampedPosition = Math.max(0, Math.min(wallLength - fixtureWidthPixels, projection));

    // Snap to wall by updating position (for same-wall movement)
    console.log(`   Same-wall drag: updating position to ${clampedPosition.toFixed(1)} on wall ${wall.id.slice(0,12)}`);
    onDragMove?.(fixture.id, clampedPosition);
    setTargetWallInfo(null);
    onDragEnd?.(fixture.id);
  }, [wall, fixture.id, fixture.dimensions.width, onDragMove, onDragEnd, targetWallInfo, onWallChange]);

  const widthPixels = feetToPixels(fixture.dimensions.width);
  const heightPixels = feetToPixels(fixture.dimensions.height);

  // Render based on fixture type
  const renderFixture = () => {
    switch (fixture.category) {
      case 'door':
        return (
          <Group>
            {/* Door frame/opening */}
            <Rect
              x={-widthPixels / 2}
              y={-wall.thickness / 2}
              width={widthPixels}
              height={wall.thickness}
              fill="white"
              stroke={isSelected ? '#1890ff' : fixture.style.strokeColor}
              strokeWidth={isSelected ? 2 : 1}
            />

            {/* Door panel */}
            <Line
              points={[-widthPixels / 2, 0, widthPixels / 2, -wall.thickness / 2]}
              stroke={fixture.style.strokeColor}
              strokeWidth={2}
            />

            {/* Door handle - to show rotation direction */}
            <Rect
              x={widthPixels * 0.3 - 3}
              y={-3}
              width={6}
              height={6}
              fill={fixture.style.strokeColor}
            />

            {/* Door swing arc (if door type) */}
            {fixture.type.includes('door') && fixture.properties.swingDirection && (
              <DoorSwing
                position={{ x: -widthPixels / 2, y: 0 }}
                width={fixture.dimensions.width}
                rotation={0}
                swingDirection={fixture.properties.swingDirection}
              />
            )}
          </Group>
        );

      case 'window':
        return (
          <Group>
            {/* Window frame */}
            <Rect
              x={-widthPixels / 2}
              y={-wall.thickness / 2}
              width={widthPixels}
              height={wall.thickness}
              fill="rgba(135, 206, 235, 0.3)"
              stroke={isSelected ? '#1890ff' : fixture.style.strokeColor}
              strokeWidth={isSelected ? 2 : 1}
            />

            {/* Window panes (cross pattern) */}
            <Line
              points={[0, -wall.thickness / 2, 0, wall.thickness / 2]}
              stroke={fixture.style.strokeColor}
              strokeWidth={1}
            />
            <Line
              points={[-widthPixels / 2, 0, widthPixels / 2, 0]}
              stroke={fixture.style.strokeColor}
              strokeWidth={1}
            />

            {/* Window direction indicator - triangle to show rotation */}
            <Line
              points={[widthPixels * 0.2, -5, widthPixels * 0.4, 0, widthPixels * 0.2, 5]}
              stroke={fixture.style.strokeColor}
              strokeWidth={1}
              closed={false}
            />

            {/* Double/Triple window divisions */}
            {fixture.type === 'double_window' && (
              <Line
                points={[0, -wall.thickness / 2, 0, wall.thickness / 2]}
                stroke={fixture.style.strokeColor}
                strokeWidth={2}
              />
            )}
          </Group>
        );

      default:
        return null;
    }
  };

  // Constrain fixture to stay on wall during drag (unless moving to another wall)
  const dragBoundFunc = useCallback((pos: any) => {
    // Calculate distance to current wall
    const wallLength = Math.sqrt(
      Math.pow(wall.end.x - wall.start.x, 2) +
      Math.pow(wall.end.y - wall.start.y, 2)
    );

    if (wallLength === 0) return pos;

    const wallVector = {
      x: (wall.end.x - wall.start.x) / wallLength,
      y: (wall.end.y - wall.start.y) / wallLength
    };

    // Project the dragged position onto the wall
    const pointerVector = {
      x: pos.x - wall.start.x,
      y: pos.y - wall.start.y
    };

    const projection = pointerVector.x * wallVector.x + pointerVector.y * wallVector.y;

    // Calculate closest point on wall
    const closestPoint = {
      x: wall.start.x + wallVector.x * projection,
      y: wall.start.y + wallVector.y * projection
    };

    // Calculate distance from dragged position to wall
    const distanceToWall = Math.sqrt(
      Math.pow(pos.x - closestPoint.x, 2) +
      Math.pow(pos.y - closestPoint.y, 2)
    );

    // If dragging far from current wall (trying to move to another wall), allow free movement
    const freeDragThreshold = 50;
    if (distanceToWall > freeDragThreshold) {
      return pos; // Allow free dragging
    }

    // Otherwise, constrain to current wall
    const fixtureWidthPixels = feetToPixels(fixture.dimensions.width);
    const clampedProjection = Math.max(0, Math.min(wallLength - fixtureWidthPixels, projection));

    // Return the point on the wall
    return {
      x: wall.start.x + wallVector.x * clampedProjection,
      y: wall.start.y + wallVector.y * clampedProjection
    };
  }, [wall, fixture.dimensions.width]);

  return (
    <Group
      name="fixture-group"
      x={position.x}
      y={position.y}
      rotation={rotation}
      draggable={isSelected} // Only allow drag when selected
      dragBoundFunc={dragBoundFunc} // Constrain to wall
      listening={true} // Always listen for events to ensure fixtures are clickable
      onDragStart={(e) => {
        e.cancelBubble = true;
        e.evt?.stopPropagation();
        setIsDragging(true);
        setIsNearWall(false);
        setNearestWallPoint(null);
        setTargetWallInfo(null);
        onDragStart?.(fixture.id);
      }}
      onDragMove={(e) => {
        e.cancelBubble = true;
        e.evt?.stopPropagation();
        handleDragMove(e);
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true;
        e.evt?.stopPropagation();
        setIsDragging(false);
        setIsNearWall(false);
        setNearestWallPoint(null);
        handleDragEnd(e);
      }}
      onClick={(e) => {
        e.cancelBubble = true;
        e.evt.stopPropagation();
        onSelect?.(fixture.id);
      }}
      onContextMenu={(e) => {
        e.evt.preventDefault();
        e.cancelBubble = true;
        e.evt?.stopPropagation();
        if (onContextMenu) {
          onContextMenu(fixture.id, e.evt.clientX, e.evt.clientY);
        }
      }}
    >
      {renderFixture()}

      {/* Selection indicator - color changes to green when near a wall during drag */}
      {isSelected && (
        <Rect
          x={-widthPixels / 2 - 5}
          y={-wall.thickness / 2 - 5}
          width={widthPixels + 10}
          height={wall.thickness + 10}
          stroke={isDragging && isNearWall ? "#52c41a" : "#1890ff"}
          strokeWidth={2}
          dash={[5, 5]}
          fill="transparent"
        />
      )}
    </Group>
  );
};

export const RoomFixtureRenderer: React.FC<RoomFixtureRendererProps> = ({
  fixture,
  room,
  isSelected = false,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onRotate,
  onResize,
  onContextMenu
}) => {
  const widthPixels = feetToPixels(fixture.dimensions.width);
  const heightPixels = feetToPixels(fixture.dimensions.height);

  // Drag move handler (throttled via useThrottle)
  const handleDragMoveInternal = useCallback((e: any) => {
    const node = e.target;
    const newPosition = {
      x: node.x(),
      y: node.y()
    };
    onDragMove?.(fixture.id, newPosition);
  }, [fixture.id, onDragMove]);

  // Apply throttling to drag move handler
  const handleDragMove = useThrottle(handleDragMoveInternal);

  // Render industry standard 2D symbols
  const renderFixture = () => {
    // Use SVG path if available
    if (fixture.svgPath) {
      return (
        <Group>
          <Path
            data={fixture.svgPath}
            fill={fixture.style.fillColor}
            stroke={fixture.style.strokeColor}
            strokeWidth={fixture.style.strokeWidth}
            scaleX={widthPixels / 60} // SVG viewBox is 60x60
            scaleY={heightPixels / 60}
            offsetX={30} // Center the SVG
            offsetY={30}
          />
        </Group>
      );
    }

    // Fallback to basic shapes
    switch (fixture.category) {
      case 'cabinet':
        return (
          <Group>
            <Rect
              x={-widthPixels / 2}
              y={-heightPixels / 2}
              width={widthPixels}
              height={heightPixels}
              fill={fixture.style.fillColor}
              stroke={fixture.style.strokeColor}
              strokeWidth={fixture.style.strokeWidth}
            />
            {/* Cabinet door lines */}
            <Line
              points={[-widthPixels / 4, -heightPixels / 2, -widthPixels / 4, heightPixels / 2]}
              stroke={fixture.style.strokeColor}
              strokeWidth={1}
            />
            <Line
              points={[widthPixels / 4, -heightPixels / 2, widthPixels / 4, heightPixels / 2]}
              stroke={fixture.style.strokeColor}
              strokeWidth={1}
            />
          </Group>
        );

      case 'vanity':
        return (
          <Group>
            <Rect
              x={-widthPixels / 2}
              y={-heightPixels / 2}
              width={widthPixels}
              height={heightPixels}
              fill={fixture.style.fillColor}
              stroke={fixture.style.strokeColor}
              strokeWidth={fixture.style.strokeWidth}
            />
            {/* Sink basin */}
            <Shape
              sceneFunc={(context, shape) => {
                context.beginPath();
                context.ellipse(0, 0, widthPixels / 3, heightPixels / 3, 0, 0, Math.PI * 2);
                context.closePath();
                context.fillStrokeShape(shape);
              }}
              fill="white"
              stroke={fixture.style.strokeColor}
              strokeWidth={1}
            />
          </Group>
        );

      case 'appliance':
        return (
          <Group>
            <Rect
              x={-widthPixels / 2}
              y={-heightPixels / 2}
              width={widthPixels}
              height={heightPixels}
              fill={fixture.style.fillColor}
              stroke={fixture.style.strokeColor}
              strokeWidth={fixture.style.strokeWidth}
            />
            {/* Appliance-specific details based on type */}
            {fixture.type === 'refrigerator' && (
              <Line
                points={[0, -heightPixels / 2, 0, heightPixels / 2]}
                stroke={fixture.style.strokeColor}
                strokeWidth={2}
              />
            )}
          </Group>
        );

      default:
        return null;
    }
  };

  return (
    <Group
      name="fixture-group"
      x={fixture.position.x}
      y={fixture.position.y}
      rotation={fixture.rotation}
      draggable={isSelected} // Only allow drag when selected
      listening={true} // Always listen for events to ensure fixtures are clickable
      onDragStart={(e) => {
        e.cancelBubble = true;
        e.evt?.stopPropagation();
        onDragStart?.(fixture.id);
      }}
      onDragMove={(e) => {
        e.cancelBubble = true;
        e.evt?.stopPropagation();
        handleDragMove(e);
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true;
        e.evt?.stopPropagation();
        onDragEnd?.(fixture.id);
      }}
      onClick={(e) => {
        e.cancelBubble = true;
        e.evt.stopPropagation();
        onSelect?.(fixture.id);
      }}
      onContextMenu={(e) => {
        e.evt.preventDefault();
        e.cancelBubble = true;
        e.evt?.stopPropagation();
        if (onContextMenu) {
          onContextMenu(fixture.id, e.evt.clientX, e.evt.clientY);
        }
      }}
    >
      {renderFixture()}

      {/* Selection indicator */}
      {isSelected && (
        <Rect
          x={-widthPixels / 2 - 5}
          y={-heightPixels / 2 - 5}
          width={widthPixels + 10}
          height={heightPixels + 10}
          stroke="#1890ff"
          strokeWidth={2}
          dash={[5, 5]}
          fill="transparent"
        />
      )}

      {/* Rotation handle removed - not needed */}
      {false && isSelected && (
        <Group>
          <Line
            points={[0, 0, 0, -heightPixels / 2 - 15]}
            stroke="#1890ff"
            strokeWidth={1}
          />
          <Shape
            x={0}
            y={-heightPixels / 2 - 15}
            sceneFunc={(context, shape) => {
              context.beginPath();
              context.arc(0, 0, 8, 0, Math.PI * 2); // Increased radius from 5 to 8
              context.closePath();
              context.fillStrokeShape(shape);
            }}
            fill="#1890ff"
            stroke="#ffffff"
            strokeWidth={2}
            draggable
            onDragStart={(e) => {
              e.cancelBubble = true;
              e.evt?.stopPropagation();
            }}
            onDragMove={(e) => {
              e.cancelBubble = true;
              e.evt?.stopPropagation();
              // console.log('Room fixture rotation handle dragged');
              const node = e.target;
              const stage = node.getStage();
              if (!stage) return;

              const pointer = stage.getPointerPosition();
              if (!pointer) return;

              // Calculate angle from fixture center to pointer
              const fixtureCenter = {
                x: fixture.position.x,
                y: fixture.position.y
              };

              const angle = Math.atan2(
                pointer.y - fixtureCenter.y,
                pointer.x - fixtureCenter.x
              );

              // Convert to degrees and snap to major increments
              let degrees = (angle * 180 / Math.PI + 90) % 360;
              if (degrees < 0) degrees += 360;

              // Smart snapping: 90-degree increments first, then 45, then 15
              const snap90 = Math.round(degrees / 90) * 90;
              const snap45 = Math.round(degrees / 45) * 45;
              const snap15 = Math.round(degrees / 15) * 15;

              // Use the closest snap point, prioritizing major angles
              const dist90 = Math.abs(degrees - snap90);
              const dist45 = Math.abs(degrees - snap45);
              const dist15 = Math.abs(degrees - snap15);

              if (dist90 <= 7.5) {
                degrees = snap90; // Snap to 90-degree increments within 7.5 degrees
              } else if (dist45 <= 7.5) {
                degrees = snap45; // Snap to 45-degree increments within 7.5 degrees
              } else {
                degrees = snap15; // Default to 15-degree increments
              }

              // Call rotation handler if provided
              // console.log('Calling room fixture rotation:', degrees);
              if (onRotate) {
                onRotate(fixture.id, degrees);
              } else {
                console.error('onRotate not provided for room fixture');
              }
            }}
            onDragEnd={(e) => {
              e.cancelBubble = true;
              e.evt?.stopPropagation();
            }}
          />
        </Group>
      )}

      {/* Resize handles when selected */}
      {isSelected && (
        <Group>
          {/* Corner resize handles */}
          {/* Top-left */}
          <Shape
            x={-widthPixels / 2}
            y={-heightPixels / 2}
            sceneFunc={(context, shape) => {
              context.beginPath();
              context.rect(-3, -3, 6, 6);
              context.closePath();
              context.fillStrokeShape(shape);
            }}
            fill="#1890ff"
            stroke="#1890ff"
            strokeWidth={1}
            draggable
            onDragStart={(e) => {
              e.cancelBubble = true;
              e.evt?.stopPropagation();
            }}
            onDragMove={(e) => {
              e.cancelBubble = true;
              e.evt?.stopPropagation();
              const node = e.target;
              const deltaX = node.x() - (-widthPixels / 2);
              const deltaY = node.y() - (-heightPixels / 2);

              // Calculate new dimensions
              const newWidth = Math.max(0.5, fixture.dimensions.width - deltaX / 20); // 20 pixels = 1 foot
              const newHeight = Math.max(0.5, fixture.dimensions.height - deltaY / 20);

              if (onResize) {
                onResize(fixture.id, { width: newWidth, height: newHeight });
              }
            }}
            onDragEnd={(e) => {
              e.cancelBubble = true;
              e.evt?.stopPropagation();
            }}
          />

          {/* Top-right */}
          <Shape
            x={widthPixels / 2}
            y={-heightPixels / 2}
            sceneFunc={(context, shape) => {
              context.beginPath();
              context.rect(-3, -3, 6, 6);
              context.closePath();
              context.fillStrokeShape(shape);
            }}
            fill="#1890ff"
            stroke="#1890ff"
            strokeWidth={1}
            draggable
            onDragStart={(e) => {
              e.cancelBubble = true;
              e.evt?.stopPropagation();
            }}
            onDragMove={(e) => {
              e.cancelBubble = true;
              e.evt?.stopPropagation();
              const node = e.target;
              const deltaX = node.x() - (widthPixels / 2);
              const deltaY = node.y() - (-heightPixels / 2);

              const newWidth = Math.max(0.5, fixture.dimensions.width + deltaX / 20);
              const newHeight = Math.max(0.5, fixture.dimensions.height - deltaY / 20);

              if (onResize) {
                onResize(fixture.id, { width: newWidth, height: newHeight });
              }
            }}
            onDragEnd={(e) => {
              e.cancelBubble = true;
              e.evt?.stopPropagation();
            }}
          />

          {/* Bottom-left */}
          <Shape
            x={-widthPixels / 2}
            y={heightPixels / 2}
            sceneFunc={(context, shape) => {
              context.beginPath();
              context.rect(-3, -3, 6, 6);
              context.closePath();
              context.fillStrokeShape(shape);
            }}
            fill="#1890ff"
            stroke="#1890ff"
            strokeWidth={1}
            draggable
            onDragStart={(e) => {
              e.cancelBubble = true;
              e.evt?.stopPropagation();
            }}
            onDragMove={(e) => {
              e.cancelBubble = true;
              e.evt?.stopPropagation();
              const node = e.target;
              const deltaX = node.x() - (-widthPixels / 2);
              const deltaY = node.y() - (heightPixels / 2);

              const newWidth = Math.max(0.5, fixture.dimensions.width - deltaX / 20);
              const newHeight = Math.max(0.5, fixture.dimensions.height + deltaY / 20);

              if (onResize) {
                onResize(fixture.id, { width: newWidth, height: newHeight });
              }
            }}
            onDragEnd={(e) => {
              e.cancelBubble = true;
              e.evt?.stopPropagation();
            }}
          />

          {/* Bottom-right */}
          <Shape
            x={widthPixels / 2}
            y={heightPixels / 2}
            sceneFunc={(context, shape) => {
              context.beginPath();
              context.rect(-3, -3, 6, 6);
              context.closePath();
              context.fillStrokeShape(shape);
            }}
            fill="#1890ff"
            stroke="#1890ff"
            strokeWidth={1}
            draggable
            onDragStart={(e) => {
              e.cancelBubble = true;
              e.evt?.stopPropagation();
            }}
            onDragMove={(e) => {
              e.cancelBubble = true;
              e.evt?.stopPropagation();
              const node = e.target;
              const deltaX = node.x() - (widthPixels / 2);
              const deltaY = node.y() - (heightPixels / 2);

              const newWidth = Math.max(0.5, fixture.dimensions.width + deltaX / 20);
              const newHeight = Math.max(0.5, fixture.dimensions.height + deltaY / 20);

              if (onResize) {
                onResize(fixture.id, { width: newWidth, height: newHeight });
              }
            }}
            onDragEnd={(e) => {
              e.cancelBubble = true;
              e.evt?.stopPropagation();
            }}
          />
        </Group>
      )}
    </Group>
  );
};

// Export a container component that renders all fixtures
interface FixtureLayerProps {
  wallFixtures: WallFixture[];
  roomFixtures: RoomFixture[];
  walls: Wall[];
  rooms: SketchRoom[];
  selectedFixtureIds: string[];
  onSelectFixture: (fixtureId: string) => void;
  onMoveWallFixture: (fixtureId: string, newPosition: number) => void;
  onMoveRoomFixture: (fixtureId: string, newPosition: Point) => void;
  onWallChange?: (fixtureId: string, newWallId: string, position: number) => void;
  onRotateWallFixture?: (fixtureId: string, rotation: number) => void;
  onRotateRoomFixture?: (fixtureId: string, rotation: number) => void;
  onResizeRoomFixture?: (fixtureId: string, newDimensions: { width: number; height: number }) => void;
  onDragStartFixture?: (fixtureId: string) => void;
  onDragEndFixture?: (fixtureId: string) => void;
  onContextMenu?: (fixtureId: string, x: number, y: number) => void;
}

export const FixtureLayer: React.FC<FixtureLayerProps> = ({
  wallFixtures,
  roomFixtures,
  walls,
  rooms,
  selectedFixtureIds,
  onSelectFixture,
  onMoveWallFixture,
  onMoveRoomFixture,
  onWallChange,
  onRotateWallFixture,
  onRotateRoomFixture,
  onResizeRoomFixture,
  onDragStartFixture,
  onDragEndFixture,
  onContextMenu
}) => {
  return (
    <Group>
      {/* Render wall fixtures */}
      {wallFixtures.map((fixture) => {
        const wall = findWallForFixture(walls, fixture);
        if (!wall) {
          console.warn(`❌ Cannot render fixture ${fixture.id.slice(0,8)} - wall ${fixture.wallId} not found`);
          return null;
        }

        return (
          <WallFixtureRenderer
            key={fixture.id}
            fixture={fixture}
            wall={wall}
            allWalls={walls}
            isSelected={selectedFixtureIds.includes(fixture.id)}
            onSelect={onSelectFixture}
            onDragStart={onDragStartFixture}
            onDragMove={(id, pos) => onMoveWallFixture(id, pos)}
            onDragEnd={onDragEndFixture}
            onWallChange={onWallChange}
            onRotate={onRotateWallFixture}
            onContextMenu={onContextMenu}
          />
        );
      })}

      {/* Render room fixtures */}
      {roomFixtures.map((fixture) => {
        const room = rooms.find(r => r.id === fixture.roomId);

        return (
          <RoomFixtureRenderer
            key={fixture.id}
            fixture={fixture}
            room={room}
            isSelected={selectedFixtureIds.includes(fixture.id)}
            onSelect={onSelectFixture}
            onDragStart={onDragStartFixture}
            onDragMove={(id, pos) => onMoveRoomFixture(id, pos)}
            onDragEnd={onDragEndFixture}
            onRotate={onRotateRoomFixture}
            onResize={onResizeRoomFixture}
            onContextMenu={onContextMenu}
          />
        );
      })}
    </Group>
  );
};