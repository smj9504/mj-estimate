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

// iPads call themselves Macs
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

/** Chrome 144+. A page's own request stays refused once blocked; tapping this brings the browser's dialog back. */
export const hasLocationButton = () => 'HTMLGeolocationElement' in window;

/**
 * The links into settings a page can use. Android's location screen is marked
 * browsable, so Chrome will open it; iOS answers these with "Invalid URL" since 15.4.
 */
export const settingsLink = () => {
  if (/Android/.test(navigator.userAgent)) return 'intent:#Intent;action=android.settings.LOCATION_SOURCE_SETTINGS;end';
  if (/Windows/.test(navigator.userAgent)) return 'ms-settings:privacy-location';
  return null;
};

/** Where the setting is, for when asking again hasn't helped and there's no link to it */
export const settingsPath = () => {
  if (isIOS()) {
    // iOS can stay refused in an app installed to the home screen while Safari works
    if (window.matchMedia('(display-mode: standalone)').matches) return 'Open this site in Safari.';
    const browser = /CriOS/.test(navigator.userAgent) ? 'Chrome' : 'Safari Websites';
    return `Settings → Privacy & Security → Location Services → ${browser}`;
  }
  if (/Android/.test(navigator.userAgent)) {
    return hasLocationButton()
      ? 'Phone settings → Location'
      : 'Phone settings → Location, then the icon left of the web address → Permissions';
  }
  return settingsLink() ? null : "Turn on location in this computer's settings.";
};

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
