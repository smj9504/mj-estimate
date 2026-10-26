/**
 * Turns the bathroom model (bathroom3dModel.ts) into three.js objects: the
 * walls with their tile, surrounds, baseboard, doors and windows; the floor;
 * and each fixture built from its sizes and properties. One inch is one world
 * unit. Every wall keeps its own materials, so the view can ghost the walls
 * between the camera and the room (updateCutaway) and look in from any side.
 */

import * as THREE from 'three';
import type { BathroomLooks, BathroomModel, FixtureSolid, Pt, TileLook, WallOpeningSolid, WallSolid } from './bathroom3dModel';
import type { TileTextureCache } from './bathroom3dTextures';
import { MIRROR_HEIGHT_IN, SHOWER_DOOR_HEIGHT_IN } from '../../../types/bathroomSketch';
import { getShowerUnitPolygon } from './utils/beGeometry';
import { subtractRects, type FaceRect } from './utils/wallFinish';

const COLORS = {
  ground: '#e9e6df',
  trim: '#f4f2ed',
  door: '#f1eee8',
  glass: '#d4e6ec',
  water: '#cfe2e8',
  drain: '#4a4f54',
  niche: '#b9b2a6',
  curtain: '#e8e2d6',
  light: '#fff3d6',
  selected: '#1f74c9',
  mirror: '#dfe7ea',
};

/** Where a tub's shower curtain hangs from, inches. */
const GLASS_TOP_IN = 76;
/** A mirror's bottom edge, inches: clear of a vanity and its backsplash. */
const MIRROR_BOTTOM_IN = 42;
const BASEBOARD_IN = 3.5;
/** Doors stand open square to their wall, as the plan's swing arc ends, clear of the doorway. */
const OPEN_DOOR_RAD = (88 * Math.PI) / 180;

export interface WallGhost {
  group: THREE.Group;
  /** Middle of the wall at eye height, and the normal into its room. */
  mid: THREE.Vector3;
  inward: THREE.Vector3 | null;
  materials: THREE.MeshStandardMaterial[];
  ghosted: boolean;
}

export interface BuiltScene {
  root: THREE.Group;
  walls: WallGhost[];
}

// ── Small builders ──

const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...extra });

function shadowed<T extends THREE.Object3D>(obj: T, cast = true): T {
  obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = cast;
      o.receiveShadow = true;
    }
  });
  return obj;
}

/** UVs from inches to the texture's repeat. */
function scaleUV(geometry: THREE.BufferGeometry, repeat: [number, number]) {
  const uv = geometry.getAttribute('uv');
  if (!uv) return geometry;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / repeat[0], uv.getY(i) / repeat[1]);
  uv.needsUpdate = true;
  return geometry;
}

/** A plan outline in the fixture's or room's frame (x, z), less holes, stood up between y0 and y1. */
function prism(points: Pt[], y0: number, y1: number, holes: Pt[][] = []): THREE.ExtrudeGeometry {
  const flat = (pts: Pt[]) => pts.map(([x, z]) => new THREE.Vector2(x, -z));
  const shape = new THREE.Shape(flat(points));
  shape.holes = holes.map((h) => new THREE.Path(flat(h)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.01, y1 - y0), bevelEnabled: false, curveSegments: 24 });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y0, 0);
  return geometry;
}

function boxAt(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.01, w), Math.max(0.01, h), Math.max(0.01, d)), material);
  mesh.position.set(x, y, z);
  return mesh;
}

/** An upright cylinder standing on (x, y0, z). */
function post(r: number, h: number, material: THREE.Material, x: number, y0: number, z: number, seg = 24): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), material);
  mesh.position.set(x, y0 + h / 2, z);
  return mesh;
}

/** A disc on a wall facing +z (a trim plate, a showerhead), its centre at (x, y, z). */
function plate(r: number, t: number, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, t, 32), material);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  return mesh;
}

function ellipse(rx: number, rz: number, cx = 0, cz = 0, n = 48): Pt[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return [cx + rx * Math.cos(t), cz + rz * Math.sin(t)] as Pt;
  });
}

function roundedRect(w: number, d: number, r: number, cx = 0, cz = 0, n = 6): Pt[] {
  const rr = Math.min(r, w / 2, d / 2);
  const pts: Pt[] = [];
  const corners: [number, number, number][] = [
    [cx + w / 2 - rr, cz - d / 2 + rr, -Math.PI / 2],
    [cx + w / 2 - rr, cz + d / 2 - rr, 0],
    [cx - w / 2 + rr, cz + d / 2 - rr, Math.PI / 2],
    [cx - w / 2 + rr, cz - d / 2 + rr, Math.PI],
  ];
  for (const [ccx, ccz, start] of corners) {
    for (let i = 0; i <= n; i++) {
      const t = start + (i / n) * (Math.PI / 2);
      pts.push([ccx + rr * Math.cos(t), ccz + rr * Math.sin(t)]);
    }
  }
  return pts;
}

