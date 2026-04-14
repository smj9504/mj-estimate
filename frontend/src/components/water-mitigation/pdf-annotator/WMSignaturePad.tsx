/**
 * WMSignaturePad - Freehand signature drawing modal
 * Uses HTML Canvas 2D for smooth drawing, exports as PNG base64
 */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Modal, Button, Space, Slider, Typography } from 'antd';
import { ClearOutlined, CheckOutlined, UndoOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface WMSignaturePadProps {
  open: boolean;
  onClose: () => void;
  onSave: (imageData: string) => void;
}

const CANVAS_WIDTH = 500;
const CANVAS_HEIGHT = 200;

const WMSignaturePad: React.FC<WMSignaturePadProps> = ({ open, onClose, onSave }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [penWidth, setPenWidth] = useState(2);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [history, setHistory] = useState<ImageData[]>([]);

  const getCtx = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.getContext('2d');
  }, []);

  const clearCanvas = useCallback(() => {
    const ctx = getCtx();
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
    setHistory([]);
  }, [getCtx]);

  useEffect(() => {
    if (open) {
      // Small delay so canvas is rendered
      setTimeout(() => clearCanvas(), 50);
    }
  }, [open, clearCanvas]);

  const saveSnapshot = useCallback(() => {
    const ctx = getCtx();
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;
    const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setHistory(prev => [...prev, snapshot]);
  }, [getCtx]);

  const undo = useCallback(() => {
    const ctx = getCtx();
    const canvas = canvasRef.current;
    if (!ctx || !canvas || history.length === 0) return;

    const newHistory = [...history];
    newHistory.pop();
    setHistory(newHistory);

    if (newHistory.length === 0) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setHasDrawn(false);
    } else {
      ctx.putImageData(newHistory[newHistory.length - 1], 0, 0);
    }
  }, [getCtx, history]);

  const getPos = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if ('touches' in e) {
      const touch = e.touches[0];
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const ctx = getCtx();
    if (!ctx) return;
    saveSnapshot();
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineWidth = penWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#000000';
    setIsDrawing(true);
    setHasDrawn(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!isDrawing) return;
    const ctx = getCtx();
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setIsDrawing(false);
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) return;

    // Crop to content bounds for a tight signature image
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { data, width, height } = imageData;

    let minX = width, minY = height, maxX = 0, maxY = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const alpha = data[(y * width + x) * 4 + 3];
        if (alpha > 0) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }

    if (maxX <= minX || maxY <= minY) return;

    const pad = 4;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(width - 1, maxX + pad);
    maxY = Math.min(height - 1, maxY + pad);

    const cropWidth = maxX - minX + 1;
    const cropHeight = maxY - minY + 1;
    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = cropWidth;
    croppedCanvas.height = cropHeight;
    const croppedCtx = croppedCanvas.getContext('2d');
    if (!croppedCtx) return;
    croppedCtx.drawImage(canvas, minX, minY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

    const dataUrl = croppedCanvas.toDataURL('image/png');
    onSave(dataUrl);
  };

  return (
    <Modal
      title="Draw Signature"
      open={open}
      onCancel={onClose}
      width={580}
      footer={[
        <Button key="clear" icon={<ClearOutlined />} onClick={clearCanvas}>
          Clear
        </Button>,
        <Button key="undo" icon={<UndoOutlined />} onClick={undo} disabled={history.length === 0}>
          Undo
        </Button>,
        <Button key="cancel" onClick={onClose}>
          Cancel
        </Button>,
        <Button key="save" type="primary" icon={<CheckOutlined />} onClick={handleSave} disabled={!hasDrawn}>
          Apply Signature
        </Button>,
      ]}
    >
      <div style={{ textAlign: 'center' }}>
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          style={{
            border: '1px solid #d9d9d9',
            borderRadius: 8,
            cursor: 'crosshair',
            touchAction: 'none',
            width: '100%',
            maxWidth: CANVAS_WIDTH,
            background: '#fff',
          }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' }}>
          <Text style={{ whiteSpace: 'nowrap' }}>Pen Width:</Text>
          <Slider
            min={1}
            max={6}
            value={penWidth}
            onChange={setPenWidth}
            style={{ width: 150 }}
          />
          <Text type="secondary">{penWidth}px</Text>
        </div>
      </div>
    </Modal>
  );
};

export default WMSignaturePad;
