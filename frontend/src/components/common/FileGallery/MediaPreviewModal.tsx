import React from 'react';
import { Image, Modal } from 'antd';
import { FileItem } from './types';

// Videos share the photo gallery; they play in the preview instead of showing as an image
export const isVideoFile = (file: FileItem): boolean =>
  (file.contentType || file.mimeType || '').startsWith('video/');

interface MediaPreviewModalProps {
  open: boolean;
  file: FileItem | null;
  onClose: () => void;
}

const mediaStyle: React.CSSProperties = {
  maxWidth: '100%',
  maxHeight: 'calc(100vh - 160px)',
  objectFit: 'contain'
};

// Full-size preview of a gallery item: the original image, or the video playing.
// fileUrl = original full resolution (the video itself), url = web preview (a video's poster frame)
const MediaPreviewModal: React.FC<MediaPreviewModalProps> = ({ open, file, onClose }) => (
  <Modal
    open={open}
    title={file?.originalName}
    footer={null}
    onCancel={onClose}
    width="80%"
    style={{ top: 20 }}
    styles={{ body: { textAlign: 'center' } }}
    // Unmount on close so a playing video stops
    destroyOnHidden
  >
    {file && (isVideoFile(file) ? (
      <video
        key={file.id}
        src={file.fileUrl || file.url}
        poster={file.url}
        controls
        autoPlay
        playsInline
        preload="metadata"
        style={{ ...mediaStyle, width: '100%', background: '#000' }}
      />
    ) : (
      <Image
        src={file.fileUrl || file.url}
        alt={file.originalName}
        style={mediaStyle}
        preview={false}
      />
    ))}
  </Modal>
);

export default MediaPreviewModal;
