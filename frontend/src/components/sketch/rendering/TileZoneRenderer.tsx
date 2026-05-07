/**
 * Tile Zone Renderer
 * Visualizes tile estimation zones on the sketch canvas using Konva
 * Shows colored overlays for floor, wall, tub deck, tub panel, surround areas
 */

import React, { useMemo } from 'react';
import { Group, Rect, Text, Shape, Line } from 'react-konva';
import {
  SketchRoom,
  RoomFixture,
  TileZone,
  TileCalculationResult,
  BathtubSubType,
  Point,
} from '../../../types/sketch';
import { BATHTUB_SUBTYPE_DEFAULTS } from '../../../constants/fixtures';

const ZONE_COLORS: Record<string, { fill: string; stroke: string }> = {
  floor: { fill: 'rgba(24, 144, 255, 0.15)', stroke: 'rgba(24, 144, 255, 0.6)' },
  wall: { fill: 'rgba(82, 196, 26, 0.15)', stroke: 'rgba(82, 196, 26, 0.6)' },
  tub_deck: { fill: 'rgba(250, 173, 20, 0.25)', stroke: 'rgba(250, 173, 20, 0.8)' },
  tub_front_panel: { fill: 'rgba(250, 140, 22, 0.25)', stroke: 'rgba(250, 140, 22, 0.8)' },
  tub_surround: { fill: 'rgba(235, 47, 150, 0.15)', stroke: 'rgba(235, 47, 150, 0.6)' },
  shower_wall: { fill: 'rgba(114, 46, 209, 0.15)', stroke: 'rgba(114, 46, 209, 0.6)' },
  shower_floor: { fill: 'rgba(19, 194, 194, 0.2)', stroke: 'rgba(19, 194, 194, 0.7)' },
};

interface TileZoneRendererProps {
  room: SketchRoom;
  roomFixtures: RoomFixture[];
  result: TileCalculationResult;
  pixelsPerFoot: number;
  highlightedZoneType: string | null;
  visible: boolean;
}

/**
 * Render floor tile zone as room boundary fill
 */
const FloorZoneOverlay: React.FC<{
  room: SketchRoom;
  highlighted: boolean;
  pixelsPerFoot: number;
}> = ({ room, highlighted, pixelsPerFoot }) => {
  if (!room.boundary || room.boundary.length < 3) return null;

  const colors = ZONE_COLORS.floor;
  const opacity = highlighted ? 0.35 : 0.15;

  return (
    <Group>
      <Shape
        sceneFunc={(context, shape) => {
          context.beginPath();
          const b = room.boundary;
          context.moveTo(b[0].x, b[0].y);
          for (let i = 1; i < b.length; i++) {
            context.lineTo(b[i].x, b[i].y);
          }
          context.closePath();
          context.fillStrokeShape(shape);
        }}
        fill={highlighted ? 'rgba(24, 144, 255, 0.35)' : colors.fill}
        stroke={colors.stroke}
        strokeWidth={highlighted ? 2 : 1}
        dash={[6, 3]}
      />
      {/* Label */}
      {room.boundary.length > 0 && (
        <Text
          x={room.boundary.reduce((s, p) => s + p.x, 0) / room.boundary.length - 30}
          y={room.boundary.reduce((s, p) => s + p.y, 0) / room.boundary.length - 8}
          text="FLOOR TILE"
          fontSize={11}
          fontStyle="bold"
          fill={colors.stroke}
          opacity={highlighted ? 1 : 0.7}
        />
      )}
    </Group>
  );
};

/**
 * Render bathtub deck overlay
 */
