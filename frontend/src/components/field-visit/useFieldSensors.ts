/**
 * The phone's direction, walking and position while the camera is open.
 *
 * Direction and motion need a tap to ask on an iPhone, and nothing works without
 * them being optional: each just leaves its hint out.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { StepCounter, cameraDirection, floorFromAltitude } from './sensors';
import type { AltitudeSample, FloorAnchor } from './sensors';
import type { FloorKey, ShotReadings } from '../../types/fieldVisit';

let asked = false;

/** Call straight from a tap. iOS only allows asking from one, and only needs asking once per page load. */
export const askForMotionAccess = () => {
  if (asked) return;
  asked = true;
  // One permission covers both on an iPhone, so one ask is all the tap has to carry
  const sensor = [(window as any).DeviceOrientationEvent, (window as any).DeviceMotionEvent]
    .find(event => event?.requestPermission);
  sensor?.requestPermission().catch(() => undefined);
};

const SAMPLES_KEPT = 30;
const REDRAW_MS = 120;

export interface FieldFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
}

export const useFieldSensors = () => {
  const [heading, setHeading] = useState<number | null>(null);
  const [pitch, setPitch] = useState<number | null>(null);
  const [steps, setSteps] = useState(0);
  const [fixTick, setFixTick] = useState(0);

  const headingRef = useRef<number | null>(null);
  const pitchRef = useRef<number | null>(null);
  const counter = useRef(new StepCounter());
  const fix = useRef<FieldFix | null>(null);
  const samples = useRef<AltitudeSample[]>([]);

  useEffect(() => {
    let lastDraw = 0;
    const onOrientation = (event: DeviceOrientationEvent) => {
      if (event.alpha == null || event.beta == null || event.gamma == null) return;
      const direction = cameraDirection(event.alpha, event.beta, event.gamma);
      headingRef.current = direction.heading;
      pitchRef.current = direction.pitch;
      const now = performance.now();
      if (now - lastDraw < REDRAW_MS) return;
      lastDraw = now;
      setHeading(direction.heading);
      setPitch(direction.pitch);
    };
    const onMotion = (event: DeviceMotionEvent) => {
      const a = event.accelerationIncludingGravity;
      if (a?.x == null || a.y == null || a.z == null) return;
      const before = counter.current.count;
      counter.current.push(a.x, a.y, a.z, performance.now());
      if (counter.current.count !== before) setSteps(counter.current.count);
    };
    window.addEventListener('deviceorientation', onOrientation);
    window.addEventListener('devicemotion', onMotion);

    let watchId: number | undefined;
    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        ({ coords }) => {
          fix.current = {
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy: coords.accuracy,
            altitude: coords.altitude,
            altitudeAccuracy: coords.altitudeAccuracy,
          };
          if (coords.altitude != null) {
            samples.current = [
              ...samples.current.slice(-(SAMPLES_KEPT - 1)),
              { altitude: coords.altitude, accuracy: coords.altitudeAccuracy, timeMs: Date.now() },
            ];
            setFixTick(tick => tick + 1);
          }
        },
        () => undefined, // Off or no signal indoors: shots just carry no position
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
      );
    }

    return () => {
      window.removeEventListener('deviceorientation', onOrientation);
      window.removeEventListener('devicemotion', onMotion);
      if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  const readings = useCallback((): ShotReadings => ({
    latitude: fix.current?.latitude,
    longitude: fix.current?.longitude,
    gps_accuracy: fix.current?.accuracy,
    altitude: fix.current?.altitude,
    altitude_accuracy: fix.current?.altitudeAccuracy,
    heading: headingRef.current,
    pitch: pitchRef.current,
    steps: counter.current.count,
  }), []);

  const resetSteps = useCallback(() => {
    counter.current.reset();
    setSteps(0);
  }, []);

  const floorNow = useCallback(
    (anchor: FloorAnchor | null): FloorKey | null => floorFromAltitude(samples.current, anchor, Date.now()),
    [],
  );

  const altitudeNow = useCallback(() => fix.current?.altitude ?? null, []);

  return {
    heading,
    pitch,
    steps,
    /** Changes as altitude readings come in */
    fixTick,
    headingNow: () => headingRef.current,
    readings,
    resetSteps,
    floorNow,
    altitudeNow,
  };
};