/** A sink or tub bowl: the lower half of an egg, seen from above. */
function bowl(rx: number, depth: number, rz: number, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  // Seen from above it's the inside of the shell that shows
  const inside = material.clone();
  inside.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), inside);
  mesh.scale.set(rx, depth, rz);
  mesh.position.set(x, y, z);
  return mesh;
}

/** A thin board between two plan points (glass, a curb, a rod), standing from y0 to y1. */
function panelAlong(p: Pt, q: Pt, y0: number, y1: number, thick: number, material: THREE.Material, inset: Pt = [0, 0]): THREE.Mesh {
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const mesh = boxAt(len, y1 - y0, thick, material, (p[0] + q[0]) / 2 + inset[0], (y0 + y1) / 2, (p[1] + q[1]) / 2 + inset[1]);
  mesh.rotation.y = -Math.atan2(q[1] - p[1], q[0] - p[0]);
  return mesh;
}

/** A rectangle facing +z at depth z, mapped with tile at its real size (or stretched if there's no texture). */
function facePanel(r: FaceRect, z: number, material: THREE.Material, repeat?: [number, number]): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    r.x0, r.y0, z, r.x1, r.y0, z, r.x1, r.y1, z, r.x0, r.y1, z,
  ], 3));
  const [rx, ry] = repeat ?? [r.x1 - r.x0 || 1, r.y1 - r.y0 || 1];
  const [ox, oy] = repeat ? [0, 0] : [r.x0, r.y0];
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    (r.x0 - ox) / rx, (r.y0 - oy) / ry, (r.x1 - ox) / rx, (r.y0 - oy) / ry,
    (r.x1 - ox) / rx, (r.y1 - oy) / ry, (r.x0 - ox) / rx, (r.y1 - oy) / ry,
  ], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

function tileMaterial(look: TileLook, textures: TileTextureCache): { material: THREE.MeshStandardMaterial; repeat: [number, number] } {
  const { texture, repeatIn } = textures.get(look);
  return { material: mat('#ffffff', { map: texture, roughness: look.roughness }), repeat: repeatIn };
}

// ── Walls ──

/**
 * A wall in its own frame: x along it, y up, z into its room. The model
 * gives faces along a→b; a wall whose room is on the other side is turned
 * end for end so its room is always +z.
 */
function wallFrame(w: WallSolid) {
  let a = w.a;
  let b = w.b;
  let flip = false;
  if (w.inward) {
    const ux = (b[0] - a[0]) / (w.lengthIn || 1);
    const uz = (b[1] - a[1]) / (w.lengthIn || 1);
    if (-uz * w.inward[0] + ux * w.inward[1] < 0) {
      [a, b] = [b, a];
      flip = true;
    }
  }
  const L = w.lengthIn;
  const mirror = (r: FaceRect): FaceRect => (flip ? { ...r, x0: L - r.x1, x1: L - r.x0 } : r);
  return { a, b, flip, mirror };
}

function buildOpening(
  o: WallOpeningSolid,
  flip: boolean,
  thick: number,
  roomSide: boolean,
  add: (obj: THREE.Object3D) => void,
  m: { trim: THREE.MeshStandardMaterial; door: THREE.MeshStandardMaterial; glass: THREE.MeshStandardMaterial; metal: THREE.MeshStandardMaterial },
) {
  const { x0, x1, y0, y1 } = o.rect;
  const w = x1 - x0;
  const h = y1 - y0;
  // Jambs and head lining the opening, and casing on the room side
  add(boxAt(0.75, h, thick, m.trim, x0 + 0.375, y0 + h / 2, -thick / 2));
  add(boxAt(0.75, h, thick, m.trim, x1 - 0.375, y0 + h / 2, -thick / 2));
  add(boxAt(w, 0.75, thick, m.trim, x0 + w / 2, y1 - 0.375, -thick / 2));
  if (roomSide) {
    add(boxAt(2.5, h + 2.5, 0.75, m.trim, x0 - 1.25, y0 + (h + 2.5) / 2, 0.375));
    add(boxAt(2.5, h + 2.5, 0.75, m.trim, x1 + 1.25, y0 + (h + 2.5) / 2, 0.375));
    add(boxAt(w + 5, 2.5, 0.75, m.trim, x0 + w / 2, y1 + 1.25, 0.375));
  }

  if (o.kind === 'window') {
    add(facePanel({ x0: x0 + 0.75, x1: x1 - 0.75, y0: y0 + 0.75, y1: y1 - 0.75 }, -thick / 2, m.glass));
    add(boxAt(w - 1.5, 1.2, 1.2, m.trim, x0 + w / 2, y0 + h / 2, -thick / 2));
    if (roomSide) add(boxAt(w + 4, 0.75, 3.5, m.trim, x0 + w / 2, y0 - 0.375, 1.25));
    return;
  }

  // The door, open into the side its plan symbol swings to
  const hingeAtStart = flip ? !o.hingeAtStart : o.hingeAtStart;
  const leafW = w - 1.75;
  const leafH = h - 1;
  const side = o.swingsIn ? 1 : -1;
  const pivot = new THREE.Group();
  pivot.position.set(hingeAtStart ? x0 + 0.875 : x1 - 0.875, y0, o.swingsIn ? 0 : -thick);
  const dir = hingeAtStart ? 1 : -1;
  const leaf = boxAt(leafW, leafH, 1.375, m.door, (dir * leafW) / 2, leafH / 2, side * 0.7);
  pivot.add(leaf);
  pivot.add(post(0.45, 0.4, m.metal, dir * (leafW - 2.5), 36, side * 2.4));
  pivot.add(boxAt(4, 0.6, 0.6, m.metal, dir * (leafW - 4), 36.2, side * 2.6));
  pivot.rotation.y = -dir * side * OPEN_DOOR_RAD;
  add(pivot);
}

