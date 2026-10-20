import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Progress, Spin } from 'antd';
import { getPdfUploadLockState, subscribePdfUploadLock } from '../../utils/pdfUploadLock';
import './PdfUploadBlocker.css';

const KEY_EVENTS = ['keydown', 'keypress', 'keyup'] as const;

const swallowKey = (event: KeyboardEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

const warnBeforeUnload = (event: BeforeUnloadEvent) => {
  event.preventDefault();
  event.returnValue = '';
};

// A file dropped outside an upload zone makes the browser open it in the tab
const swallowDrop = (event: React.DragEvent) => event.preventDefault();

/**
 * Covers the app while a PDF uploads (see utils/pdfUploadLock), so nothing
 * behind it - modal buttons, links, the sidebar - can be clicked, and keys
 * can't press a focused button or close a modal with Escape. Mounted once at
 * the app root.
 */
const PdfUploadBlocker: React.FC = () => {
  const { active, percent } = useSyncExternalStore(subscribePdfUploadLock, getPdfUploadLockState);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return undefined;
    const focusedBefore = document.activeElement as HTMLElement | null;
    overlayRef.current?.focus();
    KEY_EVENTS.forEach(type => window.addEventListener(type, swallowKey, true));
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => {
      KEY_EVENTS.forEach(type => window.removeEventListener(type, swallowKey, true));
      window.removeEventListener('beforeunload', warnBeforeUnload);
      if (focusedBefore?.isConnected) focusedBefore.focus();
    };
  }, [active]);

  if (!active) return null;

  const sent = percent === 100;
  return createPortal(
    <div
      ref={overlayRef}
      className="pdf-upload-blocker"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="pdf-upload-blocker-title"
      aria-describedby="pdf-upload-blocker-hint"
      tabIndex={-1}
      onDragOver={swallowDrop}
      onDrop={swallowDrop}
    >
      <div className="pdf-upload-blocker__card">
        <Spin size="large" />
        <div id="pdf-upload-blocker-title" className="pdf-upload-blocker__title" aria-live="polite">
          {sent ? 'Processing PDF…' : 'Uploading PDF…'}
        </div>
        <div id="pdf-upload-blocker-hint" className="pdf-upload-blocker__hint">
          Keep this page open until it finishes.
        </div>
        {percent !== null && !sent && (
          <Progress
            className="pdf-upload-blocker__progress"
            percent={percent}
            size="small"
            status="active"
            showInfo={false}
          />
        )}
      </div>
    </div>,
    document.body
  );
};

export default PdfUploadBlocker;
