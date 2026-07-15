/**
 * WMPdfAnnotator - PDF annotation editor
 * Upload PDF → render pages via pdfjs → Konva overlay for text/signature → save with pdf-lib
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Stage, Layer, Image as KonvaImage, Text as KonvaText, Transformer, Rect } from 'react-konva';
import Konva from 'konva';
import { message, Spin, Upload, Button, Typography, Modal, Input } from 'antd';
import { UploadOutlined, InboxOutlined } from '@ant-design/icons';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist';
import WMPdfToolbar from './WMPdfToolbar';
import WMSignaturePad from './WMSignaturePad';
import type {
  PdfAnnotationData,
  PdfTextAnnotation,
  PdfSignatureAnnotation,
  PageAnnotations,
  AnnotatorState,
  AnnotationTool,
} from './types';
import { DEFAULT_ANNOTATOR_STATE } from './types';

const { Text: AntText, Paragraph } = Typography;
const { Dragger } = Upload;

// Setup pdfjs worker - v3 uses .js extension
if (typeof window !== 'undefined' && pdfjs.GlobalWorkerOptions) {
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;
}

interface WMPdfAnnotatorProps {
  jobId: string;
  /** Existing document ID if editing an existing annotated PDF */
  documentId?: string;
  /** Pre-loaded annotation data for re-editing */
  existingAnnotations?: PdfAnnotationData | null;
  /** URL to source PDF (for re-editing, loaded from backend) */
  sourcePdfUrl?: string;
  /** Document type (COS, EWA, etc.) for proper categorization */
  documentType?: string;
  /** Default filename when no annotation data exists */
  defaultFilename?: string;
  onSave: (pdfBlob: Blob, filename: string, annotationData: PdfAnnotationData, sourcePdfBlob?: Blob) => Promise<void>;
  onClose: () => void;
}

interface RenderedPage {
  image: HTMLImageElement;
  width: number;
  height: number;
}

let idCounter = 0;
const genId = () => `ann_${Date.now()}_${++idCounter}`;