const TubDeckOverlay: React.FC<{
  fixture: RoomFixture;
  highlighted: boolean;
  pixelsPerFoot: number;
}> = ({ fixture, highlighted, pixelsPerFoot }) => {
  const subType = (fixture.properties?.bathtubSubType || 'standard_alcove') as BathtubSubType;
  const defaults = BATHTUB_SUBTYPE_DEFAULTS[subType];

  if (subType !== 'corner_garden' && subType !== 'drop_in') return null;

  const deckWidthIn = fixture.properties?.deckWidth ?? defaults.deckWidth;
  const deckWidthPx = (deckWidthIn / 12) * pixelsPerFoot;
  const tubWidthPx = fixture.dimensions.width * pixelsPerFoot;
  const tubHeightPx = fixture.dimensions.height * pixelsPerFoot;

  const colors = ZONE_COLORS.tub_deck;
  const x = fixture.position.x;
  const y = fixture.position.y;

  if (subType === 'corner_garden') {
    // Deck on front and one side (L-shape around corner)
    return (
      <Group rotation={fixture.rotation} x={x} y={y}>
        {/* Bottom deck (front) */}
        <Rect
          x={-deckWidthPx}
          y={tubHeightPx}
          width={tubWidthPx + deckWidthPx}
          height={deckWidthPx}
          fill={highlighted ? 'rgba(250, 173, 20, 0.45)' : colors.fill}
          stroke={colors.stroke}
          strokeWidth={highlighted ? 2 : 1}
          dash={[4, 2]}
        />
        {/* Right deck (side) */}
        <Rect
          x={tubWidthPx}
          y={0}
          width={deckWidthPx}
          height={tubHeightPx + deckWidthPx}
          fill={highlighted ? 'rgba(250, 173, 20, 0.45)' : colors.fill}
          stroke={colors.stroke}
          strokeWidth={highlighted ? 2 : 1}
          dash={[4, 2]}
        />
        <Text
          x={tubWidthPx + 4}
          y={tubHeightPx + 4}
          text="DECK"
          fontSize={9}
          fill={colors.stroke}
          fontStyle="bold"
        />
      </Group>
    );
  }

  // drop_in: deck all around
  return (
    <Group rotation={fixture.rotation} x={x} y={y}>
      <Rect
        x={-deckWidthPx}
        y={-deckWidthPx}
        width={tubWidthPx + deckWidthPx * 2}
        height={tubHeightPx + deckWidthPx * 2}
        fill={highlighted ? 'rgba(250, 173, 20, 0.45)' : colors.fill}
        stroke={colors.stroke}
        strokeWidth={highlighted ? 2 : 1}
        dash={[4, 2]}
      />
      {/* Inner tub cutout indicator */}
      <Rect
        x={0}
        y={0}
        width={tubWidthPx}
        height={tubHeightPx}
        fill="rgba(255, 255, 255, 0.3)"
        stroke={colors.stroke}
        strokeWidth={1}
        dash={[2, 2]}
      />
      <Text
        x={-deckWidthPx + 4}
        y={-deckWidthPx + 4}
        text="DECK"
        fontSize={9}
        fill={colors.stroke}
        fontStyle="bold"
      />
    </Group>
  );
};

/**
 * Render tub front panel overlay
 */
const TubPanelOverlay: React.FC<{
  fixture: RoomFixture;
  highlighted: boolean;
  pixelsPerFoot: number;
}> = ({ fixture, highlighted, pixelsPerFoot }) => {
  const subType = (fixture.properties?.bathtubSubType || 'standard_alcove') as BathtubSubType;
  if (subType === 'freestanding') return null;

  const defaults = BATHTUB_SUBTYPE_DEFAULTS[subType];
  const deckHeightIn = fixture.properties?.deckHeight ?? defaults.deckHeight;

  if (deckHeightIn <= 0) return null;

  const colors = ZONE_COLORS.tub_front_panel;
  const tubWidthPx = fixture.dimensions.width * pixelsPerFoot;
  const tubHeightPx = fixture.dimensions.height * pixelsPerFoot;
  const panelThickPx = 4; // visual thickness for the panel indicator

  const x = fixture.position.x;
  const y = fixture.position.y;

  return (
    <Group rotation={fixture.rotation} x={x} y={y}>
      {/* Front panel line */}
      <Rect
        x={0}
        y={tubHeightPx}
        width={tubWidthPx}
        height={panelThickPx}
        fill={highlighted ? 'rgba(250, 140, 22, 0.6)' : colors.fill}
        stroke={colors.stroke}
        strokeWidth={highlighted ? 2 : 1}
      />
      <Text
        x={tubWidthPx / 2 - 20}
        y={tubHeightPx + panelThickPx + 2}
        text="PANEL"
        fontSize={8}
        fill={colors.stroke}
        fontStyle="bold"
      />
    </Group>
  );
};

/**
 * Render tub surround wall indicator
 */
const TubSurroundOverlay: React.FC<{
  fixture: RoomFixture;
  highlighted: boolean;
  pixelsPerFoot: number;
}> = ({ fixture, highlighted, pixelsPerFoot }) => {
  const subType = (fixture.properties?.bathtubSubType || 'standard_alcove') as BathtubSubType;
  const defaults = BATHTUB_SUBTYPE_DEFAULTS[subType];
  const surroundWalls = fixture.properties?.surroundWalls ?? defaults.surroundWalls;

  if (surroundWalls <= 0) return null;

  const colors = ZONE_COLORS.tub_surround;
  const tubWidthPx = fixture.dimensions.width * pixelsPerFoot;
  const tubHeightPx = fixture.dimensions.height * pixelsPerFoot;
  const indicatorWidth = 6;

  const x = fixture.position.x;
  const y = fixture.position.y;

  return (
    <Group rotation={fixture.rotation} x={x} y={y}>
      {/* Back wall (top) */}
      <Rect
        x={0}
        y={-indicatorWidth}
        width={tubWidthPx}
        height={indicatorWidth}
        fill={highlighted ? 'rgba(235, 47, 150, 0.4)' : colors.fill}
        stroke={colors.stroke}
        strokeWidth={1}
      />
      {/* Left wall */}
      {surroundWalls >= 2 && (
        <Rect
          x={-indicatorWidth}
          y={-indicatorWidth}
          width={indicatorWidth}
          height={tubHeightPx + indicatorWidth}
          fill={highlighted ? 'rgba(235, 47, 150, 0.4)' : colors.fill}
          stroke={colors.stroke}
          strokeWidth={1}
        />
      )}
      {/* Right wall */}
      {surroundWalls >= 3 && (
        <Rect
          x={tubWidthPx}
          y={-indicatorWidth}
          width={indicatorWidth}
          height={tubHeightPx + indicatorWidth}
          fill={highlighted ? 'rgba(235, 47, 150, 0.4)' : colors.fill}
          stroke={colors.stroke}
          strokeWidth={1}
        />
      )}
      <Text
        x={tubWidthPx / 2 - 30}
        y={-indicatorWidth - 12}
        text="SURROUND"
        fontSize={8}
        fill={colors.stroke}
        fontStyle="bold"
      />
    </Group>
  );
};

