/**
 * The phone's position for a new client. The first fix is often a coarse one from
 * Wi-Fi, so this gives GPS a few seconds to do better before settling for the best
 * it has.
 */

export interface LocatedFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
}

const GOOD_ENOUGH_M = 25;
const SETTLE_MS = 8000;
const GIVE_UP_MS = 20000;

export const locate = () => new Promise<LocatedFix>((resolve, reject) => {
  if (!navigator.geolocation) {
    reject(new Error('unavailable'));
    return;
  }

  let best: LocatedFix | null = null;
  let finished = false;
  let watchId = 0;

  const finish = (error?: Error) => {
    if (finished) return;
    finished = true;
    navigator.geolocation.clearWatch(watchId);
    clearTimeout(settle);
    clearTimeout(giveUp);
    if (best) resolve(best);
    else reject(error ?? new Error('timeout'));
  };

  const settle = setTimeout(() => {
    if (best) finish();
  }, SETTLE_MS);
  const giveUp = setTimeout(() => finish(), GIVE_UP_MS);

  watchId = navigator.geolocation.watchPosition(
    ({ coords }) => {
      if (!best || coords.accuracy < best.accuracy) {
        best = {
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy,
          altitude: coords.altitude,
          altitudeAccuracy: coords.altitudeAccuracy,
        };
      }
      if (coords.accuracy <= GOOD_ENOUGH_M) finish();
    },
    (error) => {
      // Denied is final; anything else may still get a fix before giving up
      if (error.code === error.PERMISSION_DENIED) finish(new Error('denied'));
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: GIVE_UP_MS },
  );
});
