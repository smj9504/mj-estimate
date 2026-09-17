/**
 * WMFloorPlanRenderer
 *
 * Renders floor plan walls and rooms on the Konva canvas.
 * Walls are drawn as thick lines with endpoint circles (snap handles).
 * Rooms are drawn as filled polygons with a name label.
 *
 * Also renders the wall-drawing preview (ghost line from start to cursor).
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Group, Line, Circle, Text, RegularPolygon, Rect } from 'react-konva';
import { formatDimensionCompact, parseDimension } from '../utils/wmCalculations';
import type { WMWall, WMRoom } from '../../../../types/wmSketch';
import { DEFAULT_WALL_COLOR, DEFAULT_ROOM_COLOR } from '../../../../types/wmSketch';

import { useTouchTargetSizes } from '../hooks/useWMResponsive';
import { snapCornerToAngle } from '../utils/sketchGeometry';

/**
 * Radius (canvas px) for matching a wall endpoint against a live drag point.
 * Mirrors VERTEX_MERGE_EPS in WMOverlayLayer — both answer "is this the same
 * corner?" and must agree, or a wall will follow a drag the room ignores.
 */
const VERTEX_LIVE_EPS = 15;

/**
 * Angle increments a dragged corner snaps to, in degrees. 15° covers the
 * square cases (0/90) and the common bevels (30/45/60) in one step.
 */
const ANGLE_SNAP_STEP_DEG = 15;

/**
 * How near a guide the cursor must be before it snaps, in SCREEN pixels.
 * Divided by the stage scale at use, so the feel stays constant when zoomed.
 */
const SNAP_TOLERANCE_PX = 8;
// ============================================================================
// Wall Renderer
// ============================================================================

interface WMWallRendererProps {
  wall: WMWall;
  isSelected: boolean;
  onSelect: (id: string, ctrlKey?: boolean) => void;
  onDragEndpoint: (wallId: string, endpoint: 'start' | 'end', x: number, y: number) => void;
  /** Drag the entire wall (both endpoints move together) */
  onWallDragEnd?: (wallId: string, dx: number, dy: number) => void;
  /** Canvas scale, used to show a live length while an endpoint is dragged */
  scalePixelsPerFoot: number;
  /**
   * The guide this wall's endpoint is currently snapped to, for drawing a
   * dashed reference line and its angle. Null when nothing is snapped.
   * Same contract as the corner markers, so both draw the same affordance.
   */
  onSnapGuide?: (
    guide: {
      origin: { x: number; y: number };
      dir: { x: number; y: number };
      angleDeg: number;
    } | null,
  ) => void;
  /**
   * Live endpoint positions during a drag, so room outlines and neighbouring
   * walls can follow instead of waiting for the commit on release. Each entry
   * says "the point that was at `from` is currently at `to`". Called with null
   * on drag end, once the committed data takes over.
   *
   * `wallId` identifies the wall being dragged bodily, and is omitted for an
   * endpoint drag. The overlay needs it to work out where the corners actually
   * land: a whole-wall drag must hold its neighbours' bearings, which can only
   * be resolved against the other walls — knowledge this component does not
   * have. Without it the preview fell back to a plain translation and showed
   * tilted neighbours that snapped straight on release.
   */
  onWallDragMove?: (
    moves: { from: { x: number; y: number }; to: { x: number; y: number } }[] | null,
    wallId?: string,
  ) => void;
  /**
   * Points being dragged anywhere on the floor plan, as "the point that was at
   * `from` is now at `to`".
   *
   * This is the inbound counterpart to onWallDragMove: a corner (red diamond)
   * belongs to no single wall, so when one is dragged the walls meeting it have
   * nothing of their own to react to and would sit still while the room outline
   * moved. Matching an endpoint against this list lets every wall at that corner
   * follow the drag live.
   */
  livePoints?: { from: { x: number; y: number }; to: { x: number; y: number } }[] | null;
  /**
   * Commit a new length typed directly onto the canvas label.
   * The wall keeps its angle and its start point; only the far end moves.
   */
  onWallLengthChange?: (wallId: string, feet: number) => void;
}

