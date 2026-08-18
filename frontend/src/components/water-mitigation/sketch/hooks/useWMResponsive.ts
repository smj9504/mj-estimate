/**
 * useWMResponsive
 *
 * Shared responsive / input-capability helpers for the WM sketch editor.
 *
 * Two independent axes matter here and must not be conflated:
 *   - viewport width  → decides layout (inline sidebar vs. bottom Drawer)
 *   - pointer type    → decides hit-target sizing and which gestures are wired
 *
 * A touch laptop is wide but coarse; an iPad in landscape is wide and coarse;
 * a phone is narrow and coarse. Each consumer picks the axis it cares about.
 */

import { useEffect, useState } from 'react';
import { Grid } from 'antd';

const { useBreakpoint } = Grid;

/** Mobile-phone-ish viewport (antd `md` = 768px). */
export const WM_MOBILE_BREAKPOINT = 768;
/** Tablet-ish viewport (antd `lg` = 992px). */
export const WM_TABLET_BREAKPOINT = 992;

/**
 * Subscribe to a media query and re-render on change.
 * Returns false during SSR / in environments without matchMedia.
 */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    // Safari < 14 only supports the deprecated addListener API
    if (mql.addEventListener) {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, [query]);

  return matches;
}

/**
 * True when the primary pointer is coarse (finger / stylus) — i.e. the user
 * cannot hover and needs larger hit targets. Also true when the device
 * reports touch points but no fine pointer, which covers Android WebViews
 * that misreport `pointer:`.
 */
export function useIsCoarsePointer(): boolean {
  const coarse = useMediaQuery('(pointer: coarse)');
  const noHover = useMediaQuery('(hover: none)');
  return coarse || noHover;
}

export interface WMResponsive {
  /** Viewport narrower than `md` — use Drawer layout, hide secondary chrome. */
  isMobile: boolean;
  /** Viewport narrower than `lg` — usable but cramped (tablets). */
  isTablet: boolean;
  /** Primary pointer is a finger/stylus — enlarge hit targets, wire gestures. */
  isTouch: boolean;
  /**
   * Touch input on any viewport size. Gesture handlers key off this so an
   * iPad in landscape still gets pinch-zoom and long-press.
   */
  useTouchUI: boolean;
}

export function useWMResponsive(): WMResponsive {
  const screens = useBreakpoint();
  const isTouch = useIsCoarsePointer();
  // `screens` starts out empty on first paint; treat "md unknown" as desktop
  // so the heavier Drawer layout never flashes on a desktop first render.
  const isMobile = screens.md === false;
  const isTablet = screens.lg === false;

  return { isMobile, isTablet, isTouch, useTouchUI: isTouch || isMobile };
}

/**
 * Konva hit-target sizing that adapts to the pointer type.
 * Finger targets follow the ~44px guidance, scaled down to canvas units.
 */
export function useTouchTargetSizes() {
  const isTouch = useIsCoarsePointer();
  return {
    isTouch,
    /** Transformer corner/edge anchor size. */
    anchorSize: isTouch ? 16 : 8,
    /** Distance of the rotate handle from the bounding box. */
    rotateAnchorOffset: isTouch ? 32 : 20,
    /** Invisible stroke padding that makes thin lines tappable. */
    hitStrokeWidth: isTouch ? 28 : 12,
    /** Radius of draggable vertex/endpoint handles. */
    handleRadius: isTouch ? 10 : 5,
  };
}

export default useWMResponsive;
