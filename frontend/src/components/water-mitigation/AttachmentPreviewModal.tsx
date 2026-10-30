/**
 * Attachment Preview Modal for Water Mitigation
 * Shows a document from an email's attachment list, so it can be checked before
 * the email goes out. Rendered inside the send dialog, which opens it on top of
 * itself and keeps everything typed in it.
 */

import React, { useEffect, useState } from 'react';
import { Alert, Button, Modal, Spin, Typography } from 'antd';
import { DownloadOutlined, ExportOutlined, FileOutlined } from '@ant-design/icons';
import { isAxiosError } from 'axios';

const { Text } = Typography;

export interface AttachmentToPreview {
  title: string;
  // Name for saving a file that can't be shown; defaults to the title
  filename?: string;
  load: () => Promise<Blob>;
}

interface LoadedFile {
  url: string;
  kind: 'pdf' | 'image' | 'other';
}

// Uploads aren't always labelled with their real type, so a PDF is recognised
// by its first bytes. SVGs count as "other": a blob URL shares the app's origin,
// and one opened in a tab could run scripts.
const toLoadedFile = async (blob: Blob): Promise<LoadedFile> => {
  if ((await blob.slice(0, 5).text()) === '%PDF-') {
    return { url: URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })), kind: 'pdf' };
  }
  const isImage = blob.type.startsWith('image/') && blob.type !== 'image/svg+xml';
  return { url: URL.createObjectURL(blob), kind: isImage ? 'image' : 'other' };
};

interface AttachmentPreviewModalProps {
  attachment: AttachmentToPreview | null;
  onClose: () => void;
}

const AttachmentPreviewModal: React.FC<AttachmentPreviewModalProps> = ({ attachment, onClose }) => {
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!attachment) return undefined;
    let closed = false;
    let url: string | null = null;

    attachment.load().then(toLoadedFile).then((loaded) => {
      if (closed) {
        URL.revokeObjectURL(loaded.url);
        return;
      }
      url = loaded.url;
      setFile(loaded);
    }).catch((err) => {
      console.error('Failed to load attachment preview:', err);
      if (closed) return;
      // An axios error here has no message from the API, only "status code 500"
      setError(err instanceof Error && !isAxiosError(err) ? err.message : 'Failed to load the document.');
    });

    return () => {
      closed = true;
      if (url) URL.revokeObjectURL(url);
      setFile(null);
      setError(null);
    };
  }, [attachment]);

  return (
    <Modal
      title={attachment?.title}
      open={!!attachment}
      onCancel={onClose}
      width="90vw"
      style={{ top: 20 }}
      footer={[
        <Button key="close" onClick={onClose}>Close</Button>,
        // Phone browsers often won't show a PDF inside the page
        file && file.kind !== 'other' && (
          <Button key="open" icon={<ExportOutlined />} href={file.url} target="_blank">
            Open in new tab
          </Button>
        ),
      ]}
      styles={{ body: { height: 'calc(90vh - 110px)', padding: 0, overflow: 'auto' } }}
    >
      {error && <Alert type="error" showIcon message={error} />}
      {!error && !file && (
        <div style={{ textAlign: 'center', padding: 50 }}>
          <Spin size="large" />
          <div style={{ marginTop: 12 }}>Loading document...</div>
        </div>
      )}
      {file?.kind === 'pdf' && (
        <iframe
          src={file.url}
          title={attachment?.title}
          style={{ display: 'block', width: '100%', height: '100%', border: 'none' }}
        />
      )}
      {file?.kind === 'image' && (
        <img
          src={file.url}
          alt={attachment?.title}
          style={{ display: 'block', maxWidth: '100%', margin: '0 auto' }}
        />
      )}
      {file?.kind === 'other' && (
        <div style={{ textAlign: 'center', padding: 50 }}>
          <FileOutlined style={{ fontSize: 32, color: '#787774' }} />
          <div style={{ margin: '12px 0' }}>
            <Text type="secondary">This file type can't be shown here.</Text>
          </div>
          <Button
            icon={<DownloadOutlined />}
            href={file.url}
            download={attachment?.filename || attachment?.title}
          >
            Download
          </Button>
        </div>
      )}
    </Modal>
  );
};

// An entry in an email's attachment list; clicking it opens the document
export const AttachmentLink: React.FC<{
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}> = ({ label, icon, onClick }) => (
  <Button
    type="link"
    size="small"
    icon={icon}
    title={label}
    onClick={onClick}
    style={{ padding: 0, height: 'auto', fontSize: 12, minWidth: 0, maxWidth: '100%' }}
  >
    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
  </Button>
);

export default AttachmentPreviewModal;
