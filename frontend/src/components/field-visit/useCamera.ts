/**
 * The phone's back camera in the page rather than its own camera app, so a video
 * can run while photos are taken from it and the guides stay on screen. Falls back
 * to the system camera (see FieldCamera) when it's refused or there isn't one.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { isIOS } from './locate';

/**
 * denied: the camera was refused for this site, which asking again may fix.
 * busy: another app has it. unavailable: none this page can use, so the phone's camera app it is.
 */
export type CameraStatus = 'starting' | 'ready' | 'denied' | 'busy' | 'unavailable';

export interface Taken {
  blob: Blob;
  thumb?: Blob;
  contentType: string;
  name: string;
}

const THUMB_SIZE = 320;
const PHOTO_QUALITY = 0.85;
const THUMB_QUALITY = 0.7;
const PHOTO_TIMEOUT_MS = 2500;

// The camera runs at one size, and a photo taken during a video is a frame of it, so this
// is a trade between photo detail and what phones can encode and send. About 2.8MP.
const FRAME_LONG_SIDE = 1920;
const FRAME_SHORT_SIDE = 1440;
// About 19MB a minute: what someone on a slow line can watch without it stopping to load
const VIDEO_BITRATE = 2_500_000;
/** A clip is cut and saved at this length, which is also all a room records by itself */
export const MAX_CLIP_SECONDS = 60;
/** The recorder writes a piece of the file this often, and until the server has reindexed a
 *  clip Chrome asks storage for every piece before it will start: about a second each */
const CLIP_PIECE_MS = 10_000;
/** Shorter than this is walking into a room and straight out again */
const MIN_CLIP_MS = 2000;

const ask = {
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: FRAME_LONG_SIDE },
    height: { ideal: FRAME_SHORT_SIDE },
  },
  audio: false,
};

const toBlob = (canvas: HTMLCanvasElement, quality: number) => new Promise<Blob | null>((resolve) => {
  canvas.toBlob(resolve, 'image/jpeg', quality);
});

const frameCanvas = (video: HTMLVideoElement, longest?: number) => {
  const width = video.videoWidth;
  const height = video.videoHeight;
  const scale = longest ? Math.min(1, longest / Math.max(width, height)) : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
};

const shrink = async (file: Blob, longest: number, quality: number): Promise<Blob | null> => {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await toBlob(canvas, quality);
  } catch {
    return null;
  }
};

/** The camera's own photo where the browser offers it, with its processing. Storage keeps
 *  nothing larger than a frame, so it's cut to that here rather than sent whole to be shrunk */
const takePhoto = async (track: MediaStreamTrack): Promise<Blob | null> => {
  const ImageCaptureClass = (window as any).ImageCapture;
  if (!ImageCaptureClass) return null;
  try {
    const timeout = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), PHOTO_TIMEOUT_MS);
    });
    const photo = await Promise.race([new ImageCaptureClass(track).takePhoto() as Promise<Blob>, timeout]);
    return photo && ((await shrink(photo, FRAME_LONG_SIDE, PHOTO_QUALITY)) ?? photo);
  } catch {
    return null;
  }
};

// H.264 first: the server has to re-encode anything else, which on Render takes several
// times a clip's length, and these clips never stop coming
const videoType = (): string => {
  const types = [
    'video/mp4;codecs=avc1.640028',
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=h264',
    'video/webm;codecs=vp9',
    'video/webm',
  ];
  return types.find(type => (window as any).MediaRecorder?.isTypeSupported?.(type)) ?? '';
};