/**
 * Render shower wall overlay
 */
const ShowerWallOverlay: React.FC<{
  fixture: RoomFixture;
  highlighted: boolean;
  pixelsPerFoot: number;
}> = ({ fixture, highlighted, pixelsPerFoot }) => {
  const surroundWalls = fixture.properties?.surroundWalls ?? 3;
  const colors = ZONE_COLORS.shower_wall;
  const showerWidthPx = fixture.dimensions.width * pixelsPerFoot;
  const showerHeightPx = fixture.dimensions.height * pixelsPerFoot;
  const indicatorWidth = 6;

  const x = fixture.position.x;
  const y = fixture.position.y;

  return (
    <Group rotation={fixture.rotation} x={x} y={y}>
      {/* Back wall */}
      <Rect
        x={0}
        y={-indicatorWidth}
        width={showerWidthPx}
        height={indicatorWidth}
        fill={highlighted ? 'rgba(114, 46, 209, 0.4)' : colors.fill}
        stroke={colors.stroke}
        strokeWidth={1}
      />
      {/* Left wall */}
      {surroundWalls >= 2 && (
        <Rect
          x={-indicatorWidth}
          y={-indicatorWidth}
          width={indicatorWidth}
          height={showerHeightPx + indicatorWidth}
          fill={highlighted ? 'rgba(114, 46, 209, 0.4)' : colors.fill}
          stroke={colors.stroke}
          strokeWidth={1}
        />
      )}
      {/* Right wall */}
      {surroundWalls >= 3 && (
        <Rect
          x={showerWidthPx}
          y={-indicatorWidth}
          width={indicatorWidth}
          height={showerHeightPx + indicatorWidth}
          fill={highlighted ? 'rgba(114, 46, 209, 0.4)' : colors.fill}
          stroke={colors.stroke}
          strokeWidth={1}
        />
      )}
      <Text
        x={showerWidthPx / 2 - 30}
        y={-indicatorWidth - 12}
        text="SHOWER TILE"
        fontSize={8}
        fill={colors.stroke}
        fontStyle="bold"
      />
    </Group>
  );
};

/**
 * Main Tile Zone Renderer - orchestrates all zone overlays
 */
const TileZoneRenderer: React.FC<TileZoneRendererProps> = ({
  room,
  roomFixtures,
  result,
  pixelsPerFoot,
  highlightedZoneType,
  visible,
}) => {
  if (!visible || !result) return null;

  const bathtubs = roomFixtures.filter(f => f.type === 'bathtub');
  const showers = roomFixtures.filter(f => f.type === 'shower');

  const hasFloorZone = result.zones.some(z => z.type === 'floor');
  const hasDeckZone = result.zones.some(z => z.type === 'tub_deck');
  const hasPanelZone = result.zones.some(z => z.type === 'tub_front_panel');
  const hasSurroundZone = result.zones.some(z => z.type === 'tub_surround');
  const hasShowerZone = result.zones.some(z => z.type === 'shower_wall');

  return (
    <Group>
      {/* Floor tile overlay */}
      {hasFloorZone && (
        <FloorZoneOverlay
          room={room}
          highlighted={highlightedZoneType === 'floor'}
          pixelsPerFoot={pixelsPerFoot}
        />
      )}

      {/* Bathtub zones */}
      {bathtubs.map(tub => (
        <Group key={tub.id}>
          {hasDeckZone && (
            <TubDeckOverlay
              fixture={tub}
              highlighted={highlightedZoneType === 'tub_deck'}
              pixelsPerFoot={pixelsPerFoot}
            />
          )}
          {hasPanelZone && (
            <TubPanelOverlay
              fixture={tub}
              highlighted={highlightedZoneType === 'tub_front_panel'}
              pixelsPerFoot={pixelsPerFoot}
            />
          )}
          {hasSurroundZone && (
            <TubSurroundOverlay
              fixture={tub}
              highlighted={highlightedZoneType === 'tub_surround'}
              pixelsPerFoot={pixelsPerFoot}
            />
          )}
        </Group>
      ))}

      {/* Shower zones */}
      {showers.map(shower => (
        <Group key={shower.id}>
          {hasShowerZone && (
            <ShowerWallOverlay
              fixture={shower}
              highlighted={highlightedZoneType === 'shower_wall'}
              pixelsPerFoot={pixelsPerFoot}
            />
          )}
        </Group>
      ))}
    </Group>
  );
};

export default TileZoneRenderer;