const WMWallRendererInner: React.FC<WMWallRendererProps> = ({
  wall,
  isSelected,
  onSelect,
  onDragEndpoint,
  onWallDragEnd,
  scalePixelsPerFoot,
  onWallDragMove,
  livePoints,
  onWallLengthChange,
  onSnapGuide,
}) => {
  // Handles must be finger-sized on touch devices; `hitStrokeWidth`
  // widens the tap target without changing how the handle looks.
  const touchSizes = useTouchTargetSizes();
  const { id, start_x, start_y, end_x, end_y, thickness, color } = wall;

  const handleClick = useCallback(
    (e: any) => {
      e.cancelBubble = true;
      onSelect(id, e.evt?.ctrlKey || e.evt?.metaKey);
    },
    [id, onSelect]
  );

  // Inline length editing — the label is replaced by a DOM input positioned
  // over the canvas, since Konva cannot host a real text field.
  const [isEditingLength, setIsEditingLength] = useState(false);
  const labelRef = useRef<any>(null);

  const handleLabelDblClick = useCallback(
    (e: any) => {
      e.cancelBubble = true;
      if (!onWallLengthChange) return;
      const node = labelRef.current;
      const stage = node?.getStage?.();
      if (!node || !stage) return;

      setIsEditingLength(true);

      const container = stage.container();
      const stageScale = stage.scaleX();
      /*
       * Place the input over the label using only unambiguous terms.
       *
       * Every previous attempt here failed by assuming which space a value was
       * in, so this one avoids the question:
       *
       *   1. getAbsoluteTransform().point({0,0}) maps the label node's own
       *      origin all the way to ON-CANVAS pixels — it folds in the node's
       *      rotation, its parent Groups, and the stage's scale and pan. No
       *      manual multiplying by scale or adding stage.x()/y(); doing either
       *      double-counts (that was the first bug).
       *   2. getBoundingClientRect() on the container gives that canvas's
       *      origin in VIEWPORT pixels.
       *   3. Their sum is a viewport pixel, so the element is positioned
       *      `fixed` and appended to <body>. That makes it immune to whatever
       *      ancestor happens to establish the containing block — the thing I
       *      guessed wrong twice.
       *
       * (getClientRect() is NOT used: it reports stage-space bounds, which are
       * not viewport pixels once the canvas is panned or zoomed.)
       */
      /*
       * Place the input over the label. MEASURED, not reasoned — four previous
       * attempts argued about which space each value was in and all four were
       * wrong, so this one comes from logging the real numbers during a real
       * double-click:
       *
       *   stage.x=-60 stage.y=-40 scale=1
       *   node.getAbsoluteTransform().point({0,0}) = (472.0, 233.4)
       *   label's true on-screen centre                = (764.0, 685.0)
       *   container origin                             = (352, 491.6)
       *
       * 352 + 472.0 = 824 and 491.6 + 233.4 = 725 — off by exactly (60, 40),
       * which is precisely (-stage.x, -stage.y). So the transform's output
       * does NOT carry the stage pan, and the scale has to be applied to it as
       * well. Adding both reproduces the measured centre to 0.005px.
       *
       * (getClientRect() is not used: it reports stage-space bounds, which are
       * not viewport pixels either.)
       */
      const containerBox = container.getBoundingClientRect();
      const onCanvas = node.getAbsoluteTransform().point({ x: 0, y: 0 });
      const screenX = containerBox.left + stage.x() + onCanvas.x * stageScale;
      const screenY = containerBox.top + stage.y() + onCanvas.y * stageScale;

      const inputWidth = 72;
      const inputHeight = 22;
      const input = document.createElement('input');
      document.body.appendChild(input);
      // Start from the current value so only the number needs retyping —
      // the ' and " markers are already in place.
      input.value = formatDimensionCompact(wall.length_ft);
      input.style.position = 'fixed';
      // Centre the box on the label rather than hanging it off one corner.
      input.style.top = `${screenY - inputHeight / 2}px`;
      input.style.left = `${screenX - inputWidth / 2}px`;
      input.style.width = `${inputWidth}px`;
      input.style.fontSize = `${Math.max(12, 11 * stageScale)}px`;
      input.style.fontFamily = "'Inter', 'Segoe UI', sans-serif";
      input.style.textAlign = 'center';
      input.style.color = '#1890ff';
      input.style.fontWeight = '700';
      input.style.border = '2px solid #1890ff';
      input.style.borderRadius = '4px';
      input.style.padding = '1px 4px';
      input.style.background = 'rgba(255,255,255,0.98)';
      input.style.outline = 'none';
      input.style.zIndex = '1000';

      input.focus();
      input.select();

      const finish = () => {
        const feet = parseDimension(input.value);
        input.removeEventListener('blur', finish);
        input.remove();
        setIsEditingLength(false);
        // 0 means unparseable — leave the wall untouched rather than
        // collapsing it to nothing.
        if (feet > 0 && Math.abs(feet - wall.length_ft) > 0.001) {
          onWallLengthChange(id, feet);
        }
      };

      input.addEventListener('blur', finish);
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') {
          input.removeEventListener('blur', finish);
          input.remove();
          setIsEditingLength(false);
        }
        if (ev.key === 'Enter') {
          ev.preventDefault();
          input.blur();
        }
      });
    },
    [id, wall.length_ft, onWallLengthChange]
  );

  // True while an endpoint handle is being dragged. The handles live inside
  // this draggable Group, so without this guard Konva runs a group drag at the
  // same time as the handle drag and BOTH commit on release: the group drag
  // translates every connected wall while the handle drag moves one endpoint.
  // That double mutation is what collapsed the room and sent lengths runaway.
  const isEndpointDragging = useRef(false);
  /**
   * True while THIS wall's own Group is being dragged.
   *
   * Konva translates the Group's children itself during such a drag, so the
   * resolved corners that come back through livePoints must not be applied on
   * top of that — the line would move twice. Only the neighbours consume them.
   */
  const isGroupDraggingRef = useRef(false);
  /**
   * How far Konva has translated this wall's Group in the current drag.
   *
   * Read at draw time to cancel that translation out (see liveFor). Kept in a
   * ref rather than state because it must not drive a render of its own: the
   * drag already re-renders every frame via onWallDragMove -> livePoints, so
   * the value read here is always this frame's.
   */
  const groupOffsetRef = useRef({ x: 0, y: 0 });

  // Drag entire wall — compute delta and reset group position
  const handleGroupDragEnd = useCallback(
    (e: any) => {
      isGroupDraggingRef.current = false;
      groupOffsetRef.current = { x: 0, y: 0 };
      // An endpoint handle triggered this — it commits the move itself.
      if (isEndpointDragging.current) {
        e.target.position({ x: 0, y: 0 });
        return;
      }
      const dx = e.target.x();
      const dy = e.target.y();
      // Reset group position (coordinates are stored on wall endpoints)
      e.target.position({ x: 0, y: 0 });
      onWallDragMove?.(null);
      if (dx !== 0 || dy !== 0) {
        onWallDragEnd?.(id, dx, dy);
      }
    },
    [id, onWallDragEnd, onWallDragMove]
  );

  // Live position of the endpoint being dragged, so the wall line and its
  // length label follow the cursor instead of jumping only on release.
  // null when no drag is in progress — the wall then renders from props.
  const [dragPoint, setDragPoint] = React.useState<
    { endpoint: 'start' | 'end'; x: number; y: number } | null
  >(null);

  // Shift is read live off each pointer event rather than captured once at
  // drag start, so pressing or releasing it mid-drag takes effect immediately.
  // Touch events have no modifier keys, hence the `in` guard.
  const shiftHeldRef = useRef(false);

  const noteShift = useCallback((e: any) => {
    const evt = e?.evt;
    shiftHeldRef.current = !!evt && 'shiftKey' in evt && !!evt.shiftKey;
  }, []);

  // Claim the gesture so the parent Group's drag stays out of it.
  const handleEndpointDragStart = useCallback((e: any) => {
    e.cancelBubble = true;
    isEndpointDragging.current = true;
    noteShift(e);
  }, [noteShift]);

  // Mark this wall's own Group as the one being dragged, so liveFor knows not
  // to apply the resolved corners on top of Konva's own translation.
  const handleGroupDragStart = useCallback((e: any) => {
    noteShift(e);
    isGroupDraggingRef.current = true;
  }, [noteShift]);

  /**
   * Constrain a dragged endpoint while Shift is held.
   *
   * The anchor is the wall's *other* endpoint, which stays put. The cursor is
   * projected onto whichever guide line is nearest:
   *   - the wall's own current direction (keeps this wall's angle, changing
   *     only its length — the Xactimate "extend the wall" behaviour), or
   *   - horizontal / vertical through the anchor.
   *
   * A vertex usually joins two walls at different angles, and one point cannot
   * sit on both rays at once, so the wall whose handle was grabbed wins.
   * Neighbours follow it through the usual shared-vertex propagation.
   */
  const constrainEndpoint = useCallback(
    (
      pos: { x: number; y: number },
      anchorX: number,
      anchorY: number,
      origX: number,
      origY: number,
      scale = 1,
    ) => {
      // Shift is the escape hatch now that snapping is always on — matching
      // the corner markers, so both handles behave the same way.
      if (shiftHeldRef.current) {
        onSnapGuide?.(null);
        return pos;
      }

      /*
       * First choice: land the WALL on a round bearing from its fixed end.
       *
       * The anchor is the endpoint that is not moving, so where this end drops
       * decides the wall's angle outright — projecting onto a ray leaving the
       * anchor at a 15° multiple makes that angle exactly round, and a corner
       * whose two walls are both round is itself round. Accepting within ±3°
       * is what makes "drop it roughly and have it snap to 90°" work.
       *
       * This path matters more than it looks: dragging a floor-plan corner
       * goes through the WALL ENDPOINT handle, not the corner marker (probing
       * the stage found no draggable node at the corner itself), so snapping
       * only in the vertex renderer left the feature dead.
       */
      const byAngle = snapCornerToAngle({ x: pos.x, y: pos.y }, [{ x: anchorX, y: anchorY }]);
      if (byAngle.guide) {
        onSnapGuide?.(byAngle.guide);
        return byAngle.point;
      }

      // Guide directions through the anchor: every ANGLE_SNAP_STEP_DEG
      // increment, plus this wall's own current direction so its angle can be
      // preserved while only the length changes.
      const dirs: { x: number; y: number }[] = [];
      for (let a = 0; a < 180; a += ANGLE_SNAP_STEP_DEG) {
        const rad = (a * Math.PI) / 180;
        dirs.push({ x: Math.cos(rad), y: Math.sin(rad) });
      }
      const wx = origX - anchorX;
      const wy = origY - anchorY;
      const wlen = Math.hypot(wx, wy);
      if (wlen > 0.001) dirs.push({ x: wx / wlen, y: wy / wlen });

      let best: { x: number; y: number } | null = null;
      let bestDist = Infinity;
      let bestDir: { x: number; y: number } | null = null;
      for (const d of dirs) {
        // Clamp to zero: a negative projection would flip the wall through
        // its anchor rather than shortening it.
        const proj = Math.max(0, (pos.x - anchorX) * d.x + (pos.y - anchorY) * d.y);
        const cand = { x: anchorX + d.x * proj, y: anchorY + d.y * proj };
        const dist = Math.hypot(cand.x - pos.x, cand.y - pos.y);
        if (dist < bestDist) {
          bestDist = dist;
          best = cand;
          bestDir = d;
        }
      }

      // Outside the tolerance, follow the cursor exactly and draw no guide.
      if (!best || !bestDir || bestDist > SNAP_TOLERANCE_PX / scale) {
        onSnapGuide?.(null);
        return pos;
      }

      let angleDeg = (Math.atan2(bestDir.y, bestDir.x) * 180) / Math.PI;
      if (angleDeg < 0) angleDeg += 180;
      onSnapGuide?.({ origin: { x: anchorX, y: anchorY }, dir: bestDir, angleDeg });
      return best;
    },
    [onSnapGuide]
  );

  /**
   * Konva calls these on every drag frame with the proposed position, and uses
   * the returned point instead — so the handle itself visibly rides the guide
   * line rather than drifting off it and snapping back only on release.
   *
   * Frame note: dragBoundFunc works in ABSOLUTE stage coordinates, while the
   * wall's stored endpoints are layer coordinates. With the stage zoomed or
   * panned those differ, so the proposed point is converted down to layer
   * space, constrained there, and converted back.
   */
  const makeDragBound = useCallback(
    (anchorX: number, anchorY: number, origX: number, origY: number) =>
      function (this: any, pos: { x: number; y: number }) {
        // No Shift gate here any more: snapping is always on and
        // constrainEndpoint decides for itself (Shift now disables it).
        const node = this;
        const scale = node?.getStage?.()?.scaleX?.() || 1;
        const layer = node?.getLayer?.();
        const tr = layer?.getAbsoluteTransform?.();
        if (!tr) return constrainEndpoint(pos, anchorX, anchorY, origX, origY, scale);
        const inv = tr.copy().invert();
        const local = inv.point(pos);
        const fixed = constrainEndpoint(local, anchorX, anchorY, origX, origY, scale);
        return tr.point(fixed);
      },
    [constrainEndpoint]
  );

  const startDragBound = useMemo(
    () => makeDragBound(end_x, end_y, start_x, start_y),
    [makeDragBound, end_x, end_y, start_x, start_y]
  );

  const endDragBound = useMemo(
    () => makeDragBound(start_x, start_y, end_x, end_y),
    [makeDragBound, start_x, start_y, end_x, end_y]
  );

  /**
   * Constraint for dragging the whole wall.
   *
   * With Shift held the wall may only slide horizontally, vertically, or along
   * its own axis (keeping its angle and staying on its own line).
   *
   * Frame note — this differs from the endpoint handles above and must NOT
   * reuse makeDragBound. What Konva proposes here is the group node's absolute
   * position, and the quantity to constrain is the TRANSLATION from where the
   * group started, not a point in layer space. Running a delta through the
   * layer's inverse transform would fold the stage's pan offset into it, so the
   * constraint would be measured from the wrong origin once the canvas is
   * panned. Instead: take the delta in screen space, divide out the stage scale
   * to get layer units, constrain it about {0,0}, then scale back and re-add
   * the origin.
   */
  const groupDragBound = useMemo(
    () =>
      function (this: any, pos: { x: number; y: number }) {
        if (!shiftHeldRef.current) return pos;
        const node = this;
        // Where the group sits with zero translation applied.
        const origin = node?.getAbsolutePosition
          ? (() => {
              const cur = node.getAbsolutePosition();
              return { x: cur.x - node.x(), y: cur.y - node.y() };
            })()
          : { x: 0, y: 0 };
        const scale = node?.getStage?.()?.scaleX?.() || 1;
        const deltaLayer = {
          x: (pos.x - origin.x) / scale,
          y: (pos.y - origin.y) / scale,
        };
        const fixed = constrainEndpoint(
          deltaLayer, 0, 0, end_x - start_x, end_y - start_y,
        );
        return {
          x: origin.x + fixed.x * scale,
          y: origin.y + fixed.y * scale,
        };
      },
    [constrainEndpoint, start_x, start_y, end_x, end_y]
  );

  const handleStartDragMove = useCallback((e: any) => {
    e.cancelBubble = true;
    noteShift(e);
    const to = { x: e.target.x(), y: e.target.y() };
    setDragPoint({ endpoint: 'start', ...to });
    onWallDragMove?.([{ from: { x: start_x, y: start_y }, to }]);
  }, [noteShift, onWallDragMove, start_x, start_y]);

  const handleEndDragMove = useCallback((e: any) => {
    e.cancelBubble = true;
    noteShift(e);
    const to = { x: e.target.x(), y: e.target.y() };
    setDragPoint({ endpoint: 'end', ...to });
    onWallDragMove?.([{ from: { x: end_x, y: end_y }, to }]);
  }, [noteShift, onWallDragMove, end_x, end_y]);

  /**
   * Whole-wall drag: both endpoints translate by the group delta.
   *
   * The delta is read off the group node directly (node.x()/y()), which is
   * already expressed in the parent's coordinate space — the same space the
   * wall's stored endpoints live in — so no stage-transform conversion is
   * needed here, unlike dragBoundFunc which receives absolute coordinates.
   */
  const handleGroupDragMove = useCallback((e: any) => {
    noteShift(e);
    if (isEndpointDragging.current) return;
    // A whole-wall drag snaps to nothing, so there is no guide to show. Clear
    // whatever the LAST gesture left behind: onSnapGuide is only ever raised by
    // endpoint and corner drags, so without this the previous drag's arc stays
    // pinned to a corner this gesture is not touching — it looked frozen
    // because it belonged to a different, already-finished drag.
    onSnapGuide?.(null);
    const dx = e.target.x();
    const dy = e.target.y();
    // Remember the translation so the draw path can cancel it out. Konva's own
    // position is left strictly alone — writing it here is what made the wall
    // bounce, because Konva derives each drag step from the current position.
    groupOffsetRef.current = { x: dx, y: dy };
    // Report the raw translation plus which wall moved. The overlay resolves
    // it into the real corners (neighbours hold their bearing, so a corner
    // lands where the lines cross) — it is the only place that knows the other
    // walls. Passing the translated points alone made the preview tilt the
    // neighbours, then snap them straight on release.
    onWallDragMove?.(
      [
        { from: { x: start_x, y: start_y }, to: { x: start_x + dx, y: start_y + dy } },
        { from: { x: end_x, y: end_y }, to: { x: end_x + dx, y: end_y + dy } },
      ],
      id,
    );
    /*
     * NOTE: do NOT reset this Group's position here.
     *
     * Zeroing it every frame was tried, to hand positioning entirely over to
     * the resolved corners in livePoints. It did weld the wall to its
     * neighbours mid-drag — but Konva computes each drag step FROM the node's
     * current position, so writing that position inside dragmove races its own
     * drag logic and the wall visibly bounces. Reverted.
     *
     * The wall therefore still floats slightly from its neighbours while being
     * dragged (they show the resolved corners, it shows a plain translation).
     * A correct fix has to leave Konva's position alone: subtract the Group
     * offset when drawing the line, or do the work in dragBoundFunc, which is
     * the hook Konva actually offers for constraining a drag.
     */
  }, [noteShift, onWallDragMove, onSnapGuide, id, start_x, start_y, end_x, end_y]);

  const handleStartDragEnd = useCallback(
    (e: any) => {
      e.cancelBubble = true;
      const x = e.target.x();
      const y = e.target.y();
      setDragPoint(null);
      // Snap the node back onto the committed coordinate. The editor may
      // commit something other than the drop point (snapping, or no matching
      // endpoint at all), and when the resulting prop is unchanged React
      // re-renders nothing — leaving the handle stranded where the pointer was
      // released while the wall stays put. Konva owns this node's position
      // during the drag, so it has to be put back by hand.
      e.target.position({ x: start_x, y: start_y });
      onWallDragMove?.(null);
      onDragEndpoint(id, 'start', x, y);
      // Release the guard after Konva finishes dispatching this gesture, so
      // the Group's own dragend (fired in the same tick) still sees it set.
      setTimeout(() => { isEndpointDragging.current = false; }, 0);
    },
    [id, onDragEndpoint, onWallDragMove, start_x, start_y]
  );

  const handleEndDragEnd = useCallback(
    (e: any) => {
      e.cancelBubble = true;
      const x = e.target.x();
      const y = e.target.y();
      setDragPoint(null);
      // Same reason as handleStartDragEnd: put the node back on the committed
      // coordinate, or an unchanged prop leaves the handle stranded.
      e.target.position({ x: end_x, y: end_y });
      onWallDragMove?.(null);
      onDragEndpoint(id, 'end', x, y);
      setTimeout(() => { isEndpointDragging.current = false; }, 0);
    },
    [id, onDragEndpoint, onWallDragMove, end_x, end_y]
  );

  const strokeWidth = thickness || 4;

  // While something is being dragged, draw from the live position instead of
  // the committed props. Two sources, in priority order:
  //   1. livePoints — a corner elsewhere on the plan is moving, and one of this
  //      wall's endpoints sits on it (VERTEX_LIVE_EPS match).
  //   2. dragPoint — this wall's own endpoint handle is being dragged.
  const liveFor = (px: number, py: number): { x: number; y: number } | null => {
    /*
     * livePoints applies to the dragged wall as well, not just to its
     * neighbours. It carries the RESOLVED corners — where the dragged wall's
     * translated line crosses each neighbour's own line, which is exactly what
     * the commit will store. Drawing from them is what keeps the wall welded
     * to its neighbours mid-drag, its own length stretching to reach them
     * instead of the joint pulling apart.
     *
     * The wrinkle is that Konva is ALSO translating this wall's Group while it
     * is the one being dragged, so a resolved corner used as-is would be moved
     * twice. Subtracting the Group's current offset cancels that: the Group
     * transform re-adds it and the line lands precisely on the resolved corner.
     *
     * Two things were tried before and must not come back. Skipping livePoints
     * for the dragged wall drew it as a rigid translation while its neighbours
     * reached for the resolved corners — the joint visibly came loose, measured
     * at 7px, 17px then 29px as the drag went further. Zeroing the Group's
     * position each frame welded it but made the wall bounce, because Konva
     * computes each drag step from the node's current position and so was
     * racing that write. Cancelling at draw time touches neither.
     */
    if (!livePoints) return null;
    for (const m of livePoints) {
      if (Math.hypot(px - m.from.x, py - m.from.y) <= VERTEX_LIVE_EPS) {
        if (!isGroupDraggingRef.current) return m.to;
        const off = groupOffsetRef.current;
        return { x: m.to.x - off.x, y: m.to.y - off.y };
      }
    }
    return null;
  };
  const liveStart = liveFor(start_x, start_y);
  const liveEnd = liveFor(end_x, end_y);

  const sx = liveStart ? liveStart.x : dragPoint?.endpoint === 'start' ? dragPoint.x : start_x;
  const sy = liveStart ? liveStart.y : dragPoint?.endpoint === 'start' ? dragPoint.y : start_y;
  const ex = liveEnd ? liveEnd.x : dragPoint?.endpoint === 'end' ? dragPoint.x : end_x;
  const ey = liveEnd ? liveEnd.y : dragPoint?.endpoint === 'end' ? dragPoint.y : end_y;

  // Label positioning: offset perpendicular to the wall line
  const midX = (sx + ex) / 2;
  const midY = (sy + ey) / 2;
  const dx = ex - sx;
  const dy = ey - sy;
  const wallLen = Math.sqrt(dx * dx + dy * dy);
  // Unit normal perpendicular to wall (rotated 90 degrees)
  const nx = wallLen > 0 ? -dy / wallLen : 0;
  const ny = wallLen > 0 ? dx / wallLen : -1;
  const labelOffset = 14;
  const labelX = midX + nx * labelOffset;
  const labelY = midY + ny * labelOffset;
  // Rotation to align label with wall direction
  const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
  // Flip if upside down
  const labelRotation = (angleDeg > 90 || angleDeg < -90) ? angleDeg + 180 : angleDeg;

  // Mid-drag the stored length_ft is stale, so derive the label from the live
  // geometry instead. scalePixelsPerFoot converts back to feet.
  const isLive = !!dragPoint || !!liveStart || !!liveEnd;
  const liveLengthFt =
    isLive && scalePixelsPerFoot > 0 ? wallLen / scalePixelsPerFoot : wall.length_ft;
  // Feet-and-inches, the way a tape measure reads: 4'5", 3', 5", 12'6".
  const lengthLabel = liveLengthFt > 0 ? formatDimensionCompact(liveLengthFt) : '';

  return (
    <Group
      draggable={isSelected}
      dragBoundFunc={groupDragBound}
      onDragStart={handleGroupDragStart}
      onDragMove={handleGroupDragMove}
      onDragEnd={handleGroupDragEnd}
    >
      {/* Wall line */}
      <Line
        points={[sx, sy, ex, ey]}
        stroke={isSelected ? '#1890ff' : (color || DEFAULT_WALL_COLOR)}
        strokeWidth={strokeWidth}
        lineCap="round"
        hitStrokeWidth={Math.max(strokeWidth + 10, 16, touchSizes.hitStrokeWidth)}
        onClick={handleClick}
        onTap={handleClick}
      />

      {/* Measurement label — always visible, double-click to type a length */}
      {lengthLabel && wallLen > 30 && !isEditingLength && (
        <Group
          ref={labelRef}
          x={labelX}
          y={labelY}
          rotation={labelRotation}
          onDblClick={handleLabelDblClick}
          onDblTap={handleLabelDblClick}
        >
          {/* Transparent hit area — the text glyphs alone are a fiddly
              double-click target, especially on touch. */}
          <Rect
            x={-lengthLabel.length * 3.2 - 4}
            y={-8}
            width={lengthLabel.length * 6.4 + 8}
            height={16}
            fill="transparent"
          />
          <Text
            text={lengthLabel}
            fontSize={11}
            fill={isSelected ? '#1890ff' : '#595959'}
            fontFamily="'Inter', 'Segoe UI', sans-serif"
            fontStyle={isSelected ? 'bold' : 'normal'}
            offsetX={lengthLabel.length * 3.2}
            offsetY={6}
            listening={false}
          />
        </Group>
      )}

      {/* Small endpoint dots — always visible for snap reference */}
      <Circle
        x={sx}
        y={sy}
        radius={3}
        fill={color || DEFAULT_WALL_COLOR}
        listening={false}
      />
      <Circle
        x={ex}
        y={ey}
        radius={3}
        fill={color || DEFAULT_WALL_COLOR}
        listening={false}
      />

      {/* Draggable endpoint handles (visible when selected).
          x/y stay bound to the committed props: Konva owns the node while the
          drag is in flight, and the committed value comes back through props
          on release. Do NOT call e.target.position() here — these handles are
          children of a draggable Group, so writing a prop-space coordinate
          into the node offsets it against the Group frame and the next drag
          reads a doubled value. */}
      {isSelected && (
        <>
          <Circle
            x={sx}
            y={sy}
            radius={Math.max(touchSizes.handleRadius, 7)}
            fill="#fff"
            stroke="#1890ff"
            strokeWidth={2}
            hitStrokeWidth={touchSizes.hitStrokeWidth}
            draggable
            dragBoundFunc={startDragBound}
            onMouseDown={handleEndpointDragStart}
            onTouchStart={handleEndpointDragStart}
            onDragStart={handleEndpointDragStart}
            onDragMove={handleStartDragMove}
            onDragEnd={handleStartDragEnd}
          />
          <Circle
            x={ex}
            y={ey}
            radius={Math.max(touchSizes.handleRadius, 7)}
            fill="#fff"
            stroke="#1890ff"
            strokeWidth={2}
            hitStrokeWidth={touchSizes.hitStrokeWidth}
            draggable
            dragBoundFunc={endDragBound}
            onMouseDown={handleEndpointDragStart}
            onTouchStart={handleEndpointDragStart}
            onDragStart={handleEndpointDragStart}
            onDragMove={handleEndDragMove}
            onDragEnd={handleEndDragEnd}
          />
        </>
      )}
    </Group>
  );
};

