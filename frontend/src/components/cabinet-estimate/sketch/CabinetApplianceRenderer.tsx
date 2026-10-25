/**
 * Plan shapes for what sits in and around the cabinets: the detach &
 * reset appliances (ApplianceShape) and the sink on each sink base
 * (SinkShape). Both are drawn in the frame of the plan, like
 * CabinetShapeRenderer: (x, y) the back-left corner, front toward local +y.
 */

import React, { useCallback } from 'react';
import { Circle, Group, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import type { CabinetSketchAppliance, CabinetSketchCabinet } from '../../../types/cabinetSketch';
import { applianceSpec, sinkLayout } from './sketchAppliances';
import type { LocalRect } from './sketchAppliances';

/** The detach & reset accent, as on the 3D view's tags. */
export const DR_TAG_COLOR = '#B45309';
const BODY_FILL = '#E9EDF0';
const BODY_STROKE = '#56636E';
const FONT = "'Inter', 'Segoe UI', sans-serif";

interface ApplianceShapeProps {
  appliance: CabinetSketchAppliance;
  isSelected: boolean;
  zoom: number;
  onSelect: (id: string, ctrlKey?: boolean) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
}

/**
 * One detach & reset appliance: its footprint (dashed when it hangs over
 * the counter, a circle for a disposal), burners on a range or cooktop,
 * and its code with a D&R tag. One in a cabinet goes with the cabinet, so
 * it lets clicks and drags through to it; the rest are dragged themselves.
 */
export const ApplianceShape: React.FC<ApplianceShapeProps> = ({ appliance, isSelected, zoom, onSelect, onDragEnd }) => {
  const spec = applianceSpec(appliance.type);
  const { width: w, height: h } = appliance;
  const hosted = !!appliance.host_id;
  const px = 1 / zoom;
  const hung = spec.mount === 'hung';
  const round = spec.mount === 'under_sink';
  const turned = ((appliance.rotation % 360) + 360) % 360;
  const upsideDown = turned > 90 && turned < 270;
  // Two lines (code over "D&R") when there is room, else one.
  const roomy = !hung && h * zoom >= 30 && w * zoom >= 26;

  const handleClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      e.cancelBubble = true;
      onSelect(appliance.id, e.evt?.ctrlKey || e.evt?.metaKey);
    },
    [appliance.id, onSelect]
  );
  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true;
      onDragEnd(appliance.id, e.target.x(), e.target.y());
    },
    [appliance.id, onDragEnd]
  );

  const outline = {
    stroke: isSelected ? '#1890ff' : BODY_STROKE,
    strokeWidth: isSelected ? 2 : 1.5,
    strokeScaleEnabled: false,
  };
  const burner = Math.min(w, h) * 0.12;
  // Labels sit across the middle; a hung one's near its back, under the code of the upper it hangs from
  // and clear of what stands below; a disposal's under its circle.
  const labelY = hung ? 20 * px : round ? h + 7 * px : h * 0.55;
  const text = (content: string, y: number, size: number, color: string) => (
    <Text
      x={-w / 2 - 20 * px}
      y={y}
      width={w + 40 * px}
      text={content}
      fontSize={size * px}
      fontStyle="bold"
      fontFamily={FONT}
      fill={color}
      align="center"
      wrap="none"
      listening={false}
    />
  );

  return (
    <Group
      x={appliance.x}
      y={appliance.y}
      rotation={appliance.rotation}
      draggable={!hosted}
      listening={!hosted}
      onClick={handleClick}
      onTap={handleClick}
      onDragEnd={handleDragEnd}
    >
      {round ? (
        // Under the counter, so dashed, as hidden things are on a plan.
        <Circle
          x={w / 2}
          y={h / 2}
          radius={Math.min(w, h) / 2}
          fill="#FCE9D2"
          opacity={0.9}
          dash={[3 * px, 2 * px]}
          {...outline}
          stroke={isSelected ? '#1890ff' : DR_TAG_COLOR}
        />
      ) : (
        <Rect
          width={w}
          height={h}
          fill={BODY_FILL}
          opacity={hung ? 0.4 : 0.95}
          dash={hung ? [5 * px, 3 * px] : undefined}
          cornerRadius={2}
          {...outline}
        />
      )}
      {(spec.model === 'range' || spec.model === 'cooktop') &&
        [0.28, 0.72].flatMap((fx) =>
          [0.3, 0.7].map((fy) => (
            <Circle
              key={`${fx}-${fy}`}
              x={w * fx}
              y={h * fy}
              radius={burner}
              stroke={BODY_STROKE}
              strokeWidth={1}
              strokeScaleEnabled={false}
              listening={false}
            />
          ))
        )}
      <Group x={w / 2} y={labelY} rotation={upsideDown ? 180 : 0} listening={false}>
        {roomy ? (
          <>
            {text(spec.code, -11 * px, 11, '#2F3A43')}
            {text('D&R', 1 * px, 9, DR_TAG_COLOR)}
          </>
        ) : (
          text(`${spec.code} D&R`, -5 * px, 9, DR_TAG_COLOR)
        )}
      </Group>
    </Group>
  );
};

interface SinkShapeProps {
  /** The sink base it sits on. */
  cabinet: CabinetSketchCabinet;
  widthIn: number;
  depthIn: number;
  bowls: 1 | 2;
  apron: boolean;
}

/** The sink set in a sink base's counter: rim, bowls with their drains, and the faucet behind. */
export const SinkShape: React.FC<SinkShapeProps> = ({ cabinet, widthIn, depthIn, bowls, apron }) => {
  const layout = sinkLayout(widthIn, depthIn, bowls, apron);
  // Local inches to the cabinet's pixels.
  const kx = cabinet.width / widthIn;
  const ky = cabinet.height / depthIn;
  const rect = ([x0, y0, x1, y1]: LocalRect) => ({ x: x0 * kx, y: y0 * ky, width: (x1 - x0) * kx, height: (y1 - y0) * ky });
  const stroke = { stroke: '#7D8B96', strokeWidth: 1, strokeScaleEnabled: false };
  return (
    <Group x={cabinet.x} y={cabinet.y} rotation={cabinet.rotation} listening={false}>
      <Rect {...rect(layout.rim)} fill="#F3F5F7" cornerRadius={1.5 * kx} {...stroke} />
      {layout.bowls.map((bowl, i) => {
        const r = rect(bowl);
        return (
          <React.Fragment key={i}>
            <Rect {...r} fill="#DCE3E8" cornerRadius={2 * kx} {...stroke} />
            <Circle x={r.x + r.width / 2} y={r.y + r.height / 2} radius={1.2 * kx} fill="#7D8B96" />
          </React.Fragment>
        );
      })}
      <Circle x={layout.faucet[0] * kx} y={layout.faucet[1] * ky} radius={1.1 * kx} fill="#7D8B96" />
    </Group>
  );
};
