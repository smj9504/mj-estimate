/**
 * PerspectiveCropModal - 4-point perspective crop for document scanning
 * Allows users to select 4 corners on a photo to perform perspective transform
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Modal, Button, Space, message, Spin, Select, Typography } from 'antd';
import waterMitigationService from '../../services/waterMitigationService';

const { Text } = Typography;

interface Point {
  x: number; // ratio 0-1
  y: number; // ratio 0-1
}

interface PerspectiveCropModalProps {
  open: boolean;
  photoId: string;
  photoUrl: string;
  onClose: () => void;
  onCropped: (newPhoto: any) => void;
}

const CORNER_RADIUS = 12;
const CORNER_COLORS = ['#ff4d4f', '#52c41a', '#1890ff', '#faad14']; // TL, TR, BR, BL
const CORNER_LABELS = ['TL', 'TR', 'BR', 'BL'];

const PerspectiveCropModal: React.FC<PerspectiveCropModalProps> = ({
  open,
  photoId,
  photoUrl,
  onClose,
  onCropped,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [scanEffect, setScanEffect] = useState<string | undefined>(undefined);
  const [points, setPoints] = useState<Point[]>([
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.9 },
    { x: 0.1, y: 0.9 },
  ]);
  const [dragging, setDragging] = useState<number | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  // Load image
  useEffect(() => {
    if (!open || !photoUrl) return;
    setLoading(true);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setImage(img);
      setLoading(false);
      // Reset points when new image loads
      setPoints([
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
        { x: 0.1, y: 0.9 },
      ]);
    };
    img.onerror = () => {
      setLoading(false);
      message.error('Failed to load image');
    };
    img.src = photoUrl;
  }, [open, photoUrl]);

  // Calculate canvas size based on container
  useEffect(() => {
    if (!image) return;

    const maxW = Math.min(window.innerWidth * 0.85, 900);
    const maxH = window.innerHeight * 0.6;

    const imgRatio = image.width / image.height;
    let w = maxW;
    let h = w / imgRatio;
    if (h > maxH) {
      h = maxH;
      w = h * imgRatio;
    }

    setCanvasSize({ width: Math.floor(w), height: Math.floor(h) });
  }, [image]);

  // Draw canvas
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image || canvasSize.width === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw image
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    // Draw semi-transparent overlay outside the crop area
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Clear the crop area (draw image again inside polygon)
    ctx.save();
    ctx.beginPath();
    points.forEach((p, i) => {
      const px = p.x * canvas.width;
      const py = p.y * canvas.height;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    // Draw quadrilateral border
    ctx.beginPath();
    ctx.strokeStyle = '#1890ff';
    ctx.lineWidth = 2;
    points.forEach((p, i) => {
      const px = p.x * canvas.width;
      const py = p.y * canvas.height;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.stroke();

    // Draw edge lines between corners
    ctx.setLineDash([6, 3]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1;
    points.forEach((p, i) => {
      const next = points[(i + 1) % 4];
      ctx.beginPath();
      ctx.moveTo(p.x * canvas.width, p.y * canvas.height);
      ctx.lineTo(next.x * canvas.width, next.y * canvas.height);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    // Draw corner handles
    points.forEach((p, i) => {
      const px = p.x * canvas.width;
      const py = p.y * canvas.height;

      // Outer circle
      ctx.beginPath();
      ctx.arc(px, py, CORNER_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = CORNER_COLORS[i];
      ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Label
      ctx.fillStyle = 'white';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(CORNER_LABELS[i], px, py);
    });
  }, [image, points, canvasSize]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Get point index at canvas coordinates
  const getPointAt = (cx: number, cy: number): number | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    for (let i = 0; i < points.length; i++) {
      const px = points[i].x * canvas.width;
      const py = points[i].y * canvas.height;
      const dist = Math.sqrt((cx - px) ** 2 + (cy - py) ** 2);
      if (dist <= CORNER_RADIUS + 4) return i;
    }
    return null;
  };

  const getCanvasCoords = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    let clientX: number, clientY: number;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    const { x, y } = getCanvasCoords(e);
    const idx = getPointAt(x, y);
    if (idx !== null) {
      setDragging(idx);
      e.preventDefault();
    }
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (dragging === null) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { x, y } = getCanvasCoords(e);

    // Clamp to canvas bounds
    const nx = Math.max(0, Math.min(1, x / canvas.width));
    const ny = Math.max(0, Math.min(1, y / canvas.height));

    setPoints(prev => {
      const updated = [...prev];
      updated[dragging] = { x: nx, y: ny };
      return updated;
    });
  };

  const handlePointerUp = () => {
    setDragging(null);
  };

  const handleCrop = async () => {
    setProcessing(true);
    try {
      const newPhoto = await waterMitigationService.photos.perspectiveCrop(
        photoId,
        points,
        scanEffect
      );
      message.success('Photo cropped successfully');
      onCropped(newPhoto);
      onClose();
    } catch (error: any) {
      console.error('Crop failed:', error);
      message.error(error?.response?.data?.detail || 'Failed to crop photo');
    } finally {
      setProcessing(false);
    }
  };

  const handleReset = () => {
    setPoints([
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ]);
  };

  return (
    <Modal
      title="Perspective Crop"
      open={open}
      onCancel={onClose}
      width={Math.max(canvasSize.width + 48, 500)}
      footer={
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button onClick={handleReset}>Reset Points</Button>
          <div>
            <Text style={{ marginRight: 8 }}>Scan Effect:</Text>
            <Select
              value={scanEffect || 'none'}
              onChange={(val) => setScanEffect(val === 'none' ? undefined : val)}
              style={{ width: 130 }}
              size="small"
            >
              <Select.Option value="none">None</Select.Option>
              <Select.Option value="color_scan">Color Scan</Select.Option>
              <Select.Option value="bw_scan">B&W Scan</Select.Option>
            </Select>
          </div>
          <Button
            type="primary"
            onClick={handleCrop}
            loading={processing}
          >
            Crop & Save
          </Button>
        </Space>
      }
      destroyOnHidden
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin size="large" />
          <div style={{ marginTop: 12 }}>Loading image...</div>
        </div>
      ) : (
        <div style={{ textAlign: 'center' }}>
          <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            Drag the 4 corner handles to select the document area
          </Text>
          <canvas
            ref={canvasRef}
            width={canvasSize.width}
            height={canvasSize.height}
            style={{
              cursor: dragging !== null ? 'grabbing' : 'crosshair',
              border: '1px solid #d9d9d9',
              borderRadius: 4,
              touchAction: 'none',
              maxWidth: '100%',
            }}
            onMouseDown={handlePointerDown}
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            onMouseLeave={handlePointerUp}
            onTouchStart={handlePointerDown}
            onTouchMove={handlePointerMove}
            onTouchEnd={handlePointerUp}
          />
        </div>
      )}
    </Modal>
  );
};

export default PerspectiveCropModal;
