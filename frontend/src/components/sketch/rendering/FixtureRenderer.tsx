/**
 * Fixture Renderer Component
 * Renders fixtures (doors, windows, cabinets, etc.) on the sketch canvas using Konva
 */

import React, { useMemo, useRef, useCallback } from 'react';
import { Group, Path, Rect, Text, Line, Shape, Image as KonvaImage } from 'react-konva';
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
import { ROOM_FIXTURE_VARIANTS } from '../../../constants/fixtures';

// Import SVG files
import VanitySvg from '../../../assets/fixtures/vanity.svg';
import ToiletSvg from '../../../assets/fixtures/toilet.svg';
import BathtubSvg from '../../../assets/fixtures/bathtub.svg';
import ShowerSvg from '../../../assets/fixtures/shower.svg';

// SVG to Image helper hook
const useSvgImage = (svgUrl: string) => {
  const [image, setImage] = React.useState<HTMLImageElement | null>(null);

  React.useEffect(() => {
    const img = new window.Image();
    img.src = svgUrl;
    img.onload = () => {
      setImage(img);
    };
  }, [svgUrl]);

  return image;
};

// Get SVG URL by fixture type
const getSvgUrlByType = (type: string): string | null => {
  switch (type) {
    case 'vanity':
      return VanitySvg;
    case 'toilet':
      return ToiletSvg;
    case 'bathtub':
      return BathtubSvg;
    case 'shower':
      return ShowerSvg;
    default:
      return null;
  }
};

interface WallFixtureRendererProps {
  fixture: WallFixture;
  wall: Wall;
  allWalls?: Wall[]; // For snapping to nearby walls
  isSelected?: boolean;
  onSelect?: (fixtureId: string, ctrlKey: boolean) => void;
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
  onSelect?: (fixtureId: string, ctrlKey: boolean) => void;
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

  // Common function to find closest wall to a point
  const findClosestWall = useCallback((
    pointer: Point,
    snapThreshold: number
  ): { wall: Wall; distance: number; position: number } | null => {
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

      // Clamp position to ensure fixture fits on the wall
      const fixtureWidthPixels = feetToPixels(fixture.dimensions.width);
      const maxPosition = Math.max(0, wallLength - fixtureWidthPixels);
      const clampedProjection = Math.max(0, Math.min(maxPosition, projection));

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

    // Return null if no wall found within threshold or if it's the same wall
    const targetWallBaseId = closestWall.id.split('_segment_')[0];
    const currentWallBaseId = wall.id.split('_segment_')[0];
    const isDifferentWall = targetWallBaseId !== currentWallBaseId;

    if (isDifferentWall && closestDistance < snapThreshold) {
      return { wall: closestWall, distance: closestDistance, position: closestPosition };
    }

    return null;
  }, [wall, allWalls, fixture.dimensions.width]);

  // Calculate fixture position on wall
  // Note: Wall splitting has been removed, so position is always relative to the wall start
  const position = useMemo(() => {
    return getPointAlongWall(wall, fixture.position);
  }, [wall.start.x, wall.start.y, wall.end.x, wall.end.y, fixture.position]);

