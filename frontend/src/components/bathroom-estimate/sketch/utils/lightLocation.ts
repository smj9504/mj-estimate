/**
 * Where a light is in the bathroom, so lights of one kind in different
 * places are lines of their own on the estimate: the can in the shower apart
 * from the cans over the vanity, the pendant over the tub apart from the one
 * over the toilet.
 *
 * As typed on the light, else what it's over on the plan (the shower, the
 * tub, the vanity, the toilet) or the room of its own it's in (a toilet room,
 * a closet). Null when it's nowhere in particular: a plain line, as before.
 * A vanity bar over a vanity says nothing more (that's what it is).
 */

import type { BEFixture, BEPoint, BERoom } from '../../../../types/bathroomSketch';
import { pointInPolygon } from './beRoomDetect';

/** The places offered when a light's place is typed */
export const LIGHT_LOCATIONS = ['In the shower', 'Over the tub', 'Over the vanity', 'By the vanity', 'Over the toilet', 'Hallway', 'Closet'];

/** Whether a plan point is over a fixture's footprint, give or take `marginIn` inches */
function over(p: BEPoint, f: BEFixture, ppf: number, marginIn: number): boolean {
  const rad = ((f.rotation || 0) * Math.PI) / 180;
  const dx = p.x - f.position.x;
  const dy = p.y - f.position.y;
  const lx = dx * Math.cos(rad) + dy * Math.sin(rad);
  const ly = -dx * Math.sin(rad) + dy * Math.cos(rad);
  const m = (marginIn / 12) * ppf;
  return Math.abs(lx) <= ((f.dimensions.width / 12) * ppf) / 2 + m
    && Math.abs(ly) <= ((f.dimensions.height / 12) * ppf) / 2 + m;
}

const isWallLight = (lightType?: string) => lightType === 'vanity_bar' || lightType === 'sconce';

/** Where a light is found to be on the plan, whatever's typed on it */
export function foundLightLocation(light: BEFixture, fixtures: BEFixture[], rooms: BERoom[], ppf: number): string | null {
  const p = light.position;
  const type = light.properties.lightType;
  const onWall = isWallLight(type);
  const overAny = (kind: BEFixture['type'], marginIn: number) =>
    fixtures.some((f) => f.id !== light.id && f.type === kind && over(p, f, ppf, marginIn));
  if (overAny('shower', 0)) return 'In the shower';
  if (overAny('bathtub', onWall ? 6 : 0)) return 'Over the tub';
  if (overAny('vanity', onWall ? 12 : 6)) {
    if (type === 'vanity_bar') return null;
    return type === 'sconce' ? 'By the vanity' : 'Over the vanity';
  }
  if (overAny('toilet', onWall ? 12 : 6)) return 'Over the toilet';
  // A room of its own: a room off the bathroom, or one cut out of it
  const own = rooms.find((r) => r.boundary.length >= 3 && r.roomType !== 'bathroom' && pointInPolygon(p, r.boundary));
  return own ? own.name : null;
}

/** Where a light is: as typed on it, else as found on the plan */
export function lightLocation(light: BEFixture, fixtures: BEFixture[], rooms: BERoom[], ppf: number): string | null {
  const typed = light.properties.lightLocation?.trim();
  return typed || foundLightLocation(light, fixtures, rooms, ppf);
}
