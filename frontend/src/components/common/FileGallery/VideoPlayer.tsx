import React, { useEffect, useState } from 'react';
import { Button, Modal } from 'antd';
import { DownloadOutlined, PlayCircleFilled } from '@ant-design/icons';
import type { FileItem } from './types';
import { formatDuration, saveVideo } from './videoFiles';
import './VideoPlayer.css';

// While the server is making a copy this browser can play, how often to try again
const RETRY_MS = 15000;
// Nothing more is coming once it's ready: this is for a dropped connection
const RETRIES_ONCE_READY = 2;

interface VideoPlayerProps {
  file: FileItem;
  /** Fill the space it's in rather than leaving room for a modal's chrome */
  fill?: boolean;
  downloadUrl?: string;
}

/**
 * A video where a photo would go. An iPhone's HEVC plays straight away in browsers
 * that can decode it; in the others it waits here for the H.264 copy the server is
 * making, then starts. iPhone clips are portrait through a rotation flag, which the
 * video element applies by itself.
 */
export const VideoPlayer: React.FC<VideoPlayerProps> = ({ file, fill, downloadUrl }) => {
  const [unplayable, setUnplayable] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setUnplayable(false);
    setAttempt(0);
  }, [file.id]);

  // A copy that was never made, or a file that still won't play with one made
  const givenUp = file.videoStatus === 'failed'
    || (file.videoStatus === 'ready' && attempt >= RETRIES_ONCE_READY);

  useEffect(() => {
    if (!unplayable || givenUp) return undefined;
    const timer = setTimeout(() => {
      setUnplayable(false);
      setAttempt(a => a + 1);
    }, RETRY_MS);
    return () => clearTimeout(timer);
  }, [unplayable, givenUp, attempt]);

  // The address changes each try: a browser won't ask again for one it couldn't play
  const src = attempt > 0 && file.videoUrl ? `${file.videoUrl}?try=${attempt}` : file.videoUrl;

  return (
    <div className={`file-video${fill ? ' file-video--fill' : ''}`}>
      {!unplayable && src ? (
        <video
          key={src}
          className="file-video-element"
          src={src}
          poster={file.url}
          controls
          playsInline
          preload="metadata"
          aria-label={file.originalName}
          onError={() => setUnplayable(true)}
          // A codec the browser can't decode can leave the sound playing over nothing
          onLoadedMetadata={(e) => {
            if (e.currentTarget.videoWidth === 0) setUnplayable(true);
          }}
        />
      ) : (
        <div className="file-video-message" role="status">
          <strong>
            {givenUp ? "This video won't play here." : 'Getting this video ready…'}
          </strong>
          <span>
            {givenUp
              ? 'This browser can\'t play it, and a copy it can play isn\'t available. Download it to watch it.'
              : 'It was recorded in a format this browser can\'t play. A copy is being made, and it starts by itself once that\'s done.'}
          </span>
          {downloadUrl && (
            <Button icon={<DownloadOutlined />} onClick={() => saveVideo(downloadUrl)}>
              Download
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

/** The play mark over a video's poster, so it can't be taken for a photo */
export const VideoBadge: React.FC<{ file: FileItem }> = ({ file }) => {
  const duration = formatDuration(file.durationSeconds);
  return (
    <>
      <PlayCircleFilled className="file-video-badge" aria-hidden="true" />
      {duration && <span className="file-video-duration">{duration}</span>}
    </>
  );
};

interface VideoPreviewModalProps {
  file: FileItem | null;
  downloadUrl?: string;
  onClose: () => void;
}

export const VideoPreviewModal: React.FC<VideoPreviewModalProps> = ({ file, downloadUrl, onClose }) => (
  <Modal
    open={!!file}
    title={file?.originalName}
    footer={null}
    onCancel={onClose}
    width="80%"
    style={{ top: 20 }}
    destroyOnHidden
  >
    {file && <VideoPlayer file={file} downloadUrl={downloadUrl} />}
  </Modal>
);