const WMPdfAnnotator: React.FC<WMPdfAnnotatorProps> = ({
  jobId,
  documentId,
  existingAnnotations,
  sourcePdfUrl,
  documentType,
  defaultFilename,
  onSave,
  onClose,
}) => {
  // State
  const [annotatorState, setAnnotatorState] = useState<AnnotatorState>(DEFAULT_ANNOTATOR_STATE);
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [pdfFilename, setPdfFilename] = useState(defaultFilename || 'document.pdf');
  const [renderedPages, setRenderedPages] = useState<RenderedPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [signaturePadOpen, setSignaturePadOpen] = useState(false);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editTextValue, setEditTextValue] = useState('');

  // Per-page annotations
  const [annotations, setAnnotations] = useState<Record<number, PageAnnotations>>({});

  // Konva refs
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Container width for responsive scaling
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Signature images cache
  const sigImagesRef = useRef<Record<string, HTMLImageElement>>({});

  // Current page data
  const currentPageData = renderedPages[annotatorState.currentPage];
  const currentAnnotations = annotations[annotatorState.currentPage] || { texts: [], signatures: [] };

  // Responsive: fit PDF to container width on mobile, use manual scale on desktop
  const availableWidth = containerWidth > 0 ? containerWidth - 32 : 600; // 32px for padding
  const baseWidth = currentPageData ? currentPageData.width : 600;
  const baseHeight = currentPageData ? currentPageData.height : 800;
  const fitScale = baseWidth > 0 ? Math.min(1, availableWidth / baseWidth) : 1;
  const effectiveScale = annotatorState.scale * fitScale;
  const stageWidth = currentPageData ? baseWidth * effectiveScale : 600;
  const stageHeight = currentPageData ? baseHeight * effectiveScale : 800;

  // Load existing annotations
  useEffect(() => {
    if (existingAnnotations?.pages) {
      setAnnotations(existingAnnotations.pages);
      if (existingAnnotations.originalFilename) {
        setPdfFilename(existingAnnotations.originalFilename);
      }
    }
  }, [existingAnnotations]);

  // Load source PDF from URL (re-editing)
  useEffect(() => {
    if (sourcePdfUrl) {
      loadPdfFromUrl(sourcePdfUrl);
    }
  }, [sourcePdfUrl]);

  // Load signature images into cache when annotations change
  useEffect(() => {
    currentAnnotations.signatures.forEach(sig => {
      if (!sigImagesRef.current[sig.id]) {
        const img = new window.Image();
        img.src = sig.imageData;
        img.onload = () => {
          sigImagesRef.current[sig.id] = img;
          // Force re-render
          setAnnotations(prev => ({ ...prev }));
        };
      }
    });
  }, [currentAnnotations.signatures]);

  // Update transformer selection
  useEffect(() => {
    const tr = transformerRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;

    if (annotatorState.selectedAnnotationId) {
      const node = stage.findOne(`#${annotatorState.selectedAnnotationId}`);
      if (node) {
        tr.nodes([node]);
        tr.getLayer()?.batchDraw();
        return;
      }
    }
    tr.nodes([]);
    tr.getLayer()?.batchDraw();
  }, [annotatorState.selectedAnnotationId, currentAnnotations]);

  // Render PDF pages to images
  const renderPdfPages = useCallback(async (buffer: ArrayBuffer) => {
    setLoading(true);
    try {
      const pdf = await pdfjs.getDocument({ data: buffer }).promise;
      const pages: RenderedPage[] = [];
      const RENDER_SCALE = 2; // High DPI render

      for (let i = 0; i < pdf.numPages; i++) {
        const page = await pdf.getPage(i + 1);
        const viewport = page.getViewport({ scale: RENDER_SCALE });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d')!;
        await page.render({ canvasContext: ctx, viewport }).promise;

        const img = await new Promise<HTMLImageElement>((resolve) => {
          const image = new window.Image();
          image.onload = () => resolve(image);
          image.src = canvas.toDataURL('image/png');
        });

        pages.push({
          image: img,
          width: viewport.width / RENDER_SCALE,
          height: viewport.height / RENDER_SCALE,
        });
      }

      setRenderedPages(pages);
      setAnnotatorState(prev => ({
        ...prev,
        totalPages: pages.length,
        currentPage: 0,
      }));
    } catch (err: any) {
      message.error(`Failed to render PDF: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPdfFromUrl = async (url: string) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = await res.arrayBuffer();
      setPdfBytes(buffer.slice(0));
      await renderPdfPages(buffer);
    } catch (err: any) {
      message.error(`Failed to load PDF: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    setPdfFilename(file.name);
    const buffer = await file.arrayBuffer();
    setPdfBytes(buffer.slice(0));
    await renderPdfPages(buffer);
    return false; // prevent antd auto upload
  };

  // --- Annotation Manipulation ---

  const updateCurrentAnnotations = useCallback((updater: (prev: PageAnnotations) => PageAnnotations) => {
    setAnnotations(prev => ({
      ...prev,
      [annotatorState.currentPage]: updater(prev[annotatorState.currentPage] || { texts: [], signatures: [] }),
    }));
  }, [annotatorState.currentPage]);

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    // Click on empty space → deselect or add text
    const clickedOnEmpty = e.target === e.target.getStage() || e.target.name() === 'pdf-bg';

    if (clickedOnEmpty) {
      if (annotatorState.tool === 'text') {
        // Add new text at click position
        const stage = stageRef.current;
        if (!stage || !currentPageData) return;
        const pos = stage.getPointerPosition();
        if (!pos) return;

        const newText: PdfTextAnnotation = {
          id: genId(),
          pageIndex: annotatorState.currentPage,
          x: pos.x / stageWidth,
          y: pos.y / stageHeight,
          text: 'New Text',
          fontSize: annotatorState.fontSize,
          fontFamily: 'Arial',
          color: annotatorState.fontColor,
          bold: annotatorState.fontBold,
          italic: annotatorState.fontItalic,
        };

        updateCurrentAnnotations(prev => ({
          ...prev,
          texts: [...prev.texts, newText],
        }));

        setAnnotatorState(prev => ({
          ...prev,
          selectedAnnotationId: newText.id,
          tool: 'select',
        }));
      } else {
        setAnnotatorState(prev => ({ ...prev, selectedAnnotationId: null }));
      }
    }
  };

  const handleAnnotationSelect = (id: string) => {
    setAnnotatorState(prev => ({ ...prev, selectedAnnotationId: id }));
  };

  const handleTextDragEnd = (id: string, e: Konva.KonvaEventObject<DragEvent>) => {
    const x = e.target.x() / stageWidth;
    const y = e.target.y() / stageHeight;
    updateCurrentAnnotations(prev => ({
      ...prev,
      texts: prev.texts.map(t => t.id === id ? { ...t, x, y } : t),
    }));
  };

  const handleSignatureDragEnd = (id: string, e: Konva.KonvaEventObject<DragEvent>) => {
    const x = e.target.x() / stageWidth;
    const y = e.target.y() / stageHeight;
    updateCurrentAnnotations(prev => ({
      ...prev,
      signatures: prev.signatures.map(s => s.id === id ? { ...s, x, y } : s),
    }));
  };

  const handleSignatureTransformEnd = (id: string, e: Konva.KonvaEventObject<Event>) => {
    const node = e.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    // Reset scale and apply to width/height
    node.scaleX(1);
    node.scaleY(1);

    const newWidth = (node.width() * scaleX) / stageWidth;
    const newHeight = (node.height() * scaleY) / stageHeight;
    const x = node.x() / stageWidth;
    const y = node.y() / stageHeight;

    updateCurrentAnnotations(prev => ({
      ...prev,
      signatures: prev.signatures.map(s =>
        s.id === id ? { ...s, x, y, width: newWidth, height: newHeight } : s
      ),
    }));
  };

  const handleTextDblClick = (id: string) => {
    const text = currentAnnotations.texts.find(t => t.id === id);
    if (!text) return;
    setEditingTextId(id);
    setEditTextValue(text.text);
  };

  const handleTextEditConfirm = () => {
    if (!editingTextId) return;
    updateCurrentAnnotations(prev => ({
      ...prev,
      texts: prev.texts.map(t =>
        t.id === editingTextId ? { ...t, text: editTextValue } : t
      ),
    }));
    setEditingTextId(null);
    setEditTextValue('');
  };

  // --- Toolbar Handlers ---

  const handleToolChange = (tool: AnnotationTool) => {
    setAnnotatorState(prev => ({ ...prev, tool, selectedAnnotationId: null }));
  };

  const handlePageChange = (page: number) => {
    setAnnotatorState(prev => ({ ...prev, currentPage: page, selectedAnnotationId: null }));
  };

  const handleFontSizeChange = (size: number) => {
    setAnnotatorState(prev => ({ ...prev, fontSize: size }));
    // Update selected text if any
    if (annotatorState.selectedAnnotationId) {
      updateCurrentAnnotations(prev => ({
        ...prev,
        texts: prev.texts.map(t =>
          t.id === annotatorState.selectedAnnotationId ? { ...t, fontSize: size } : t
        ),
      }));
    }
  };

  const handleFontColorChange = (color: string) => {
    setAnnotatorState(prev => ({ ...prev, fontColor: color }));
    if (annotatorState.selectedAnnotationId) {
      updateCurrentAnnotations(prev => ({
        ...prev,
        texts: prev.texts.map(t =>
          t.id === annotatorState.selectedAnnotationId ? { ...t, color } : t
        ),
      }));
    }
  };

  const handleBoldToggle = () => {
    const newBold = !annotatorState.fontBold;
    setAnnotatorState(prev => ({ ...prev, fontBold: newBold }));
    if (annotatorState.selectedAnnotationId) {
      updateCurrentAnnotations(prev => ({
        ...prev,
        texts: prev.texts.map(t =>
          t.id === annotatorState.selectedAnnotationId ? { ...t, bold: newBold } : t
        ),
      }));
    }
  };

  const handleItalicToggle = () => {
    const newItalic = !annotatorState.fontItalic;
    setAnnotatorState(prev => ({ ...prev, fontItalic: newItalic }));
    if (annotatorState.selectedAnnotationId) {
      updateCurrentAnnotations(prev => ({
        ...prev,
        texts: prev.texts.map(t =>
          t.id === annotatorState.selectedAnnotationId ? { ...t, italic: newItalic } : t
        ),
      }));
    }
  };

  const handleDeleteSelected = () => {
    if (!annotatorState.selectedAnnotationId) return;
    const id = annotatorState.selectedAnnotationId;
    updateCurrentAnnotations(prev => ({
      texts: prev.texts.filter(t => t.id !== id),
      signatures: prev.signatures.filter(s => s.id !== id),
    }));
    setAnnotatorState(prev => ({ ...prev, selectedAnnotationId: null }));
  };

  const handleZoomIn = () => {
    setAnnotatorState(prev => ({ ...prev, scale: Math.min(3, prev.scale + 0.25) }));
  };

  const handleZoomOut = () => {
    setAnnotatorState(prev => ({ ...prev, scale: Math.max(0.5, prev.scale - 0.25) }));
  };

  // --- Signature ---

  const handleSignatureSave = (imageData: string) => {
    if (!currentPageData) return;
    const sigWidth = 0.25; // 25% of page width
    const sigHeight = (sigWidth * currentPageData.width * 0.4) / currentPageData.height;

    const newSig: PdfSignatureAnnotation = {
      id: genId(),
      pageIndex: annotatorState.currentPage,
      x: 0.3,
      y: 0.7,
      width: sigWidth,
      height: sigHeight,
      imageData,
    };

    updateCurrentAnnotations(prev => ({
      ...prev,
      signatures: [...prev.signatures, newSig],
    }));

    // Preload image
    const img = new window.Image();
    img.src = imageData;
    img.onload = () => {
      sigImagesRef.current[newSig.id] = img;
      setAnnotations(prev => ({ ...prev })); // Force re-render
    };

    setSignaturePadOpen(false);
    setAnnotatorState(prev => ({ ...prev, selectedAnnotationId: newSig.id, tool: 'select' }));
    message.success('Signature added. Drag to move, use handles to resize.');
  };

  // --- Save ---

  const handleSave = async () => {
    if (!pdfBytes) {
      message.error('No PDF loaded');
      return;
    }

    setSaving(true);
    try {
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const pages = pdfDoc.getPages();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
      const fontBoldItalic = await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique);

      for (const [pageIdxStr, pageAnns] of Object.entries(annotations)) {
        const pageIdx = parseInt(pageIdxStr);
        if (pageIdx >= pages.length) continue;
        const page = pages[pageIdx];
        const { width: pw, height: ph } = page.getSize();

        // Draw texts
        for (const t of pageAnns.texts) {
          const selectedFont = t.bold && t.italic ? fontBoldItalic : t.bold ? fontBold : t.italic ? fontItalic : font;
          const hexColor = t.color.replace('#', '');
          const r = parseInt(hexColor.substring(0, 2), 16) / 255;
          const g = parseInt(hexColor.substring(2, 4), 16) / 255;
          const b = parseInt(hexColor.substring(4, 6), 16) / 255;

          // pdf-lib Y is from bottom
          const x = t.x * pw;
          const y = ph - (t.y * ph) - t.fontSize;

          page.drawText(t.text, {
            x,
            y,
            size: t.fontSize,
            font: selectedFont,
            color: rgb(r, g, b),
          });
        }

        // Draw signatures
        for (const sig of pageAnns.signatures) {
          try {
            const base64 = sig.imageData.split(',')[1];
            const sigImage = await pdfDoc.embedPng(Uint8Array.from(atob(base64), c => c.charCodeAt(0)));
            const x = sig.x * pw;
            const y = ph - (sig.y * ph) - (sig.height * ph);
            page.drawImage(sigImage, {
              x,
              y,
              width: sig.width * pw,
              height: sig.height * ph,
            });
          } catch (err) {
            console.error('Failed to embed signature:', err);
          }
        }
      }

      const finalBytes = await pdfDoc.save();
      const blob = new Blob([finalBytes], { type: 'application/pdf' });

      const annotationData: PdfAnnotationData = {
        pages: annotations,
        originalFilename: pdfFilename,
        version: 1,
      };

      // Pass original (unannotated) PDF as source for clean re-editing
      const sourcePdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
      await onSave(blob, pdfFilename, annotationData, sourcePdfBlob);
      message.success('PDF saved successfully');
    } catch (err: any) {
      message.error(`Failed to save PDF: ${err.message}`);
      console.error('Save error:', err);
    } finally {
      setSaving(false);
    }
  };

  // --- Keyboard shortcuts ---

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (editingTextId) return; // Don't handle shortcuts while editing text

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (annotatorState.selectedAnnotationId) {
          e.preventDefault();
          handleDeleteSelected();
        }
      }
      if (e.key === 'v' || e.key === 'V') {
        setAnnotatorState(prev => ({ ...prev, tool: 'select' }));
      }
      if (e.key === 't' || e.key === 'T') {
        setAnnotatorState(prev => ({ ...prev, tool: 'text' }));
      }
      if (e.key === 'Escape') {
        setAnnotatorState(prev => ({ ...prev, selectedAnnotationId: null, tool: 'select' }));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [annotatorState.selectedAnnotationId, editingTextId]);

  // --- Render ---

  if (!pdfBytes || renderedPages.length === 0) {
    return (
      <div style={{ padding: 24 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <Spin size="large" />
            <div style={{ marginTop: 16, color: '#8c8c8c' }}>Loading PDF...</div>
          </div>
        ) : (
          <Dragger
            accept=".pdf"
            beforeUpload={handleFileUpload}
            showUploadList={false}
            style={{ padding: 24 }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined style={{ fontSize: 48, color: '#1890ff' }} />
            </p>
            <p className="ant-upload-text" style={{ fontSize: 16 }}>
              Click or drag PDF file to upload
            </p>
            <p className="ant-upload-hint">
              Upload a PDF to add text annotations and signatures
            </p>
          </Dragger>
        )}
      </div>
    );
  }

  const cursorStyle = annotatorState.tool === 'text' ? 'crosshair' : 'default';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <WMPdfToolbar
        state={annotatorState}
        onToolChange={handleToolChange}
        onPageChange={handlePageChange}
        onFontSizeChange={handleFontSizeChange}
        onFontColorChange={handleFontColorChange}
        onBoldToggle={handleBoldToggle}
        onItalicToggle={handleItalicToggle}
        onDeleteSelected={handleDeleteSelected}
        onSave={handleSave}
        onOpenSignaturePad={() => setSignaturePadOpen(true)}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        saving={saving}
        hasSelection={!!annotatorState.selectedAnnotationId}
      />

      {/* Canvas Area */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflow: 'auto',
          background: '#e8e8e8',
          display: 'flex',
          justifyContent: 'center',
          padding: 16,
          cursor: cursorStyle,
        }}
      >
        {currentPageData && (
          <div style={{
            boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
            background: '#fff',
            width: stageWidth,
            height: stageHeight,
          }}>
            <Stage
              ref={stageRef}
              width={stageWidth}
              height={stageHeight}
              onClick={handleStageClick}
              onTap={handleStageClick}
            >
              <Layer>
                {/* PDF background */}
                <KonvaImage
                  name="pdf-bg"
                  image={currentPageData.image}
                  width={stageWidth}
                  height={stageHeight}
                  listening={true}
                />

                {/* Text annotations */}
                {currentAnnotations.texts.map(t => (
                  <KonvaText
                    key={t.id}
                    id={t.id}
                    x={t.x * stageWidth}
                    y={t.y * stageHeight}
                    text={t.text}
                    fontSize={t.fontSize * effectiveScale}
                    fontFamily={t.fontFamily || 'Arial'}
                    fontStyle={`${t.bold ? 'bold' : ''} ${t.italic ? 'italic' : ''}`.trim() || 'normal'}
                    fill={t.color}
                    draggable={annotatorState.tool === 'select'}
                    onClick={() => handleAnnotationSelect(t.id)}
                    onTap={() => handleAnnotationSelect(t.id)}
                    onDblClick={() => handleTextDblClick(t.id)}
                    onDblTap={() => handleTextDblClick(t.id)}
                    onDragEnd={(e) => handleTextDragEnd(t.id, e)}
                  />
                ))}

                {/* Signature annotations */}
                {currentAnnotations.signatures.map(sig => {
                  const sigImg = sigImagesRef.current[sig.id];
                  if (!sigImg) return null;
                  return (
                    <KonvaImage
                      key={sig.id}
                      id={sig.id}
                      image={sigImg}
                      x={sig.x * stageWidth}
                      y={sig.y * stageHeight}
                      width={sig.width * stageWidth}
                      height={sig.height * stageHeight}
                      draggable={annotatorState.tool === 'select'}
                      onClick={() => handleAnnotationSelect(sig.id)}
                      onTap={() => handleAnnotationSelect(sig.id)}
                      onDragEnd={(e) => handleSignatureDragEnd(sig.id, e)}
                      onTransformEnd={(e) => handleSignatureTransformEnd(sig.id, e)}
                    />
                  );
                })}

                {/* Transformer for selected element */}
                <Transformer
                  ref={transformerRef}
                  rotateEnabled={false}
                  enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
                  boundBoxFunc={(oldBox, newBox) => {
                    if (newBox.width < 20 || newBox.height < 10) return oldBox;
                    return newBox;
                  }}
                />
              </Layer>
            </Stage>
          </div>
        )}
      </div>

      {/* Signature Pad Modal */}
      <WMSignaturePad
        open={signaturePadOpen}
        onClose={() => setSignaturePadOpen(false)}
        onSave={handleSignatureSave}
      />

      {/* Text Edit Modal */}
      <Modal
        title="Edit Text"
        open={!!editingTextId}
        onOk={handleTextEditConfirm}
        onCancel={() => {
          setEditingTextId(null);
          setEditTextValue('');
        }}
        okText="Apply"
      >
        <Input.TextArea
          value={editTextValue}
          onChange={e => setEditTextValue(e.target.value)}
          rows={4}
          autoFocus
          placeholder="Enter text..."
        />
      </Modal>
    </div>
  );
};

export default WMPdfAnnotator;