  const rotation = useMemo(() => {
    const wallAngle = calculateWallAngle(wall.start, wall.end) * (180 / Math.PI);

    // For doors and windows, they should always align with the current wall angle
    // For manual fixtures, add the stored relative rotation to the wall angle
    let finalRotation;

    if (fixture.category === 'door' || fixture.category === 'window') {
      finalRotation = wallAngle;
    } else {
      finalRotation = wallAngle + fixture.rotation;
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

    const rawPointer = stage.getPointerPosition();
    if (!rawPointer) return;

    // Transform pointer to wall coordinate system (account for zoom/pan)
    const scale = stage.scaleX();
    const stagePos = stage.position();
    const pointer = {
      x: (rawPointer.x - stagePos.x) / scale,
      y: (rawPointer.y - stagePos.y) / scale
    };

    const magneticSnapThreshold = 30; // Increased for better detection
    const strongSnapThreshold = 20; // Distance to lock onto target wall

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

    // If close to current wall, just move along it
    const sameWallThreshold = 50;

    if (distanceToCurrentWall <= sameWallThreshold) {
      setIsNearWall(false);
      setNearestWallPoint(null);
      setTargetWallInfo(null);
      onDragMove?.(fixture.id, clampedPositionOnCurrentWall);
      return;
    }

    // Check for nearby walls using common function
    const nearbyWall = findClosestWall(pointer, magneticSnapThreshold);

    if (nearbyWall) {
      // Found a nearby wall - show visual feedback
      setIsNearWall(true);

      const wallLength = Math.sqrt(
        Math.pow(nearbyWall.wall.end.x - nearbyWall.wall.start.x, 2) +
        Math.pow(nearbyWall.wall.end.y - nearbyWall.wall.start.y, 2)
      );
      const wallVector = {
        x: (nearbyWall.wall.end.x - nearbyWall.wall.start.x) / wallLength,
        y: (nearbyWall.wall.end.y - nearbyWall.wall.start.y) / wallLength
      };

      setNearestWallPoint({
        x: nearbyWall.wall.start.x + wallVector.x * nearbyWall.position,
        y: nearbyWall.wall.start.y + wallVector.y * nearbyWall.position
      });

      // Lock onto target wall when very close
      if (nearbyWall.distance < strongSnapThreshold) {
        setTargetWallInfo({
          wallId: nearbyWall.wall.id,
          position: nearbyWall.position
        });
      } else {
        setTargetWallInfo(null);
      }
    } else {
      // No nearby wall - move freely on current wall
      setIsNearWall(false);
      setNearestWallPoint(null);
      setTargetWallInfo(null);
      onDragMove?.(fixture.id, clampedPositionOnCurrentWall);
    }
  }, [wall, fixture.id, fixture.dimensions.width, onDragMove, findClosestWall]);

  // Apply throttling to drag move handler
  const handleDragMove = useThrottle(handleDragMoveInternal);

  // Snap to wall on drag end
  const handleDragEnd = useCallback((e: any) => {
    const node = e.target;
    const stage = node.getStage();

    if (!stage) {
      setTargetWallInfo(null);
      setIsNearWall(false);
      setNearestWallPoint(null);
      onDragEnd?.(fixture.id);
      return;
    }

    const rawPointer = stage.getPointerPosition();
    if (!rawPointer) {
      setTargetWallInfo(null);
      setIsNearWall(false);
      setNearestWallPoint(null);
      onDragEnd?.(fixture.id);
      return;
    }

    // Transform pointer to wall coordinate system (account for zoom/pan)
    const scale = stage.scaleX();
    const stagePos = stage.position();
    const pointer = {
      x: (rawPointer.x - stagePos.x) / scale,
      y: (rawPointer.y - stagePos.y) / scale
    };

    // Use slightly larger threshold at drag end to ensure reliable snapping
    const snapThreshold = 35;

    // Use common function to find closest wall
    const nearbyWall = findClosestWall(pointer, snapThreshold);

    if (nearbyWall && onWallChange) {
      onWallChange(fixture.id, nearbyWall.wall.id, nearbyWall.position);
      setTargetWallInfo(null);
      setIsNearWall(false);
      setNearestWallPoint(null);
      onDragEnd?.(fixture.id);
      return;
    }

    // No wall change - finalize position on current wall
    const wallLength = Math.sqrt(
      Math.pow(wall.end.x - wall.start.x, 2) +
      Math.pow(wall.end.y - wall.start.y, 2)
    );

    if (wallLength === 0) {
      setTargetWallInfo(null);
      setIsNearWall(false);
      setNearestWallPoint(null);
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

    // Finalize position on current wall
    onDragMove?.(fixture.id, clampedPosition);
    setTargetWallInfo(null);
    setIsNearWall(false);
    setNearestWallPoint(null);
    onDragEnd?.(fixture.id);
  }, [wall, fixture.id, fixture.dimensions.width, fixture.wallId, allWalls, onDragMove, onDragEnd, onWallChange, findClosestWall]);

  // Convert feet to pixels (fixture.dimensions are stored in feet)
  const widthPixels = feetToPixels(fixture.dimensions.width);
  const heightPixels = feetToPixels(fixture.dimensions.height);

  // Minimum clickable area for better user interaction
  const minClickableHeight = 20; // pixels
  const clickableHeight = Math.max(wall.thickness, minClickableHeight);

  // Render based on fixture type
  const renderFixture = () => {
    switch (fixture.category) {
      case 'door':
        return (
          <Group>
            {/* Invisible larger hitbox for easier clicking */}
            <Rect
              x={-widthPixels / 2}
              y={-clickableHeight / 2}
              width={widthPixels}
              height={clickableHeight}
              fill="transparent"
              listening={true}
            />

            {/* Door frame/opening */}
            <Rect
              x={-widthPixels / 2}
              y={-wall.thickness / 2}
              width={widthPixels}
              height={wall.thickness}
              fill="white"
              stroke={isSelected ? '#1890ff' : fixture.style.strokeColor}
              strokeWidth={isSelected ? 2 : 1}
              listening={false}
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
            {/* Invisible larger hitbox for easier clicking */}
            <Rect
              x={-widthPixels / 2}
              y={-clickableHeight / 2}
              width={widthPixels}
              height={clickableHeight}
              fill="transparent"
              listening={true}
            />

            {/* Window frame */}
            <Rect
              x={-widthPixels / 2}
              y={-wall.thickness / 2}
              width={widthPixels}
              height={wall.thickness}
              fill="rgba(135, 206, 235, 0.3)"
              stroke={isSelected ? '#1890ff' : fixture.style.strokeColor}
              strokeWidth={isSelected ? 2 : 1}
              listening={false}
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

  // Allow free movement during drag - wall snapping happens in handleDragEnd
  const dragBoundFunc = useCallback((pos: any) => {
    // Allow completely free dragging
    // The fixture will snap to walls in handleDragEnd based on proximity
    return pos;
  }, []);

  // Drag move handler - rotation is handled by Group rotation prop, not during drag
  const handleDragMoveOnly = useCallback((e: any) => {
    // Don't manipulate rotation during drag - it causes jitter
    // The Group's rotation prop will handle rotation automatically
    handleDragMove(e);
  }, [handleDragMove]);

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
        handleDragMoveOnly(e);
        // Close context menu while dragging
        if (onContextMenu) {
          onContextMenu(fixture.id, -1, -1); // Signal to close menu
        }
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true;
        e.evt?.stopPropagation();
        setIsDragging(false);
        setIsNearWall(false);
        setNearestWallPoint(null);
        handleDragEnd(e);
        // Close context menu on drag end
        if (onContextMenu) {
          onContextMenu(fixture.id, -1, -1); // Signal to close menu
        }
      }}
      onClick={(e) => {
        e.cancelBubble = true;
        e.evt.stopPropagation();
        const isMultiSelect = e.evt.ctrlKey || e.evt.metaKey;
        onSelect?.(fixture.id, isMultiSelect);
        // Close context menu on click
        if (onContextMenu) {
          onContextMenu(fixture.id, -1, -1); // Signal to close menu
        }
      }}
      onContextMenu={(e) => {
        e.evt.preventDefault();
        e.cancelBubble = true;
        e.evt?.stopPropagation();
        if (onContextMenu && e.evt) {
          // Use the actual mouse click position from the browser event
          const menuX = e.evt.clientX;
          const menuY = e.evt.clientY;

          onContextMenu(fixture.id, menuX, menuY);
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

      {/* Dimension line showing fixture width */}
      <Group>
        {/* Dimension line */}
        <Line
          points={[
            -widthPixels / 2,
            wall.thickness / 2 + 15,
            widthPixels / 2,
            wall.thickness / 2 + 15
          ]}
          stroke="#666"
          strokeWidth={1}
        />
        {/* Left end mark */}
        <Line
          points={[
            -widthPixels / 2,
            wall.thickness / 2 + 10,
            -widthPixels / 2,
            wall.thickness / 2 + 20
          ]}
          stroke="#666"
          strokeWidth={1}
        />
        {/* Right end mark */}
        <Line
          points={[
            widthPixels / 2,
            wall.thickness / 2 + 10,
            widthPixels / 2,
            wall.thickness / 2 + 20
          ]}
          stroke="#666"
          strokeWidth={1}
        />
        {/* Width text */}
        <Text
          x={0}
          y={wall.thickness / 2 + 20}
          text={`${Math.floor(fixture.dimensions.width)}' ${Math.round((fixture.dimensions.width % 1) * 12)}"`}
          fontSize={12}
          fill="#333"
          align="center"
          offsetX={20}
        />
      </Group>
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
  // Convert feet to pixels (fixture.dimensions are stored in feet)
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

  // Load SVG image for bathroom fixtures
  const svgUrl = fixture.category === 'bathroom' ? getSvgUrlByType(fixture.type) : null;
  const svgImage = useSvgImage(svgUrl || '');

  // Render fixtures based on category and type
  const renderFixture = () => {
    // For bathroom fixtures, render the SVG image
    if (fixture.category === 'bathroom' && svgImage) {
      return (
        <Group>
          {/* SVG Image */}
          <KonvaImage
            x={-widthPixels / 2}
            y={-heightPixels / 2}
            width={widthPixels}
            height={heightPixels}
            image={svgImage}
          />

          {/* Optional label */}
          {fixture.label && (
            <Text
              text={fixture.label}
              fontSize={10}
              fontFamily="Arial"
              fill={fixture.style.strokeColor}
              align="center"
              width={widthPixels}
              x={-widthPixels / 2}
              y={heightPixels / 2 + 5}
            />
          )}
        </Group>
      );
    }

    // For generic cabinets and other fixtures, render as simple rectangle with label
    const label = fixture.label || fixture.type.replace(/_/g, ' ').toUpperCase();

    return (
      <Group>
        {/* Background rectangle */}
        <Rect
          x={-widthPixels / 2}
          y={-heightPixels / 2}
          width={widthPixels}
          height={heightPixels}
          fill={fixture.style.fillColor}
          stroke={fixture.style.strokeColor}
          strokeWidth={fixture.style.strokeWidth}
        />
        {/* Text label */}
        <Text
          text={label}
          fontSize={12}
          fontFamily="Arial"
          fill={fixture.style.strokeColor}
          align="center"
          verticalAlign="middle"
          width={widthPixels}
          height={heightPixels}
          x={-widthPixels / 2}
          y={-heightPixels / 2}
        />
      </Group>
    );
  };

  return (
    <Group
      name="fixture-group"
      x={fixture.position.x}
      y={fixture.position.y}
      rotation={fixture.rotation}
      draggable={isSelected} // Draggable when selected, just like room elements
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
        // Close context menu while dragging
        if (onContextMenu) {
          onContextMenu(fixture.id, -1, -1); // Signal to close menu
        }
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true;
        e.evt?.stopPropagation();
        onDragEnd?.(fixture.id);
        // Close context menu on drag end
        if (onContextMenu) {
          onContextMenu(fixture.id, -1, -1); // Signal to close menu
        }
      }}
      onClick={(e) => {
        e.cancelBubble = true;
        e.evt.stopPropagation();
        const isMultiSelect = e.evt.ctrlKey || e.evt.metaKey;
        onSelect?.(fixture.id, isMultiSelect);
        // Close context menu on click
        if (onContextMenu) {
          onContextMenu(fixture.id, -1, -1); // Signal to close menu
        }
      }}
      onContextMenu={(e) => {
        e.evt.preventDefault();
        e.cancelBubble = true;
        e.evt?.stopPropagation();
        if (onContextMenu && e.evt) {
          // Use the actual mouse click position from the browser event
          const menuX = e.evt.clientX;
          const menuY = e.evt.clientY;

          onContextMenu(fixture.id, menuX, menuY);
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

      {/* Rotation handle - Figma style */}
      {isSelected && (
        <Group>
          <Line
            points={[0, -heightPixels / 2, 0, -heightPixels / 2 - 30]}
            stroke="#1890ff"
            strokeWidth={1}
          />
          <Shape
            x={0}
            y={-heightPixels / 2 - 30}
            sceneFunc={(context, shape) => {
              context.beginPath();
              context.arc(0, 0, 8, 0, Math.PI * 2);
              context.closePath();
              context.fillStrokeShape(shape);
            }}
            fill="#1890ff"
            stroke="#ffffff"
            strokeWidth={2}
            onMouseDown={(e) => {
              e.cancelBubble = true;
              e.evt?.stopPropagation();

              const node = e.target;
              const stage = node.getStage();
              if (!stage) return;

              // Get stage scale and position for zoom/pan
              const scale = stage.scaleX();
              const stagePos = stage.position();

              // Global mouse move handler
              const handleGlobalMouseMove = (evt: MouseEvent) => {
                const stageContainer = stage.container().getBoundingClientRect();
                const pointer = {
                  x: evt.clientX - stageContainer.left,
                  y: evt.clientY - stageContainer.top
                };

                // Transform pointer to canvas coordinates
                const canvasPointer = {
                  x: (pointer.x - stagePos.x) / scale,
                  y: (pointer.y - stagePos.y) / scale
                };

                // Calculate angle from fixture center to pointer
                const angle = Math.atan2(
                  canvasPointer.y - fixture.position.y,
                  canvasPointer.x - fixture.position.x
                );

                // Convert to degrees (0-360)
                let degrees = (angle * 180 / Math.PI + 90) % 360;
                if (degrees < 0) degrees += 360;

                // Smart snapping: 90-degree increments first, then 45, then 15
                const snap90 = Math.round(degrees / 90) * 90;
                const snap45 = Math.round(degrees / 45) * 45;
                const snap15 = Math.round(degrees / 15) * 15;

                const dist90 = Math.abs(degrees - snap90);
                const dist45 = Math.abs(degrees - snap45);

                if (dist90 <= 7.5) {
                  degrees = snap90;
                } else if (dist45 <= 7.5) {
                  degrees = snap45;
                } else {
                  degrees = snap15;
                }

                // Call rotation handler
                if (onRotate) {
                  onRotate(fixture.id, degrees);
                }
              };

              // Global mouse up handler
              const handleGlobalMouseUp = () => {
                window.removeEventListener('mousemove', handleGlobalMouseMove);
                window.removeEventListener('mouseup', handleGlobalMouseUp);
              };

              // Add global listeners
              window.addEventListener('mousemove', handleGlobalMouseMove);
              window.addEventListener('mouseup', handleGlobalMouseUp);
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
  onSelectFixture: (fixtureId: string, ctrlKey: boolean) => void;
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
  // Track fixtures with missing walls to avoid repeated warnings
  const [reportedMissingFixtures] = React.useState(new Set<string>());

  return (
    <Group>
      {/* Render wall fixtures */}
      {wallFixtures.map((fixture) => {
        const wall = findWallForFixture(walls, fixture);
        if (!wall) {
          // Only warn once per fixture to avoid console spam
          if (!reportedMissingFixtures.has(fixture.id)) {
            console.warn(`❌ Fixture ${fixture.id.slice(0,8)}: wall ${fixture.wallId} not found`);
            reportedMissingFixtures.add(fixture.id);
          }
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