export const WMWallRenderer = React.memo(WMWallRendererInner);

// ============================================================================
// Vertex Renderer
// ============================================================================

interface WMVertexRendererProps {
  /** Corner position in canvas (layer) coordinates */
  x: number;
  y: number;
  isSelected: boolean;
  /** Directions of the walls meeting here, as unit vectors — Shift guides */
  directions: { x: number; y: number }[];
  /**
   * The FAR endpoints of the walls meeting here — the ends that stay put while
   * this corner is dragged.
   *
   * The angle snap measures bearings from these: with the far end fixed, where
   * the corner lands decides that wall's angle outright, so projecting onto a
   * ray leaving an anchor at a 15° multiple puts the wall on a round bearing.
   * `directions` alone cannot do this — it carries no position, so there is
   * nothing to measure an angle against.
   */
  anchors?: { x: number; y: number }[];
  onSelect: (x: number, y: number, ctrlKey?: boolean) => void;
  /**
   * Where this corner currently sits because something ELSE is being dragged
   * (a room, or a wall that meets here). Display only — it never changes the
   * committed x/y this component reports, so the React key stays stable.
   *
   * Ignored while this marker is itself the drag source: Konva owns the node
   * then, and applying an override on top would move it twice.
   */
  liveTo?: { x: number; y: number } | null;
  /** Committed move: every wall endpoint at `from` should follow to `to` */
  onVertexDrag: (
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) => void;
  /**
   * Live position during the drag, for previewing the reshaped room.
   * Called with null on drag end, once the committed move takes over.
   */
  onVertexDragMove?: (
    from: { x: number; y: number },
    to: { x: number; y: number } | null,
  ) => void;
  /**
   * The guide the corner is currently snapped to, for drawing a dashed
   * reference line and its angle. Null when nothing is snapped or the drag
   * has ended.
   */
  onSnapGuide?: (
    guide: {
      /** Point the guide passes through (the corner's committed position) */
      origin: { x: number; y: number };
      /** Unit direction of the guide line */
      dir: { x: number; y: number };
      /** Angle in degrees, 0-180, for the readout */
      angleDeg: number;
    } | null,
  ) => void;
}