function buildWall(
  w: WallSolid,
  model: BathroomModel,
  textures: TileTextureCache,
): WallGhost {
  const looks = model.looks;
  const { a, b, flip, mirror } = wallFrame(w);
  const group = new THREE.Group();
  group.userData.sketchId = w.id;
  group.position.set(a[0], 0, a[1]);
  const ux = b[0] - a[0];
  const uz = b[1] - a[1];
  group.rotation.y = Math.atan2(-uz, ux);

  const T = w.thicknessIn;
  // A wall in a room is framed outward from its line; one in no room is centred on it
  const bodyZ = w.inward ? -T / 2 : 0;
  const faceZ = w.inward ? 0 : T / 2;
  const materials: THREE.MeshStandardMaterial[] = [];
  const own = <M extends THREE.MeshStandardMaterial>(m: M): M => { materials.push(m); return m; };
  const add = (obj: THREE.Object3D) => group.add(obj);

  const paint = own(mat(looks.paint, { roughness: 0.92 }));
  for (const p of w.pieces.map(mirror)) {
    add(boxAt(p.x1 - p.x0, p.y1 - p.y0, T, paint, (p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2, bodyZ));
  }

  // Tile to install (or there today), on the room side
  if (w.tile.length) {
    const { material, repeat } = tileMaterial(looks.wallTile, textures);
    own(material);
    for (const r of w.tile.map(mirror)) add(facePanel(r, faceZ + 0.06, material, repeat));
  }

  // Behind a tub or shower: its tile, or its prefab surround
  const typeOf = new Map(model.fixtures.map((f) => [f.fixture.id, f.fixture.type]));
  const surroundMaterials = new Map<string, { material: THREE.MeshStandardMaterial; repeat?: [number, number] }>();
  for (const s of w.surrounds) {
    const key = s.finish === 'prefab' ? 'prefab' : typeOf.get(s.fixtureId) === 'shower' ? 'shower' : 'tub';
    let entry = surroundMaterials.get(key);
    if (!entry) {
      entry = key === 'prefab'
        ? { material: mat(looks.prefab, { roughness: 0.22 }) }
        : tileMaterial(key === 'shower' ? looks.showerTile : looks.surroundTile, textures);
      own(entry.material);
      surroundMaterials.set(key, entry);
    }
    add(facePanel(mirror(s.rect), faceZ + (key === 'prefab' ? 0.25 : 0.08), entry.material, entry.repeat));
  }

  // Baseboard wherever the wall is painted down to the floor
  const trim = own(mat(COLORS.trim, { roughness: 0.5 }));
  if (w.inward) {
    const covered = w.tile.concat(w.surrounds.map((s) => s.rect), w.openings.filter((o) => o.kind === 'door').map((o) => o.rect));
    for (const r of subtractRects([{ x0: 0, x1: w.lengthIn, y0: 0, y1: BASEBOARD_IN }], covered).map(mirror)) {
      add(boxAt(r.x1 - r.x0, r.y1 - r.y0, 0.6, trim, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, 0.3));
    }
  }

  const openingMaterials = {
    trim,
    door: own(mat(COLORS.door, { roughness: 0.45 })),
    glass: own(mat(COLORS.glass, { roughness: 0.05, transparent: true, opacity: 0.28, depthWrite: false })),
    metal: own(metalMaterial(looks)),
  };
  for (const o of w.openings) {
    buildOpening({ ...o, rect: mirror(o.rect) }, flip, T, !!w.inward, add, openingMaterials);
  }

  const mx = (w.a[0] + w.b[0]) / 2;
  const mz = (w.a[1] + w.b[1]) / 2;
  return {
    group: shadowed(group),
    mid: new THREE.Vector3(mx, 48, mz),
    inward: w.inward ? new THREE.Vector3(w.inward[0], 0, w.inward[1]) : null,
    materials,
    ghosted: false,
  };
}

function metalMaterial(looks: BathroomLooks) {
  const c = new THREE.Color(looks.metal);
  const dark = c.r + c.g + c.b < 0.6;
  return mat(looks.metal, dark ? { metalness: 0.4, roughness: 0.55 } : { metalness: 0.95, roughness: 0.18 });
}

// ── Fixtures (each in its own frame: x across it, z from its back (−) to its front (+), y up) ──

interface FixtureKit {
  looks: BathroomLooks;
  textures: TileTextureCache;
  china: THREE.MeshStandardMaterial;
  prefab: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
}

/** A solid whose UVs are in inches (an extruded plan outline), tiled at real size. */
function tiledSolid(geometry: THREE.BufferGeometry, look: TileLook, textures: TileTextureCache): THREE.Mesh {
  const { material, repeat } = tileMaterial(look, textures);
  return new THREE.Mesh(scaleUV(geometry, repeat), material);
}

function buildToilet(f: FixtureSolid, kit: FixtureKit, g: THREE.Group) {
  const W = f.widthIn;
  const D = f.depthIn;
  const tankD = 0.28 * D;
  const tankW = 0.92 * W;
  const tankZ = -D / 2 + 0.02 * D + tankD / 2;
  g.add(boxAt(tankW, 14.5, tankD, kit.china, 0, 15 + 7.25, tankZ));
  g.add(boxAt(tankW + 0.6, 1, tankD + 0.6, kit.china, 0, 30, tankZ));
  g.add(boxAt(2.4, 0.6, 0.8, kit.metal, tankW / 2 - 2, 27, tankZ + tankD / 2 + 0.4));
  // Pedestal, then the bowl rim, seat and closed lid
  const bowlLen = 0.7 * D;
  const bowlZ = D / 2 - bowlLen / 2;
  g.add(new THREE.Mesh(prism(ellipse(W * 0.27, D * 0.26, 0, -D / 2 + 0.45 * D), 0, 10), kit.china));
  g.add(new THREE.Mesh(prism(ellipse(W / 2 - 0.3, bowlLen / 2, 0, bowlZ), 10, 15, [ellipse(W / 2 - 2, bowlLen / 2 - 2, 0, bowlZ + 0.5)]), kit.china));
  g.add(new THREE.Mesh(prism(ellipse(W / 2 - 1.5, bowlLen / 2 - 1.5, 0, bowlZ + 0.5), 11.5, 12), mat(COLORS.water, { roughness: 0.05 })));
  g.add(new THREE.Mesh(prism(ellipse(W / 2 - 0.2, bowlLen / 2 - 0.2, 0, bowlZ), 15, 15.6), kit.china));
  g.add(new THREE.Mesh(prism(ellipse(W / 2 - 0.5, bowlLen / 2 - 0.6, 0, bowlZ + 0.3), 15.6, 16.4), kit.china));
}

function faucet(kit: FixtureKit, g: THREE.Group, x: number, y: number, z: number, reach = 5) {
  g.add(post(0.65, 6, kit.metal, x, y, z));
  g.add(boxAt(0.9, 0.9, reach, kit.metal, x, y + 5.6, z + reach / 2));
  g.add(boxAt(0.5, 0.5, 2.6, kit.metal, x + 1.8, y + 3.5, z));
}

function buildVanity(f: FixtureSolid, kit: FixtureKit, g: THREE.Group) {
  const W = f.widthIn;
  const D = f.depthIn;
  const sub = f.fixture.properties.vanitySubType ?? 'cabinet';
  const sinks = Math.max(1, Math.min(2, f.fixture.properties.sinkCount ?? 1));
  const top = 34;

  if (sub !== 'cabinet') {
    // A basin on a pedestal, or hung on the wall
    const basinZ = -D / 2 + 0.42 * D;
    const rx = W / 2;
    const rz = 0.36 * D;
    g.add(new THREE.Mesh(prism(ellipse(rx, rz, 0, basinZ), top - 6, top, [ellipse(rx - 2, rz - 2, 0, basinZ + 0.5)]), kit.china));
    g.add(bowl(rx - 2, 5, rz - 2, kit.china, 0, top - 0.5, basinZ + 0.5));
    g.add(boxAt(W * 0.6, 6, 2.5, kit.china, 0, top - 3, -D / 2 + 1.25));
    if (sub === 'pedestal_sink') {
      g.add(post(W * 0.15, top - 6, kit.china, 0, 0, basinZ - 1));
      g.add(post(W * 0.2, 1.2, kit.china, 0, 0, basinZ - 1));
    }
    faucet(kit, g, 0, top, -D / 2 + 2.2, 4);
    return;
  }

  const looks = kit.looks;
  const floating = looks.vanityFloating;
  const bottom = floating ? 10 : 4;
  const topT = 1.25;
  const boxTop = top - topT;
  const front = D / 2 - 1.25;
  const body = mat(looks.vanityBox, { roughness: 0.55 });
  g.add(boxAt(W, boxTop - bottom, front + D / 2, body, 0, (bottom + boxTop) / 2, (front - D / 2) / 2));
  if (!floating) g.add(boxAt(W - 1, bottom, front + D / 2 - 3, mat('#cfc8bc'), 0, bottom / 2, (front - 3 - D / 2) / 2));

  // Doors under a false drawer front, with pulls
  const faceMat = mat(looks.vanityBox, { roughness: 0.5 });
  const insetMat = mat(`#${new THREE.Color(looks.vanityBox).offsetHSL(0, 0, -0.04).getHexString()}`, { roughness: 0.55 });
  const doors = W <= 24 ? 1 : W <= 48 ? 2 : W <= 60 ? 3 : 4;
  const drawerH = 6;
  const panel = (x0: number, x1: number, y0: number, y1: number, pullAt: 'center' | 'left' | 'right') => {
    const pw = x1 - x0 - 0.25;
    const ph = y1 - y0 - 0.25;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    g.add(boxAt(pw, ph, 0.75, faceMat, cx, cy, front + 0.375));
    if (pw > 6 && ph > 6) g.add(boxAt(pw - 5, ph - 5, 0.1, insetMat, cx, cy, front + 0.78));
    const px = pullAt === 'center' ? cx : pullAt === 'left' ? x0 + 2 : x1 - 2;
    const vertical = pullAt !== 'center';
    g.add(boxAt(vertical ? 0.5 : 4, vertical ? 4 : 0.5, 0.6, kit.metal, px, vertical ? y1 - 4 : cy, front + 1.1));
  };
  panel(-W / 2, W / 2, boxTop - drawerH - 0.5, boxTop - 0.5, 'center');
  for (let i = 0; i < doors; i++) {
    const x0 = -W / 2 + (W * i) / doors;
    const x1 = -W / 2 + (W * (i + 1)) / doors;
    panel(x0, x1, bottom + 0.5, boxTop - drawerH - 0.75, i % 2 === 0 ? 'right' : 'left');
  }

  // The top with its sinks cut in, the bowls under it, a faucet behind each
  const sinkX = sinks === 2 ? [-W / 4, W / 4] : [0];
  const sinkZ = -D / 2 + 0.36 * D + 0.5;
  const rx = Math.min(8, W / (2 * sinks) - 2.5);
  const rz = Math.min(6, D * 0.25);
  g.add(new THREE.Mesh(
    prism(roundedRect(W + 1, D + 0.75, 0.4, 0, 0.375), boxTop, top, sinkX.map((x) => ellipse(rx, rz, x, sinkZ))),
    mat(looks.vanityTop, { roughness: 0.25 }),
  ));
  for (const x of sinkX) {
    g.add(bowl(rx, 5.5, rz, kit.china, x, top - 0.05, sinkZ));
    g.add(new THREE.Mesh(new THREE.CircleGeometry(0.8, 20).rotateX(-Math.PI / 2).translate(x, top - 5.5, sinkZ), mat(COLORS.drain)));
    faucet(kit, g, x, top, -D / 2 + 2.2);
  }
  if (f.fixture.properties.hasBacksplash) {
    const h = Math.max(3, f.fixture.properties.backsplashHeight ?? 4);
    g.add(boxAt(W + 1, h, 0.75, mat(looks.vanityTop, { roughness: 0.25 }), 0, top + h / 2, -D / 2 + 0.375));
  }
}

const CHAMFER_FROM = 0.6;

function buildBathtub(f: FixtureSolid, kit: FixtureKit, g: THREE.Group) {
  const W = f.widthIn;
  const D = f.depthIn;
  const p = f.fixture.properties;
  const sub = p.bathtubSubType ?? 'standard_alcove';
  const local = (u: number, v: number): Pt => [(u - 0.5) * W, (v - 0.5) * D];
  const floor = mat(kit.looks.prefab, { roughness: 0.22 });

  if (sub === 'freestanding') {
    const rx = (0.8 * W) / 2;
    const rz = (0.9 * D) / 2;
    g.add(new THREE.Mesh(prism(ellipse(rx - 3, rz - 3), 0, 1.5), mat('#d9d5cd')));
    g.add(new THREE.Mesh(prism(ellipse(rx, rz), 1.5, 22, [ellipse(rx - 2.5, rz - 2.5)]), kit.prefab));
    g.add(new THREE.Mesh(prism(ellipse(rx - 2.5, rz - 2.5), 1.5, 4), floor));
    // A floor-mounted filler at the end
    g.add(post(0.8, 34, kit.metal, 0, 0, D / 2 + 2));
    g.add(boxAt(1, 1, 7, kit.metal, 0, 34, D / 2 - 1.5));
    return;
  }

  const deck = sub !== 'standard_alcove';
  const rim = p.deckHeight || (deck ? 20 : 15.5);
  let outline: Pt[];
  let basin: Pt[];
  let spout: Pt;
  if (sub === 'corner_garden' || sub === 'corner_drop_in') {
    outline = [local(0, 0), local(1, 0), local(1, CHAMFER_FROM), local(CHAMFER_FROM, 1), local(0, 1)];
    basin = ellipse(0.34 * W, 0.34 * D, ...local(0.46, 0.46));
    spout = local(0.74, 0.54);
  } else if (deck) {
    outline = [local(0, 0), local(1, 0), local(1, 1), local(0, 1)];
    basin = roundedRect(0.7 * W, 0.8 * D, 6, ...local(0.5, 0.5));
    spout = local(0.5, 0.06);
  } else {
    outline = [local(0, 0), local(1, 0), local(1, 1), local(0, 1)];
    basin = roundedRect(W - 7, D - 6.5, 5, 0, 0.5);
    spout = local(0.5, 0.03);
  }

  if (deck) {
    // A tiled platform (or a plain one) with the tub dropped into it
    const tiled = (p.deckTileSides ?? 0) > 0 || p.hasFrontPanel;
    const deckGeo = prism(outline, 0, rim, [basin]);
    g.add(tiled ? tiledSolid(deckGeo, kit.looks.surroundTile, kit.textures) : new THREE.Mesh(deckGeo, kit.prefab));
    // The tub itself, its lip just proud of the deck
    g.add(new THREE.Mesh(prism(basin, 2, rim + 0.4, [shrink(basin, 1.5)]), kit.prefab));
    g.add(new THREE.Mesh(prism(shrink(basin, 1.5), 1.5, 2.5), floor));
  } else {
    g.add(new THREE.Mesh(prism(outline, 0, rim, [basin]), kit.prefab));
    g.add(new THREE.Mesh(prism(shrink(basin, 0.5), 0, 2.5), floor));
  }
  g.add(boxAt(1.2, 1.2, 4.5, kit.metal, spout[0], rim + 4, spout[1] + 2));
  if (!deck) g.add(plate(3, 0.6, kit.metal, spout[0], rim + 18, -D / 2 + 0.3));

  if (kit.looks.tubShower && sub === 'standard_alcove') {
    // A shower over the tub: head, and a curtain on a rod across the front
    g.add(boxAt(1, 1, 6, kit.metal, spout[0], 79, -D / 2 + 3));
    g.add(plate(3.2, 1, kit.metal, spout[0], 78, -D / 2 + 6.5));
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, W, 16), kit.metal);
    rod.rotation.z = Math.PI / 2;
    rod.position.set(0, GLASS_TOP_IN + 2, D / 2 - 1);
    g.add(rod);
    const curtain = facePanel({ x0: W / 2 - 0.4 * W, x1: W / 2 - 1, y0: rim + 2, y1: GLASS_TOP_IN + 1.5 }, 0, mat(COLORS.curtain, { side: THREE.DoubleSide, roughness: 0.9 }));
    curtain.position.z = D / 2 - 1.5;
    g.add(curtain);
  }
}

