/**
 * WMSignaturePad - Signature capture modal with Draw and Type modes
 * Draw: Freehand canvas drawing (HTML Canvas 2D)
 * Type: Typed name rendered in handwriting font, exported as PNG base64
 * Both modes output the same format: base64 PNG via onSave callback
 */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Modal, Button, Slider, Typography, Tabs, Input } from 'antd';
import {
  ClearOutlined, CheckOutlined, UndoOutlined,
  EditOutlined, FontSizeOutlined,
} from '@ant-design/icons';

const { Text } = Typography;

interface WMSignaturePadProps {
  open: boolean;
  onClose: () => void;
  onSave: (imageData: string, signatureType?: 'drawn' | 'typed', typedName?: string) => void;
  /** Pre-fill typed name (e.g., from signer name input) */
  defaultName?: string;
  /** Pre-load existing signature image (base64 data URL) onto canvas */
  initialImage?: string;
}

const CANVAS_WIDTH = 500;
const CANVAS_HEIGHT = 200;

// Google Fonts handwriting fonts
const SIGNATURE_FONTS = [
  { label: 'Caveat', value: "'Caveat', cursive" },
  { label: 'Dancing Script', value: "'Dancing Script', cursive" },
  { label: 'Great Vibes', value: "'Great Vibes', cursive" },
  { label: 'Sacramento', value: "'Sacramento', cursive" },
];

// Load Google Fonts for typed signatures
const loadSignatureFonts = () => {
  if (document.getElementById('signature-fonts-link')) return;
  const link = document.createElement('link');
  link.id = 'signature-fonts-link';
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Caveat:wght@400;700&family=Dancing+Script:wght@400;700&family=Great+Vibes&family=Sacramento&display=swap';
  document.head.appendChild(link);
};

const WMSignaturePad: React.FC<WMSignaturePadProps> = ({
  open, onClose, onSave, defaultName, initialImage,
}) => {
  // Draw mode state
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [penWidth, setPenWidth] = useState(2);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [history, setHistory] = useState<ImageData[]>([]);

  // Type mode state
  const [typedName, setTypedName] = useState('');
  const [selectedFont, setSelectedFont] = useState(SIGNATURE_FONTS[0].value);
  const [activeTab, setActiveTab] = useState<'draw' | 'type'>('draw');

  // Load fonts on mount
  useEffect(() => {
    loadSignatureFonts();
  }, []);

  // Reset state when opened — load initial image if provided
  useEffect(() => {
    if (open) {
      setTypedName(defaultName || '');
      setTimeout(() => {
        clearCanvas();
        if (initialImage) {
          const ctx = getCtx();
          const canvas = canvasRef.current;
          if (ctx && canvas) {
            const img = new window.Image();
            img.onload = () => {
              // Center the image on canvas
              const scale = Math.min(
                canvas.width / img.width,
                canvas.height / img.height,
                1,
              );
              const w = img.width * scale;
              const h = img.height * scale;
              const x = (canvas.width - w) / 2;
              const y = (canvas.height - h) / 2;
              ctx.drawImage(img, x, y, w, h);
              setHasDrawn(true);
            };
            img.src = initialImage;
          }
        }
      }, 50);
    }
  }, [open, defaultName, initialImage]);

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
    if ('cancelable' in e && e.cancelable) e.preventDefault();
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
    if ('cancelable' in e && e.cancelable) e.preventDefault();
    if (!isDrawing) return;
    const ctx = getCtx();
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if ('cancelable' in e && e.cancelable) e.preventDefault();
    setIsDrawing(false);
  };

  // Register non-passive touch listeners directly on canvas
  // to allow preventDefault() for touch drawing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleTouchStart = (e: TouchEvent) => { e.preventDefault(); };
    const handleTouchMove = (e: TouchEvent) => { e.preventDefault(); };
    const handleTouchEnd = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
    };

    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });

    return () => {
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
    };
  }, [open]);

  const cropAndExport = (canvas: HTMLCanvasElement): string | null => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
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

    if (maxX <= minX || maxY <= minY) return null;

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
    if (!croppedCtx) return null;
    croppedCtx.drawImage(canvas, minX, minY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

    return croppedCanvas.toDataURL('image/png');
  };

  const handleSaveDrawn = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) return;
    const dataUrl = cropAndExport(canvas);
    if (dataUrl) {
      onSave(dataUrl, 'drawn');
    }
  };

  const handleSaveTyped = () => {
    if (!typedName.trim()) return;

    // Render typed name to a hidden canvas
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set font and render
    const fontSize = 48;
    ctx.font = `${fontSize}px ${selectedFont}`;
    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'middle';
    ctx.fillText(typedName.trim(), 20, CANVAS_HEIGHT / 2);

    const dataUrl = cropAndExport(canvas);
    if (dataUrl) {
      onSave(dataUrl, 'typed', typedName.trim());
    }
  };

  const handleSave = () => {
    if (activeTab === 'draw') {
      handleSaveDrawn();
    } else {
      handleSaveTyped();
    }
  };

  const canSave = activeTab === 'draw' ? hasDrawn : typedName.trim().length > 0;

  return (
    <Modal
      title="Signature"
      open={open}
      onCancel={onClose}
      width={580}
      footer={[
        ...(activeTab === 'draw' ? [
          <Button key="clear" icon={<ClearOutlined />} onClick={clearCanvas}>
            Clear
          </Button>,
          <Button key="undo" icon={<UndoOutlined />} onClick={undo} disabled={history.length === 0}>
            Undo
          </Button>,
        ] : []),
        <Button key="cancel" onClick={onClose}>
          Cancel
        </Button>,
        <Button key="save" type="primary" icon={<CheckOutlined />} onClick={handleSave} disabled={!canSave}>
          Apply Signature
        </Button>,
      ]}
    >
      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as 'draw' | 'type')}
        items={[
          {
            key: 'draw',
            label: (
              <span><EditOutlined /> Draw</span>
            ),
            children: (
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
                <div style={{
                  marginTop: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  justifyContent: 'center',
                }}>
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
            ),
          },
          {
            key: 'type',
            label: (
              <span><FontSizeOutlined /> Type</span>
            ),
            children: (
              <div>
                <Input
                  placeholder="Type your name..."
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  style={{ marginBottom: 16 }}
                  size="large"
                  autoFocus={activeTab === 'type'}
                />

                {/* Font Selection */}
                <div style={{
                  display: 'flex',
                  gap: 8,
                  marginBottom: 16,
                  flexWrap: 'wrap',
                }}>
                  {SIGNATURE_FONTS.map((font) => (
                    <Button
                      key={font.label}
                      type={selectedFont === font.value ? 'primary' : 'default'}
                      onClick={() => setSelectedFont(font.value)}
                      style={{
                        fontFamily: font.value,
                        fontSize: 16,
                        height: 'auto',
                        padding: '4px 12px',
                      }}
                    >
                      {font.label}
                    </Button>
                  ))}
                </div>

                {/* Preview */}
                <div style={{
                  border: '1px solid #d9d9d9',
                  borderRadius: 8,
                  padding: '24px 20px',
                  minHeight: 80,
                  display: 'flex',
                  alignItems: 'center',
                  background: '#fff',
                }}>
                  {typedName.trim() ? (
                    <span style={{
                      fontFamily: selectedFont,
                      fontSize: 48,
                      color: '#000',
                      lineHeight: 1,
                    }}>
                      {typedName}
                    </span>
                  ) : (
                    <Text type="secondary">
                      Your signature will appear here
                    </Text>
                  )}
                </div>
              </div>
            ),
          },
        ]}
      />
    </Modal>
  );
};

export default WMSignaturePad;