/**
 * A draggable corner marker shown at every point where wall endpoints meet.
 *
 * Unlike the wall endpoint handles, these are always visible — the corner is
 * the thing being manipulated, so it should not require selecting a wall first.
 * Dragging one reshapes every wall meeting it at once.
 */
const WMVertexRendererInner: React.FC<WMVertexRendererProps> = ({
  x,
  y,
  isSelected,
  directions,
  anchors,
  liveTo,
  onSelect,
  onVertexDrag,
  onVertexDragMove,
  onSnapGuide,
}) => {
  const touchSizes = useTouchTargetSizes();

  /** True while this marker is the one being dragged. */
  const isSelfDraggingRef = useRef(false);

  const shiftHeldRef = useRef(false);
  const noteShift = useCallback((e: any) => {
    const evt = e?.evt;
    shiftHeldRef.current = !!evt && 'shiftKey' in evt && !!evt.shiftKey;
  }, []);

  const handleClick = useCallback(
    (e: any) => {
      e.cancelBubble = true;
      onSelect(x, y, e.evt?.ctrlKey || e.evt?.metaKey);
    },
    [x, y, onSelect],
  );

  /**
   * Snap the corner onto the nearest guide through its original position:
   * horizontal, vertical, every ANGLE_SNAP_STEP increment, and the line of any
   * wall meeting here (so a corner can slide along one of its own walls without
   * changing that wall's angle).
   *
   * Always on, but only within SNAP_TOLERANCE_PX of a guide — beyond that the
   * cursor is followed exactly, so free placement still works. Holding Shift
   * disables snapping entirely, for the cases where a guide is in the way.
   */
  const dragBound = useMemo(
    () =>
      function (this: any, pos: { x: number; y: number }) {
        // Shift is the escape hatch now that snapping is the default.
        if (shiftHeldRef.current) {
          onSnapGuide?.(null);
          return pos;
        }
        const layer = this?.getLayer?.();
        const tr = layer?.getAbsoluteTransform?.();
        if (!tr) return pos;
        const inv = tr.copy().invert();
        const local = inv.point(pos);

        /*
         * First choice: put the CORNER on a round angle.
         *
         * Measured from the fixed far end of each wall meeting here, so
         * landing on a 15° multiple makes that wall's bearing round — and when
         * both walls are round, so is the angle between them. Accepting within
         * ±3° is what makes "drop it roughly and have it snap to 90°" work;
         * the guides below snap each wall's ABSOLUTE bearing instead, which on
         * a plan drawn slightly off can never reach an exact square corner.
         */
        if (anchors && anchors.length > 0) {
          const byAngle = snapCornerToAngle(local, anchors);
          if (byAngle.guide) {
            onSnapGuide?.(byAngle.guide);
            return tr.point(byAngle.point);
          }
        }

        // Candidate guide directions as unit vectors through (x, y).
        const dirs: { x: number; y: number }[] = [];
        for (let a = 0; a < 180; a += ANGLE_SNAP_STEP_DEG) {
          const rad = (a * Math.PI) / 180;
          dirs.push({ x: Math.cos(rad), y: Math.sin(rad) });
        }
        // Existing wall angles, which are rarely on a neat increment.
        for (const d of directions) dirs.push(d);

        let best: { x: number; y: number } | null = null;
        let bestDist = Infinity;
        let bestDir: { x: number; y: number } | null = null;
        for (const d of dirs) {
          const proj = (local.x - x) * d.x + (local.y - y) * d.y;
          const cand = { x: x + d.x * proj, y: y + d.y * proj };
          const dist = Math.hypot(cand.x - local.x, cand.y - local.y);
          if (dist < bestDist) {
            bestDist = dist;
            best = cand;
            bestDir = d;
          }
        }

        // Too far from every guide — follow the cursor and draw nothing.
        const scale = this?.getStage?.()?.scaleX?.() || 1;
        if (!best || !bestDir || bestDist > SNAP_TOLERANCE_PX / scale) {
          onSnapGuide?.(null);
          return pos;
        }

        let angleDeg = (Math.atan2(bestDir.y, bestDir.x) * 180) / Math.PI;
        if (angleDeg < 0) angleDeg += 180;
        onSnapGuide?.({ origin: { x, y }, dir: bestDir, angleDeg });
        return tr.point(best);
      },
    [x, y, directions, onSnapGuide],
  );

  const handleDragStart = useCallback(
    (e: any) => {
      isSelfDraggingRef.current = true;
      noteShift(e);
    },
    [noteShift],
  );

  const handleDragMove = useCallback(
    (e: any) => {
      noteShift(e);
      // Report the in-flight position so the room outline can follow the
      // corner instead of snapping only once the drag is released.
      onVertexDragMove?.({ x, y }, { x: e.target.x(), y: e.target.y() });
    },
    [x, y, noteShift, onVertexDragMove],
  );

  const handleDragEnd = useCallback(
    (e: any) => {
      e.cancelBubble = true;
      isSelfDraggingRef.current = false;
      onSnapGuide?.(null);
      const nx = e.target.x();
      const ny = e.target.y();
      // Put the node back on the committed coordinate: the new position
      // arrives through props, and if it is unchanged React re-renders
      // nothing and the marker would stay stranded at the drop point.
      e.target.position({ x, y });
      // Clear the preview first — the committed data takes over from here.
      onVertexDragMove?.({ x, y }, null);
      if (nx !== x || ny !== y) onVertexDrag({ x, y }, { x: nx, y: ny });
    },
    [x, y, onVertexDrag, onVertexDragMove, onSnapGuide],
  );

  // Follow an external drag (room / wall), but never while this marker is the
  // one being dragged — Konva already owns the node's position then.
  const shownX = !isSelfDraggingRef.current && liveTo ? liveTo.x : x;
  const shownY = !isSelfDraggingRef.current && liveTo ? liveTo.y : y;

  return (
    <RegularPolygon
      x={shownX}
      y={shownY}
      sides={4}
      radius={isSelected ? 8 : 6}
      rotation={45}
      fill={isSelected ? '#ff4d4f' : '#fff'}
      stroke="#ff4d4f"
      strokeWidth={2}
      hitStrokeWidth={touchSizes.hitStrokeWidth}
      draggable
      dragBoundFunc={dragBound}
      onMouseDown={noteShift}
      onTouchStart={noteShift}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      onTap={handleClick}
      onMouseEnter={(e) => {
        const s = e.target.getStage();
        if (s) s.container().style.cursor = 'move';
      }}
      onMouseLeave={(e) => {
        const s = e.target.getStage();
        if (s) s.container().style.cursor = '';
      }}
    />
  );
};