const stampName = (extension: string) => `field-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;

export const useCamera = (videoRef: React.RefObject<HTMLVideoElement>) => {
  const [status, setStatus] = useState<CameraStatus>('starting');
  const [ratio, setRatio] = useState(3 / 4);
  const [canWiden, setCanWiden] = useState(false);
  const [wide, setWideState] = useState(false);
  const [canTorch, setCanTorch] = useState(false);
  const [torch, setTorchState] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [mic, setMicState] = useState(false);
  // Changes whenever a new stream comes up: a recording of the old one has ended with it
  const [streamKey, setStreamKey] = useState(0);

  const stream = useRef<MediaStream | null>(null);
  const audio = useRef<MediaStream | null>(null);
  const micWanted = useRef(false);
  const wideDevice = useRef<string | null>(null);
  const zoomRange = useRef<{ min: number; normal: number } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const starting = useRef(false);
  const clipSeconds = useRef(0);
  const stopped = useRef(false);

  const track = () => stream.current?.getVideoTracks()[0];
  const isRecording = () => recorder.current?.state === 'recording';

  const stopStream = () => {
    stream.current?.getTracks().forEach(t => t.stop());
    stream.current = null;
  };

  const open = useCallback(async (deviceId?: string) => {
    stopStream();
    const constraints = deviceId
      ? { audio: false, video: { deviceId: { exact: deviceId }, width: ask.video.width, height: ask.video.height } }
      : ask;
    const next = await navigator.mediaDevices.getUserMedia(constraints);
    if (stopped.current) {
      next.getTracks().forEach(t => t.stop());
      return;
    }
    stream.current = next;
    const element = videoRef.current;
    if (element) {
      element.srcObject = next;
      await element.play().catch(() => undefined);
    }
    setStatus('ready');
    setStreamKey(key => key + 1);
    const capabilities: any = next.getVideoTracks()[0]?.getCapabilities?.() ?? {};
    setCanTorch(!!capabilities.torch);
    setTorchState(false);
    zoomRange.current = capabilities.zoom?.min < 1 ? { min: capabilities.zoom.min, normal: 1 } : null;
  }, [videoRef]);

  /** A lens that shows more of the room: a zoom below 1 where there is one, or the ultra wide camera */
  const findWide = useCallback(async () => {
    if (zoomRange.current) {
      setCanWiden(true);
      return;
    }
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
    const found = devices.find(d => d.kind === 'videoinput' && /ultra.?wide/i.test(d.label) && !/front/i.test(d.label));
    wideDevice.current = found?.deviceId ?? null;
    setCanWiden(!!found);
  }, []);

  const setWide = useCallback(async (on: boolean) => {
    const current = track();
    if (!current) return;
    try {
      if (zoomRange.current) {
        const { min, normal } = zoomRange.current;
        await current.applyConstraints({ advanced: [{ zoom: on ? min : normal } as any] });
      } else if (wideDevice.current) {
        // Another camera is a new stream, which ends the clip running on this one
        await open(on ? wideDevice.current : undefined);
      } else {
        return;
      }
      setWideState(on);
    } catch (err) {
      console.warn('[field-visit] Could not change lens:', err);
    }
  }, [open]);

  const setTorch = useCallback(async (on: boolean) => {
    try {
      await track()?.applyConstraints({ advanced: [{ torch: on } as any] });
      setTorchState(on);
    } catch (err) {
      console.warn('[field-visit] Could not change the light:', err);
    }
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('unavailable');
      return;
    }
    try {
      await open();
      await findWide();
    } catch (err) {
      console.warn('[field-visit] No camera:', err);
      const name = (err as DOMException)?.name;
      if (name === 'NotAllowedError') setStatus('denied');
      else if (name === 'NotReadableError' || name === 'AbortError') setStatus('busy');
      else setStatus('unavailable');
    }
  }, [findWide, open]);

  /** Ask for the camera again. Coming back to the page asks by itself too (see below). */
  const retry = useCallback(() => {
    setStatus('starting');
    start();
  }, [start]);

  // Allowed from the browser's own controls while this stays open (a computer's address bar)
  useEffect(() => {
    if (status !== 'denied' || !navigator.permissions?.query) return undefined;
    let watched: PermissionStatus | null = null;
    const onChange = () => {
      if (watched?.state === 'granted') retry();
    };
    navigator.permissions.query({ name: 'camera' as PermissionName })
      .then((permission) => {
        watched = permission;
        permission.addEventListener('change', onChange);
      })
      .catch(() => undefined); // Not a name every browser knows
    return () => watched?.removeEventListener('change', onChange);
  }, [status, retry]);

  const stopRecording = useCallback(() => {
    if (isRecording()) recorder.current?.stop();
  }, []);

  useEffect(() => {
    stopped.current = false;
    start();
    return () => {
      stopped.current = true;
      stopRecording();
      stopStream();
      audio.current?.getTracks().forEach(t => t.stop());
      audio.current = null;
    };
  }, [start, stopRecording]);

  // The phone takes the camera back when the page goes to the background
  useEffect(() => {
    const onChange = () => {
      if (stopped.current) return;
      if (document.visibilityState === 'hidden') {
        // Save what there is while it can still be saved
        stopRecording();
      } else if (track()?.readyState !== 'live') {
        start();
      } else {
        videoRef.current?.play().catch(() => undefined);
      }
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, [start, stopRecording, videoRef]);

  const capture = useCallback(async (): Promise<Taken | null> => {
    const element = videoRef.current;
    const current = track();
    if (!element || !current || !element.videoWidth) return null;

    // Drawn before anything else, so the picture is what the shutter was pressed on
    const whole = frameCanvas(element);
    const thumb = (await toBlob(frameCanvas(element, THUMB_SIZE), THUMB_QUALITY)) ?? undefined;
    // A full photo can stop the stream to refocus and glitch a video running on it
    const full = isRecording() ? null : await takePhoto(current);
    const blob = full ?? (await toBlob(whole, PHOTO_QUALITY));
    if (!blob) return null;
    return { blob, thumb, contentType: 'image/jpeg', name: stampName('jpg') };
  }, [videoRef]);

  const canRecord = useCallback(() => !!(window as any).MediaRecorder && !!videoType(), []);

  /** Records until stopped or the clip's cut off; hands over the clip when it ends */
  const startRecording = useCallback(async (onDone: (taken: Taken) => void) => {
    const element = videoRef.current;
    const current = stream.current;
    if (!element || !current?.active || isRecording() || starting.current) return;
    starting.current = true;
    try {
      if (micWanted.current && !audio.current) {
        audio.current = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
        if (!audio.current) {
          micWanted.current = false;
          setMicState(false);
        }
      }
      const tracks = [
        ...current.getVideoTracks(),
        ...(micWanted.current ? audio.current?.getAudioTracks() ?? [] : []),
      ];
      const mimeType = videoType();
      const thumb = (await toBlob(frameCanvas(element, THUMB_SIZE), THUMB_QUALITY)) ?? undefined;
      const startedAt = Date.now();

      const chunks: Blob[] = [];
      const clip = new MediaRecorder(new MediaStream(tracks), { mimeType, videoBitsPerSecond: VIDEO_BITRATE });
      clip.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      clip.onstop = () => {
        recorder.current = null;
        setRecording(false);
        if (!chunks.length || Date.now() - startedAt < MIN_CLIP_MS) return;
        const contentType = mimeType.split(';')[0];
        onDone({
          blob: new Blob(chunks, { type: contentType }),
          thumb,
          contentType,
          name: stampName(contentType === 'video/mp4' ? 'mp4' : 'webm'),
        });
      };
      recorder.current = clip;
      clip.start(CLIP_PIECE_MS);
      clipSeconds.current = 0;
      setRecording(true);
    } catch (err) {
      console.warn('[field-visit] Could not start recording:', err);
      recorder.current = null;
    } finally {
      starting.current = false;
    }
  }, [videoRef]);

  /** Sound is off until asked for: it would otherwise pick up everyone talking in the house */
  const setMic = useCallback((on: boolean) => {
    micWanted.current = on;
    setMicState(on);
    if (!on) {
      audio.current?.getTracks().forEach(t => t.stop());
      audio.current = null;
    }
    // A recorder's tracks are fixed when it starts, so the next clip has the change
    stopRecording();
  }, [stopRecording]);

  const resetClock = useCallback(() => setSeconds(0), []);

  useEffect(() => {
    if (!recording) return undefined;
    const timer = setInterval(() => {
      setSeconds(value => value + 1);
      clipSeconds.current += 1;
      if (clipSeconds.current >= MAX_CLIP_SECONDS) stopRecording();
    }, 1000);
    return () => clearInterval(timer);
  }, [recording, stopRecording]);

  return {
    status,
    retry,
    ratio,
    onMetadata: () => {
      const element = videoRef.current;
      if (element?.videoWidth) setRatio(element.videoWidth / element.videoHeight);
    },
    capture,
    canRecord,
    startRecording,
    stopRecording,
    recording,
    seconds,
    resetClock,
    streamKey,
    mic,
    setMic,
    canWiden,
    wide,
    setWide,
    canTorch,
    torch,
    setTorch,
  };
};

/** Where the camera setting is, for when asking again hasn't brought the browser's question back */
export const cameraSettingsPath = () => {
  const agent = navigator.userAgent;
  if (isIOS()) {
    // Settings moved under Apps in iOS 18
    const version = Number(agent.match(/OS (\d+)_/)?.[1] ?? 0);
    const apps = !version || version >= 18 ? 'Apps → ' : '';
    if (/CriOS/.test(agent)) return `iPhone Settings → ${apps}Chrome → Camera`;
    return `Safari: the page menu by the web address (aA) → Website Settings → Camera → Allow. Or iPhone Settings → ${apps}Safari → Camera.`;
  }
  if (/Android/.test(agent)) return 'Tap the icon left of the web address → Permissions → Camera → Allow.';
  return 'Click the icon left of the web address → Camera → Allow.';
};

/** A small picture for a file from the system camera, which has to be decoded first */
export const thumbFromFile = async (file: Blob): Promise<Blob | undefined> => (
  (await shrink(file, THUMB_SIZE, THUMB_QUALITY)) ?? undefined
);
