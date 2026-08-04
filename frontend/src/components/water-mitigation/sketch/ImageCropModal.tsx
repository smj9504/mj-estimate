/**
 * ImageCropModal
 *
 * Modal dialog that lets the user crop an image before it is used as a
 * background floor-plan in the WM sketch editor.
 *
 * Uses react-easy-crop for the interactive crop area.
 * The cropped result is returned as a File (via canvas toBlob).
 */

import React, { useState, useCallback } from 'react';
import { Modal, Slider, Space, Typography, Button, Radio } from 'antd';
import {
  ZoomInOutlined,
  ZoomOutOutlined,
  RotateLeftOutlined,
  RotateRightOutlined,
} from '@ant-design/icons';

type Point = { x: number; y: number };
type Area = { x: number; y: number; width: number; height: number };

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Cropper = require('react-easy-crop').default as React.ComponentType<{
  image?: string;
  crop: Point;
  zoom: number;
  rotation?: number;
  aspect?: number;
  onCropChange: (crop: Point) => void;
  onZoomChange?: (zoom: number) => void;
  onRotationChange?: (rotation: number) => void;
  onCropComplete?: (croppedArea: Area, croppedAreaPixels: Area) => void;
  showGrid?: boolean;
}>;

const { Text } = Typography;

// ============================================================================
// Types
// ============================================================================

export interface ImageCropModalProps {
  /** Whether the modal is visible */
  open: boolean;
  /** Source image URL (object URL or remote URL) */
  imageUrl: string | null;
  /** Called with the cropped File when the user confirms */
  onConfirm: (croppedFile: File) => void;
  /** Called when the user skips cropping (upload original as-is) */
  onSkip: () => void;
  /** Called when the user cancels entirely (no upload) */
  onCancel: () => void;
  /** Original file name (used as the cropped file's name) */
  fileName?: string;
  /** Whether to show the "Skip Crop" button (default: true) */
  showSkip?: boolean;
}

type AspectOption = 'free' | '4:3' | '16:9' | '1:1';

const ASPECT_OPTIONS: { label: string; value: AspectOption; ratio?: number }[] = [
  { label: 'Free', value: 'free' },
  { label: '4:3', value: '4:3', ratio: 4 / 3 },
  { label: '16:9', value: '16:9', ratio: 16 / 9 },
  { label: '1:1', value: '1:1', ratio: 1 },
];

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a canvas element from an image URL and return it.
 */
function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener('load', () => resolve(img));
    img.addEventListener('error', (err) => reject(err));
    // Only set crossOrigin for remote URLs — blob: and data: URLs are
    // same-origin and setting crossOrigin on them can cause load failures.
    if (!url.startsWith('blob:') && !url.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }
    img.src = url;
  });
}

/**
 * Crop the image using canvas and return a Blob.
 */
async function getCroppedImg(
  imageSrc: string,
  pixelCrop: Area,
  rotation: number = 0,
  mimeType: string = 'image/png',
): Promise<Blob> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  const radians = (rotation * Math.PI) / 180;

  // Calculate bounding box of the rotated image
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  const rotatedWidth = image.naturalWidth * cos + image.naturalHeight * sin;
  const rotatedHeight = image.naturalWidth * sin + image.naturalHeight * cos;

  // Set canvas to the size of the crop area
  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;

  // Translate canvas context so that the crop area maps correctly
  ctx.translate(-pixelCrop.x, -pixelCrop.y);
  ctx.translate(rotatedWidth / 2, rotatedHeight / 2);
  ctx.rotate(radians);
  ctx.translate(-image.naturalWidth / 2, -image.naturalHeight / 2);

  ctx.drawImage(image, 0, 0);

  // Use PNG to preserve transparency, JPEG for photos
  const outputType = mimeType.startsWith('image/') ? mimeType : 'image/png';
  const quality = outputType === 'image/jpeg' ? 0.92 : undefined;

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas toBlob returned null'));
      },
      outputType,
      quality,
    );
  });
}

// ============================================================================
// Component
// ============================================================================