export const WMVertexRenderer = React.memo(WMVertexRendererInner);

// ============================================================================
// Room Renderer
// ============================================================================

interface WMRoomRendererProps {
  room: WMRoom;
  isSelected: boolean;
  onSelect: (id: string, ctrlKey?: boolean) => void;
  /** Drag the entire room (all boundary points move together) */
  onRoomDragEnd?: (roomId: string, dx: number, dy: number) => void;
  /** Drag a single boundary vertex to reshape the room */
  onRoomVertexDrag?: (roomId: string, vertexIndex: number, x: number, y: number) => void;
  /**
   * Live boundary movement while the whole room is being dragged, so the walls
   * sitting on that boundary travel with it instead of staying behind until
   * the drag is released. Called with null on drag end.
   */
  onRoomDragMove?: (
    moves: { from: { x: number; y: number }; to: { x: number; y: number } }[] | null,
  ) => void;
  /**
   * Boundary to draw instead of the room's stored one, while a wall or corner
   * is mid-drag. The stored boundary only updates on release, so without this
   * the room outline lags behind the geometry the user is moving.
   */
  previewBoundary?: { x: number; y: number }[] | null;
  /** Canvas px per foot — needed to recompute the area while previewing */
  scalePixelsPerFoot: number;
}

const WMRoomRendererInner: React.FC<WMRoomRendererProps> = ({
  room,
  isSelected,
  onSelect,
  onRoomDragEnd,
  onRoomVertexDrag,
  onRoomDragMove,
  previewBoundary,
  scalePixelsPerFoot,
}) => {
  // Handles must be finger-sized on touch devices; `hitStrokeWidth`
  // widens the tap target without changing how the handle looks.
  const touchSizes = useTouchTargetSizes();
  const { id, name, color } = room;
  const isVertexDragging = useRef(false);
  /**
   * True while THIS room's own Group drag is in flight.
   *
   * Konva already translates every child of the Group, and the drag also feeds
   * liveMoves, which comes back as previewBoundary for this same room. Applying
   * both would move the room twice and tear it away from its walls, so the
   * preview is ignored for the room that is doing the dragging.
   */
  const isSelfGroupDraggingRef = useRef(false);
  // Everything below derives from `boundary`, so overriding it here makes the
  // fill, the label position and the area read-out all follow a live drag.
  const boundary =
    !isSelfGroupDraggingRef.current && previewBoundary ? previewBoundary : room.boundary;

  // Shift constraint for room vertex / edge handles — same rule as the wall
  // endpoint handles: hold Shift to keep an adjacent edge's angle, or snap to
  // horizontal / vertical through the neighbouring corner.
  const shiftHeldRef = useRef(false);
  const noteShift = useCallback((e: any) => {
    const evt = e?.evt;
    shiftHeldRef.current = !!evt && 'shiftKey' in evt && !!evt.shiftKey;
  }, []);

  /**
   * Project `pos` onto the nearest guide through `anchor`: the existing
   * direction anchor→orig (preserving that edge's angle), or horizontal /
   * vertical through the anchor.
   */
  const constrainToGuides = useCallback(
    (pos: { x: number; y: number }, anchorX: number, anchorY: number, origX: number, origY: number) => {
      const candidates: { x: number; y: number }[] = [
        { x: pos.x, y: anchorY },
        { x: anchorX, y: pos.y },
      ];
      const wx = origX - anchorX;
      const wy = origY - anchorY;
      const wlen = Math.hypot(wx, wy);
      if (wlen > 0.001) {
        const ux = wx / wlen;
        const uy = wy / wlen;
        const proj = Math.max(0, (pos.x - anchorX) * ux + (pos.y - anchorY) * uy);
        candidates.push({ x: anchorX + ux * proj, y: anchorY + uy * proj });
      }
      let best = candidates[0];
      let bestDist = Infinity;
      for (const c of candidates) {
        const d = Math.hypot(c.x - pos.x, c.y - pos.y);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      return best;
    },
    []
  );

  /** dragBoundFunc factory — converts absolute ↔ layer space, see wall renderer. */
  const makeVertexDragBound = useCallback(
    (anchorX: number, anchorY: number, origX: number, origY: number) =>
      function (this: any, pos: { x: number; y: number }) {
        if (!shiftHeldRef.current) return pos;
        const layer = this?.getLayer?.();
        const tr = layer?.getAbsoluteTransform?.();
        if (!tr) return constrainToGuides(pos, anchorX, anchorY, origX, origY);
        const inv = tr.copy().invert();
        const local = inv.point(pos);
        const fixed = constrainToGuides(local, anchorX, anchorY, origX, origY);
        return tr.point(fixed);
      },
    [constrainToGuides]
  );

  /**
   * Constraint for dragging the whole room: Shift restricts it to horizontal or
   * vertical movement. A room has no single axis of its own, so those are the
   * only two guides (the degenerate direction candidate is skipped).
   *
   * Same frame caveat as the wall group — see the note on groupDragBound. The
   * proposed value is the group's absolute position and the quantity being
   * constrained is a translation, so it is converted by subtracting the group
   * origin and dividing by the stage scale, NOT by inverting the layer
   * transform (which would add the pan offset to a delta).
   */
  const roomGroupDragBound = useMemo(
    () =>
      function (this: any, pos: { x: number; y: number }) {
        if (!shiftHeldRef.current) return pos;
        const node = this;
        const origin = node?.getAbsolutePosition
          ? (() => {
              const cur = node.getAbsolutePosition();
              return { x: cur.x - node.x(), y: cur.y - node.y() };
            })()
          : { x: 0, y: 0 };
        const scale = node?.getStage?.()?.scaleX?.() || 1;
        const deltaLayer = {
          x: (pos.x - origin.x) / scale,
          y: (pos.y - origin.y) / scale,
        };
        const fixed = constrainToGuides(deltaLayer, 0, 0, 0, 0);
        return {
          x: origin.x + fixed.x * scale,
          y: origin.y + fixed.y * scale,
        };
      },
    [constrainToGuides]
  );

  const handleClick = useCallback(
    (e: any) => {
      e.cancelBubble = true;
      onSelect(id, e.evt?.ctrlKey || e.evt?.metaKey);
    },
    [id, onSelect]
  );

  /**
   * Whole-room drag in flight: report where each boundary point currently is,
   * so the walls standing on that boundary move with the room rather than
   * waiting for the commit on release.
   */
  const handleGroupDragMove = useCallback(
    (e: any) => {
      noteShift(e);
      if (isVertexDragging.current) return;
      isSelfGroupDraggingRef.current = true;
      const dx = e.target.x();
      const dy = e.target.y();
      const src = room.boundary ?? [];
      onRoomDragMove?.(
        src.map((p) => ({ from: { x: p.x, y: p.y }, to: { x: p.x + dx, y: p.y + dy } })),
      );
    },
    [noteShift, onRoomDragMove, room.boundary],
  );

  // Drag entire room — compute delta and reset group position
  const handleGroupDragEnd = useCallback(
    (e: any) => {
      // Clear FIRST, before any early return — otherwise the vertex-handle
      // path below skips it and the flag stays set, permanently suppressing
      // this room's preview.
      isSelfGroupDraggingRef.current = false;
      onRoomDragMove?.(null);
      // Skip if a vertex/edge handle triggered this
      if (isVertexDragging.current) {
        e.target.position({ x: 0, y: 0 });
        return;
      }
      const dx = e.target.x();
      const dy = e.target.y();
      e.target.position({ x: 0, y: 0 });
      if (dx !== 0 || dy !== 0) {
        onRoomDragEnd?.(id, dx, dy);
      }
    },
    [id, onRoomDragEnd, onRoomDragMove]
  );

  // Edge midpoints for side-resize handles (must be before early return)
  const edgeMidpoints = useMemo(() => {
    if (!boundary || boundary.length < 3) return [];
    return boundary.map((p, i) => {
      const next = boundary[(i + 1) % boundary.length];
      return { x: (p.x + next.x) / 2, y: (p.y + next.y) / 2, i1: i, i2: (i + 1) % boundary.length };
    });
  }, [boundary]);

  if (!boundary || boundary.length < 3) return null;

  // Flatten boundary to [x1,y1,x2,y2,...] for Konva Line
  const flatPoints = boundary.flatMap((p) => [p.x, p.y]);

  // Calculate centroid for label
  const cx = boundary.reduce((s, p) => s + p.x, 0) / boundary.length;
  const cy = boundary.reduce((s, p) => s + p.y, 0) / boundary.length;

  // Measure rough bounding size for label fitting
  const minX = Math.min(...boundary.map((p) => p.x));
  const maxX = Math.max(...boundary.map((p) => p.x));
  const roomWidth = maxX - minX;

  // While previewing, the stored area_sqft belongs to the pre-drag shape, so
  // recompute from the boundary actually being drawn (shoelace, px² → ft²).
  let area_sqft = room.area_sqft;
  if (previewBoundary && scalePixelsPerFoot > 0) {
    let a2 = 0;
    for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
      a2 += (boundary[j].x + boundary[i].x) * (boundary[j].y - boundary[i].y);
    }
    area_sqft = Math.abs(a2 / 2) / (scalePixelsPerFoot * scalePixelsPerFoot);
  }

  return (
    <Group
      draggable={isSelected}
      dragBoundFunc={roomGroupDragBound}
      onDragStart={noteShift}
      onDragMove={handleGroupDragMove}
      onDragEnd={handleGroupDragEnd}
    >
      {/* Room fill */}
      <Line
        points={flatPoints}
        closed
        fill={color || DEFAULT_ROOM_COLOR}
        stroke={isSelected ? '#1890ff' : '#0066cc'}
        strokeWidth={isSelected ? 2 : 1}
        opacity={0.6}
        onClick={handleClick}
        onTap={handleClick}
      />

      {/* Room name label */}
      {roomWidth > 40 && (
        <Text
          x={cx}
          y={cy - 10}
          text={name}
          fontSize={13}
          fontStyle="bold"
          fill={isSelected ? '#1890ff' : '#333'}
          fontFamily="'Inter', 'Segoe UI', sans-serif"
          align="center"
          offsetX={name.length * 3.5}
          listening={false}
        />
      )}

      {/* Area label */}
      {area_sqft > 0 && roomWidth > 50 && (
        <Text
          x={cx}
          y={cy + 6}
          text={`${area_sqft.toFixed(0)} SF`}
          fontSize={11}
          fill={isSelected ? '#1890ff' : '#666'}
          fontFamily="'Inter', 'Segoe UI', sans-serif"
          align="center"
          offsetX={20}
          listening={false}
        />
      )}

      {/* Vertex handles (corner resize — shown when selected) */}
      {isSelected && boundary.map((pt, idx) => (
        <Circle
          key={`v-${idx}`}
          x={pt.x}
          y={pt.y}
          radius={6}
          fill="#fff"
          stroke="#1890ff"
          strokeWidth={2}
          hitStrokeWidth={touchSizes.hitStrokeWidth}
          draggable
          // Anchor on the previous corner, so Shift keeps the angle of the
          // edge running into this vertex (or snaps it horizontal/vertical).
          dragBoundFunc={makeVertexDragBound(
            boundary[(idx - 1 + boundary.length) % boundary.length].x,
            boundary[(idx - 1 + boundary.length) % boundary.length].y,
            pt.x,
            pt.y,
          )}
          onDragStart={(e) => {
            e.cancelBubble = true;
            isVertexDragging.current = true;
            noteShift(e);
          }}
          onDragMove={noteShift}
          onDragEnd={(e) => {
            e.cancelBubble = true;
            const newX = e.target.x();
            const newY = e.target.y();
            e.target.position({ x: pt.x, y: pt.y });
            onRoomVertexDrag?.(id, idx, newX, newY);
            setTimeout(() => { isVertexDragging.current = false; }, 0);
          }}
          onMouseEnter={(e) => {
            const s = e.target.getStage();
            if (s) s.container().style.cursor = 'move';
          }}
          onMouseLeave={(e) => {
            const s = e.target.getStage();
            if (s) s.container().style.cursor = '';
          }}
        />
      ))}

      {/* Edge midpoint handles (side resize — shown when selected) */}
      {isSelected && edgeMidpoints.map((mp, idx) => (
        <Circle
          key={`e-${idx}`}
          x={mp.x}
          y={mp.y}
          radius={4}
          fill="#1890ff"
          stroke="#fff"
          strokeWidth={1.5}
          hitStrokeWidth={touchSizes.hitStrokeWidth}
          draggable
          // An edge handle slides the whole edge, so Shift restricts that
          // motion to the edge's own normal directions: horizontal / vertical
          // through where the handle started, or along the edge itself.
          dragBoundFunc={makeVertexDragBound(
            mp.x,
            mp.y,
            mp.x + (boundary[mp.i2].x - boundary[mp.i1].x),
            mp.y + (boundary[mp.i2].y - boundary[mp.i1].y),
          )}
          onDragStart={(e) => {
            e.cancelBubble = true;
            isVertexDragging.current = true;
            noteShift(e);
          }}
          onDragMove={noteShift}
          onDragEnd={(e) => {
            e.cancelBubble = true;
            const newX = e.target.x();
            const newY = e.target.y();
            const dx = newX - mp.x;
            const dy = newY - mp.y;
            e.target.position({ x: mp.x, y: mp.y });
            // Move both vertices of this edge
            onRoomVertexDrag?.(id, mp.i1, boundary[mp.i1].x + dx, boundary[mp.i1].y + dy);
            onRoomVertexDrag?.(id, mp.i2, boundary[mp.i2].x + dx, boundary[mp.i2].y + dy);
            setTimeout(() => { isVertexDragging.current = false; }, 0);
          }}
          onMouseEnter={(e) => {
            const s = e.target.getStage();
            if (s) s.container().style.cursor = 'pointer';
          }}
          onMouseLeave={(e) => {
            const s = e.target.getStage();
            if (s) s.container().style.cursor = '';
          }}
        />
      ))}
    </Group>
  );
};

