/**
 * SignatureField: a signature drawn or typed in place, inside a form, instead
 * of in a dialog of its own. Hands back a cropped transparent PNG (data URL),
 * the same as WMSignaturePad, or null while empty.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Segmented } from 'antd';
import { ClearOutlined, EditOutlined, FontSizeOutlined } from '@ant-design/icons';
import './SignatureField.css';

export interface SignatureValue {
  image: string;
  kind: 'drawn' | 'typed';
  /** The typed name; empty for a drawn signature */
  name: string;
}

interface Props {
  value: SignatureValue | null;
  onChange: (value: SignatureValue | null) => void;
  /** Pre-fills the typed name */
  defaultName?: string;
  /** Touch: 40px controls */
  large?: boolean;
}

const CANVAS_W = 640;
const CANVAS_H = 200;

const FONTS = [
  { label: 'Caveat', value: "'Caveat', cursive" },
  { label: 'Dancing Script', value: "'Dancing Script', cursive" },
  { label: 'Great Vibes', value: "'Great Vibes', cursive" },
  { label: 'Sacramento', value: "'Sacramento', cursive" },
];

// Shared with WMSignaturePad: whichever loads first adds the link
const loadFonts = () => {
  if (document.getElementById('signature-fonts-link')) return;
  const link = document.createElement('link');
  link.id = 'signature-fonts-link';
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Caveat:wght@400;700&family=Dancing+Script:wght@400;700&family=Great+Vibes&family=Sacramento&display=swap';
  document.head.appendChild(link);
};

/** The inked part of a canvas, a few pixels of air around it, as PNG; null when blank */
const cropToInk = (canvas: HTMLCanvasElement): string | null => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let minX = width; let minY = height; let maxX = 0; let maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX <= minX || maxY <= minY) return null;
  const pad = 4;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d')?.drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
};

const SignatureField: React.FC<Props> = ({ value, onChange, defaultName, large }) => {
  const [mode, setMode] = useState<'draw' | 'type'>(value?.kind === 'typed' ? 'type' : 'draw');
  const [typedName, setTypedName] = useState(value?.kind === 'typed' ? value.name : defaultName || '');
  const [font, setFont] = useState(FONTS[0].value);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [inked, setInked] = useState(false);

  useEffect(() => { loadFonts(); }, []);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    setInked(false);
  }, []);

  // A drawn signature coming back (the field remounted) is drawn again
  useEffect(() => {
    if (mode !== 'draw' || !value || value.kind !== 'drawn') return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const img = new window.Image();
    img.onload = () => {
      const scale = Math.min(canvas.width / img.width, canvas.height / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      setInked(true);
    };
    img.src = value.image;
    // Only when the field mounts or switches back to drawing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = point(e);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111111';
    ctx.beginPath();
    ctx.moveTo(x, y);
    // A tap leaves a dot
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
    drawing.current = true;
    setInked(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const onPointerUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const image = canvasRef.current ? cropToInk(canvasRef.current) : null;
    onChange(image ? { image, kind: 'drawn', name: '' } : null);
  };

  // A typed signature is the name in the picked script, rendered once its font is in
  useEffect(() => {
    if (mode !== 'type') return;
    let stale = false;
    const name = typedName.trim();
    if (!name) {
      onChange(null);
      return;
    }
    const render = () => {
      if (stale) return;
      const canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = CANVAS_H;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.font = `64px ${font}`;
      ctx.fillStyle = '#111111';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, 20, CANVAS_H / 2);
      const image = cropToInk(canvas);
      onChange(image ? { image, kind: 'typed', name } : null);
    };
    const timer = window.setTimeout(() => {
      if (document.fonts?.load) document.fonts.load(`64px ${font}`).then(render, render);
      else render();
    }, 150);
    return () => { stale = true; window.clearTimeout(timer); };
    // onChange is the parent's setter; following it would re-render on every keystroke twice
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, typedName, font]);

  const switchMode = (next: 'draw' | 'type') => {
    setMode(next);
    onChange(null);
    if (next === 'draw') setInked(false);
  };

  const controlSize = large ? 'large' : 'middle';

  return (
    <div className="sigf">
      <div className="sigf-bar">
        <Segmented
          size={large ? 'middle' : 'small'}
          value={mode}
          onChange={v => switchMode(v as 'draw' | 'type')}
          options={[
            { value: 'draw', label: 'Draw', icon: <EditOutlined /> },
            { value: 'type', label: 'Type', icon: <FontSizeOutlined /> },
          ]}
          aria-label="Signature method"
        />
        {mode === 'draw' && (
          <Button type="text" size="small" className="ui-icon-btn" icon={<ClearOutlined />}
            disabled={!inked} onClick={() => { clearCanvas(); onChange(null); }}>
            Clear
          </Button>
        )}
      </div>

      {mode === 'draw' ? (
        <div className={`sigf-pad${inked ? ' is-inked' : ''}`}>
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            className="sigf-canvas"
            aria-label="Draw the signature here"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
          <span className="sigf-line" aria-hidden="true" />
          {!inked && <span className="sigf-hint" aria-hidden="true">Sign here</span>}
        </div>
      ) : (
        <div className="sigf-type">
          <Input
            size={controlSize}
            value={typedName}
            onChange={e => setTypedName(e.target.value)}
            placeholder="Full name"
            aria-label="Name to sign with"
            autoComplete="name"
          />
          <div className="sigf-fonts" role="radiogroup" aria-label="Signature style">
            {FONTS.map(f => (
              <button
                key={f.label}
                type="button"
                role="radio"
                aria-checked={font === f.value}
                className={`sigf-font${font === f.value ? ' is-selected' : ''}`}
                style={{ fontFamily: f.value }}
                onClick={() => setFont(f.value)}
              >
                {typedName.trim() || f.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SignatureField;