/** An outline pulled in toward its centre by `by` inches. */
function shrink(points: Pt[], by: number): Pt[] {
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
  const cz = points.reduce((s, p) => s + p[1], 0) / points.length;
  return points.map(([x, z]) => {
    const dx = x - cx;
    const dz = z - cz;
    const len = Math.hypot(dx, dz) || 1;
    return [x - (dx / len) * by, z - (dz / len) * by] as Pt;
  });
}

function buildShower(f: FixtureSolid, kit: FixtureKit, g: THREE.Group) {
  const W = f.widthIn;
  const D = f.depthIn;
  const p = f.fixture.properties;
  const layout = p.showerLayout ?? 'alcove';
  const local = (u: number, v: number): Pt => [(u - 0.5) * W, (v - 0.5) * D];
  const poly = getShowerUnitPolygon(layout).map((q) => local(q.x, q.y));
  const tileFloor = (p.showerFloorType ?? 'tile') === 'tile';
  const curb = tileFloor ? (p.curbHeight ?? 4) : 0;
  const baseTop = tileFloor ? 0.75 : 3.5;

  if (tileFloor) g.add(tiledSolid(prism(poly, 0, baseTop), kit.looks.showerTile, kit.textures));
  else g.add(new THREE.Mesh(prism(poly, 0, baseTop), kit.prefab));

  // The walls it needs that the room doesn't give it
  const sides: Record<string, [Pt, Pt]> = {
    north: [local(0, 0), local(1, 0)],
    west: [local(0, 0), local(0, 1)],
    east: [local(1, 0), local(1, 1)],
  };
  const wallSides = layout === 'alcove' ? ['north', 'west', 'east']
    : layout === 'corner' || layout === 'neo_angle' ? ['north', 'west'] : ['north', 'east'];
  const height = Math.min(f.ceilingIn, p.showerTileHeight ?? 96);
  for (const s of wallSides) {
    if (f.against?.[s as 'north' | 'west' | 'east']) continue;
    const [a, b] = sides[s];
    const outward: Pt = s === 'north' ? [0, -1.75] : s === 'west' ? [-1.75, 0] : [1.75, 0];
    g.add(panelAlong(a, b, 0, height, 3.5, mat(kit.looks.showerTile.color, { roughness: kit.looks.showerTile.roughness }), outward));
  }

  // Glass: the open sides, with the door in the front, as tall as it's set apart from the tile
  const glassBottom = Math.max(curb, baseTop);
  const glassTop = Math.min(f.ceilingIn, glassBottom + (p.showerDoorHeight ?? SHOWER_DOOR_HEIGHT_IN));
  const doorType = p.showerDoorType ?? 'none';
  let front: [Pt, Pt];
  const fixed: [Pt, Pt][] = [];
  if (layout === 'neo_angle' || layout === 'neo_angle_right') {
    const right = layout === 'neo_angle_right';
    front = right ? [local(0, 0.5), local(0.5, 1)] : [local(1, 0.5), local(0.5, 1)];
    fixed.push(right ? [local(0, 0), local(0, 0.5)] : [local(1, 0), local(1, 0.5)]);
    fixed.push(right ? [local(0.5, 1), local(1, 1)] : [local(0, 1), local(0.5, 1)]);
  } else {
    front = [local(0, 1), local(1, 1)];
    if (layout === 'corner') fixed.push([local(1, 0), local(1, 1)]);
    if (layout === 'corner_right') fixed.push([local(0, 0), local(0, 1)]);
  }
  if (curb > 0) {
    const curbMat = mat(kit.looks.showerTile.color, { roughness: kit.looks.showerTile.roughness });
    for (const [a, b] of [front, ...fixed]) g.add(panelAlong(a, b, 0, curb, 4.5, curbMat));
  }
  for (const [a, b] of fixed) g.add(panelAlong(a, b, glassBottom, glassTop, 0.375, kit.glass));
  if (doorType === 'curtain') {
    const [a, b] = front;
    const rod = panelAlong(a, b, glassTop + 1.5, glassTop + 2.5, 1, kit.metal);
    g.add(rod);
    g.add(panelAlong(a, [a[0] + (b[0] - a[0]) * 0.45, a[1] + (b[1] - a[1]) * 0.45], glassBottom + 2, glassTop + 1.5, 0.2, mat(COLORS.curtain, { roughness: 0.9 })));
  } else if (doorType !== 'none') {
    g.add(panelAlong(front[0], front[1], glassBottom, glassTop, 0.375, kit.glass));
    const framed = doorType === 'sliding' || doorType === 'swing' || doorType === 'bi_fold';
    if (framed) {
      g.add(panelAlong(front[0], front[1], glassTop - 0.5, glassTop + 0.5, 0.9, kit.metal));
      g.add(panelAlong(front[0], front[1], glassBottom, glassBottom + 0.8, 0.9, kit.metal));
    }
    // A handle at the door's free edge
    const t = 0.72;
    const hx = front[0][0] + (front[1][0] - front[0][0]) * t;
    const hz = front[0][1] + (front[1][1] - front[0][1]) * t;
    g.add(post(0.4, 10, kit.metal, hx, 36, hz));
  }

  // Head and valve on the back wall, niches, bench
  const backZ = -D / 2;
  const valveX = layout === 'neo_angle' ? -0.05 * W : layout === 'neo_angle_right' ? 0.05 * W : 0;
  g.add(boxAt(1, 1, 7, kit.metal, 0, 80, backZ + 3.5));
  g.add(plate(3.5, 1, kit.metal, 0, 78.5, backZ + 7));
  g.add(plate(3.5, 0.6, kit.metal, valveX, 48, backZ + 0.3));
  g.add(boxAt(0.6, 0.6, 3, kit.metal, valveX, 48, backZ + 1.8));
  const niches = p.nicheCount ?? 0;
  const nicheMat = mat(COLORS.niche, { roughness: 0.6 });
  for (let i = 0; i < niches; i++) {
    const x = (i - (niches - 1) / 2) * 16;
    g.add(boxAt(12, 24, 0.3, nicheMat, x, 62, backZ + 0.2));
    g.add(boxAt(12, 0.6, 0.6, mat(kit.looks.showerTile.color), x, 62, backZ + 0.5));
  }
  if (p.hasBench) {
    const len = Math.min(p.benchLength ?? 36, p.benchPosition === 'back' ? W : D);
    const depth = p.benchDepth ?? 16;
    const benchMat = mat(kit.looks.showerTile.color, { roughness: kit.looks.showerTile.roughness });
    if (p.benchPosition === 'left') g.add(boxAt(depth, 18, len, benchMat, -W / 2 + depth / 2, 9, backZ + len / 2));
    else if (p.benchPosition === 'right') g.add(boxAt(depth, 18, len, benchMat, W / 2 - depth / 2, 9, backZ + len / 2));
    else g.add(boxAt(len, 18, depth, benchMat, 0, 9, backZ + depth / 2));
  }
}

