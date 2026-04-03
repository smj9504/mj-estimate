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

export interface WMBackgroundImageLayerProps {
  imageUrl: string | null;
  canvasWidth: number;
  canvasHeight: number;
  /** Opacity of the background image (default: 0.9) */
  opacity?: number;
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
}) => {
  const [fitted, setFitted] = useState<FittedImage | null>(null);

  useEffect(() => {
    if (!imageUrl) {
      setFitted(null);
      return;
    }

    let cancelled = false;
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      const dims = fitContain(img.naturalWidth, img.naturalHeight, canvasWidth, canvasHeight);
      setFitted({ image: img, ...dims });
    };
    img.onerror = () => {
      if (!cancelled) setFitted(null);
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
