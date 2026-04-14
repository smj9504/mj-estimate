/**
 * WMBackgroundImageLayer
 * Loads and renders a background floor plan image on a Konva Layer,
 * fitting the image to the canvas with contain-mode aspect ratio scaling.
 *
 * Usage:
 *   <Layer>
 *     <WMBackgroundImageLayer
 *       imageUrl={floorSketch.backgroundImageUrl}
 *       canvasWidth={1200}
 *       canvasHeight={900}
 *       opacity={0.9}
 *     />
 *   </Layer>
 */

import React, { useState, useEffect } from 'react';
import { Image as KonvaImage } from 'react-konva';

export type ImageLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface WMBackgroundImageLayerProps {
  imageUrl: string | null;
  canvasWidth: number;
  canvasHeight: number;
  /** Opacity of the background image (default: 0.9) */
  opacity?: number;
  /** Called when load status changes */
  onStatusChange?: (status: ImageLoadStatus) => void;
}

interface FittedImage {
  image: HTMLImageElement;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Compute contain-fit dimensions and centered position */
function fitContain(
  imgW: number,
  imgH: number,
  canvasW: number,
  canvasH: number,
): { x: number; y: number; width: number; height: number } {
  const scaleX = canvasW / imgW;
  const scaleY = canvasH / imgH;
  const scale = Math.min(scaleX, scaleY);
  const width = imgW * scale;
  const height = imgH * scale;
  return {
    x: (canvasW - width) / 2,
    y: (canvasH - height) / 2,
    width,
    height,
  };
}

const WMBackgroundImageLayer: React.FC<WMBackgroundImageLayerProps> = ({
  imageUrl,
  canvasWidth,
  canvasHeight,
  opacity = 0.9,
  onStatusChange,
}) => {
  const [fitted, setFitted] = useState<FittedImage | null>(null);
  const onStatusRef = React.useRef(onStatusChange);
  onStatusRef.current = onStatusChange;

  useEffect(() => {
    if (!imageUrl) {
      setFitted(null);
      onStatusRef.current?.('idle');
      return;
    }

    onStatusRef.current?.('loading');

    let cancelled = false;
    const img = new window.Image();
    // Try with crossOrigin first (enables canvas export if CORS headers
    // are present). If that fails (e.g. missing CORS headers in
    // production), retry without crossOrigin so the image still renders.
    img.crossOrigin = 'anonymous';

    const onLoad = (loadedImg: HTMLImageElement) => {
      if (cancelled) return;
      const dims = fitContain(loadedImg.naturalWidth, loadedImg.naturalHeight, canvasWidth, canvasHeight);
      setFitted({ image: loadedImg, ...dims });
      onStatusRef.current?.('loaded');
    };

    img.onload = () => onLoad(img);
    img.onerror = () => {
      if (cancelled) return;
      // Retry without crossOrigin – image will render but canvas
      // becomes "tainted" (no export). This is acceptable since the
      // sketch canvas is not exported on the frontend.
      const img2 = new window.Image();
      img2.onload = () => onLoad(img2);
      img2.onerror = () => {
        if (cancelled) return;
        console.error('[WMBackgroundImageLayer] Failed to load image:', imageUrl);
        setFitted(null);
        onStatusRef.current?.('error');
      };
      img2.src = imageUrl;
    };
    img.src = imageUrl;

    return () => {
      cancelled = true;
    };
  }, [imageUrl, canvasWidth, canvasHeight]);

  if (!fitted) return null;

  return (
    <KonvaImage
      image={fitted.image}
      x={fitted.x}
      y={fitted.y}
      width={fitted.width}
      height={fitted.height}
      opacity={opacity}
      listening={false}
    />
  );
};

export default React.memo(WMBackgroundImageLayer);