function buildMirror(f: FixtureSolid, g: THREE.Group) {
  const h = Math.min(f.fixture.properties.mirrorHeight ?? MIRROR_HEIGHT_IN, f.ceilingIn - 2);
  const bottom = Math.max(0, Math.min(MIRROR_BOTTOM_IN, f.ceilingIn - 2 - h));
  g.add(boxAt(f.widthIn, h, 0.75, mat(COLORS.mirror, { metalness: 1, roughness: 0.04 }), 0, bottom + h / 2, 0));
}

function buildLight(f: FixtureSolid, g: THREE.Group) {
  const recessed = f.fixture.properties.lightType === 'recessed' || f.fixture.properties.lightType === 'recessed_multi';
  const r = recessed ? 2.8 : 6;
  const disc = post(r, recessed ? 0.4 : 1.4, mat(COLORS.light, { emissive: COLORS.light, emissiveIntensity: 0.9 }), 0, f.ceilingIn - (recessed ? 0.4 : 1.4), 0, 32);
  g.add(disc);
}

function buildFixture(f: FixtureSolid, kit: FixtureKit): THREE.Group {
  const g = new THREE.Group();
  g.userData.sketchId = f.fixture.id;
  g.position.set(f.center[0], 0, f.center[1]);
  // The plan turns clockwise on screen (y down); about three's y axis that is negative
  g.rotation.y = (-f.rotationDeg * Math.PI) / 180;
  switch (f.fixture.type) {
    case 'toilet': buildToilet(f, kit, g); break;
    case 'vanity': buildVanity(f, kit, g); break;
    case 'bathtub': buildBathtub(f, kit, g); break;
    case 'shower': buildShower(f, kit, g); break;
    case 'mirror': buildMirror(f, g); break;
    case 'light': buildLight(f, g); break;
    default: break;
  }
  return shadowed(g, f.fixture.type !== 'light' && f.fixture.type !== 'shower');
}