const ImageCropModal: React.FC<ImageCropModalProps> = ({
  open,
  imageUrl,
  onConfirm,
  onSkip,
  onCancel,
  fileName = 'cropped-image.jpg',
  showSkip = true,
}) => {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [aspect, setAspect] = useState<AspectOption>('free');
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [processing, setProcessing] = useState(false);

  const onCropComplete = useCallback((_croppedArea: Area, croppedPixels: Area) => {
    setCroppedAreaPixels(croppedPixels);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!imageUrl || !croppedAreaPixels) return;

    setProcessing(true);
    try {
      // Detect MIME type from file extension to preserve transparency for PNGs
      const isPng = fileName.toLowerCase().endsWith('.png');
      const mimeType = isPng ? 'image/png' : 'image/jpeg';
      const blob = await getCroppedImg(imageUrl, croppedAreaPixels, rotation, mimeType);
      const file = new File([blob], fileName, { type: mimeType });
      onConfirm(file);
    } catch (err) {
      console.error('Failed to crop image:', err);
      // Show user-facing error via antd message if available, otherwise alert
      try {
        const { message: antdMessage } = await import('antd');
        antdMessage.error('Failed to crop image. Please try again.');
      } catch {
        alert('Failed to crop image. Please try again.');
      }
    } finally {
      setProcessing(false);
    }
  }, [imageUrl, croppedAreaPixels, rotation, fileName, onConfirm]);

  const resetState = useCallback(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
    setAspect('free');
  }, []);

  const handleCancel = useCallback(() => {
    resetState();
    onCancel();
  }, [onCancel, resetState]);

  const handleSkip = useCallback(() => {
    resetState();
    onSkip();
  }, [onSkip, resetState]);

  const currentAspect = ASPECT_OPTIONS.find((o) => o.value === aspect)?.ratio;

  if (!imageUrl) return null;

  return (
    <Modal
      title="Crop Image"
      open={open}
      onCancel={handleCancel}
      width={720}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={handleCancel}>
          Cancel
        </Button>,
        ...(showSkip ? [
          <Button key="skip" onClick={handleSkip}>
            Skip Crop
          </Button>,
        ] : []),
        <Button
          key="confirm"
          type="primary"
          loading={processing}
          onClick={handleConfirm}
        >
          Apply Crop
        </Button>,
      ]}
      styles={{
        body: { padding: 0 },
      }}
    >
      {/* Crop area */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: 420,
          background: '#f0f0f0',
        }}
      >
        <Cropper
          image={imageUrl}
          crop={crop}
          zoom={zoom}
          rotation={rotation}
          aspect={currentAspect}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onRotationChange={setRotation}
          onCropComplete={onCropComplete}
          showGrid
        />
      </div>

      {/* Controls */}
      <div style={{ padding: '12px 16px' }}>
        {/* Aspect ratio */}
        <div style={{ marginBottom: 12 }}>
          <Text style={{ fontSize: 12, color: '#8c8c8c', marginRight: 8 }}>
            Aspect Ratio:
          </Text>
          <Radio.Group
            size="small"
            value={aspect}
            onChange={(e) => setAspect(e.target.value)}
            optionType="button"
            buttonStyle="solid"
          >
            {ASPECT_OPTIONS.map((opt) => (
              <Radio.Button key={opt.value} value={opt.value}>
                {opt.label}
              </Radio.Button>
            ))}
          </Radio.Group>
        </div>

        {/* Zoom */}
        <Space style={{ width: '100%', marginBottom: 8 }} align="center">
          <ZoomOutOutlined style={{ color: '#8c8c8c' }} />
          <Slider
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={setZoom}
            style={{ width: 200 }}
            tooltip={{ formatter: (val) => `${Math.round((val ?? 1) * 100)}%` }}
          />
          <ZoomInOutlined style={{ color: '#8c8c8c' }} />
          <Text style={{ fontSize: 12, color: '#8c8c8c', minWidth: 50 }}>
            Zoom {Math.round(zoom * 100)}%
          </Text>
        </Space>

        {/* Rotation */}
        <Space style={{ width: '100%' }} align="center">
          <RotateLeftOutlined
            style={{ color: '#8c8c8c', cursor: 'pointer' }}
            onClick={() => setRotation((r) => r - 90)}
          />
          <Slider
            min={-180}
            max={180}
            step={1}
            value={rotation}
            onChange={setRotation}
            style={{ width: 200 }}
            tooltip={{ formatter: (val) => `${val}°` }}
          />
          <RotateRightOutlined
            style={{ color: '#8c8c8c', cursor: 'pointer' }}
            onClick={() => setRotation((r) => r + 90)}
          />
          <Text style={{ fontSize: 12, color: '#8c8c8c', minWidth: 50 }}>
            Rotate {rotation}°
          </Text>
          {rotation !== 0 && (
            <Button size="small" type="link" onClick={() => setRotation(0)}>
              Reset
            </Button>
          )}
        </Space>
      </div>
    </Modal>
  );
};

export default ImageCropModal;