export const WMRoomRenderer = React.memo(WMRoomRendererInner);

// ============================================================================
// Wall Drawing Preview (ghost line from start point to cursor)
// ============================================================================

interface WMWallPreviewProps {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  /** Snap point — highlight with a circle if snapped */
  snappedEnd?: { x: number; y: number } | null;
}

export const WMWallPreview: React.FC<WMWallPreviewProps> = ({
  startX,
  startY,
  endX,
  endY,
  snappedEnd,
}) => {
  // Show live length as the user draws
  const dx = endX - startX;
  const dy = endY - startY;
  const lenPx = Math.sqrt(dx * dx + dy * dy);

  return (
    <Group listening={false}>
      <Line
        points={[startX, startY, endX, endY]}
        stroke="#1890ff"
        strokeWidth={3}
        dash={[8, 4]}
        opacity={0.7}
        lineCap="round"
      />
      {/* Start indicator */}
      <Circle
        x={startX}
        y={startY}
        radius={5}
        fill="#1890ff"
        opacity={0.8}
      />
      {/* End indicator */}
      <Circle
        x={endX}
        y={endY}
        radius={4}
        fill="#1890ff"
        opacity={0.6}
      />
      {/* Snap indicator at end */}
      {snappedEnd && (
        <Circle
          x={snappedEnd.x}
          y={snappedEnd.y}
          radius={8}
          fill="transparent"
          stroke="#52c41a"
          strokeWidth={2}
          opacity={0.9}
        />
      )}
      {/* Length preview label */}
      {lenPx > 20 && (
        <Text
          x={(startX + endX) / 2}
          y={(startY + endY) / 2 - 16}
          text={`${lenPx.toFixed(0)}px`}
          fontSize={10}
          fill="#1890ff"
          fontFamily="monospace"
          offsetX={15}
        />
      )}
    </Group>
  );
};

export default WMWallRenderer;