// ── The scene ──

export function buildBathroomScene(
  model: BathroomModel,
  textures: TileTextureCache,
  selectedId?: string | null,
): BuiltScene {
  const root = new THREE.Group();
  const { looks } = model;

  if (model.bounds) {
    const { minX, maxX, minZ, maxZ } = model.bounds;
    const size = Math.max(maxX - minX, maxZ - minZ) + 240;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat(COLORS.ground, { roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((minX + maxX) / 2, -0.05, (minZ + maxZ) / 2);
    ground.receiveShadow = true;
    root.add(ground);
  }

  for (const outline of model.floors) {
    let floor: THREE.Mesh;
    const geometry = prism(outline, 0, 0.02);
    if (looks.floor) floor = tiledSolid(geometry, looks.floor, textures);
    else floor = new THREE.Mesh(geometry, mat(looks.floorPlain, { roughness: 0.7 }));
    floor.receiveShadow = true;
    root.add(floor);
  }

  const walls = model.walls.map((w) => buildWall(w, model, textures));
  walls.forEach((w) => root.add(w.group));

  const kit: FixtureKit = {
    looks,
    textures,
    china: mat(looks.china, { roughness: 0.15 }),
    prefab: mat(looks.prefab, { roughness: 0.2 }),
    metal: metalMaterial(looks),
    glass: mat(COLORS.glass, { roughness: 0.04, transparent: true, opacity: 0.25, depthWrite: false }),
  };
  for (const f of model.fixtures) root.add(buildFixture(f, kit));

  if (selectedId) {
    const picked = root.children.find((c) => c.userData.sketchId === selectedId);
    if (picked) {
      const outline = new THREE.BoxHelper(picked, COLORS.selected);
      outline.userData.helper = true;
      root.add(outline);
    }
  }
  return { root, walls };
}

/**
 * Ghost the walls between the camera and their room, so the room can be seen
 * into from outside; from inside the room every wall stands.
 */
export function updateCutaway(built: BuiltScene, camera: THREE.Camera) {
  for (const w of built.walls) {
    if (!w.inward) continue;
    const toCamera = camera.position.clone().sub(w.mid);
    toCamera.y = 0;
    const ghost = toCamera.dot(w.inward) < 0;
    if (ghost === w.ghosted) continue;
    w.ghosted = ghost;
    for (const m of w.materials) {
      m.userData.baseOpacity ??= m.opacity;
      m.userData.baseTransparent ??= m.transparent;
      m.userData.baseDepthWrite ??= m.depthWrite;
      m.transparent = ghost || m.userData.baseTransparent;
      m.opacity = ghost ? Math.min(m.userData.baseOpacity, 0.1) : m.userData.baseOpacity;
      m.depthWrite = ghost ? false : m.userData.baseDepthWrite;
      m.needsUpdate = true;
    }
    w.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = !ghost;
    });
  }
}

/** Free the geometries and materials under `root`; tile textures stay in their cache. */
export function disposeScene(root: THREE.Object3D) {
  root.traverse((obj) => {
    const item = obj as THREE.Mesh;
    item.geometry?.dispose();
    const material = item.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  });
}

/** The sketch wall or fixture a picked object belongs to, if any. */
export function sketchIdOf(obj: THREE.Object3D | null): string | null {
  for (let o = obj; o; o = o.parent) {
    if (o.userData.sketchId) return o.userData.sketchId as string;
  }
  return null;
}
