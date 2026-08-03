import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Progress, Button, message, Upload, Spin } from 'antd';
import { CameraOutlined, CloudUploadOutlined, CheckCircleFilled } from '@ant-design/icons';
import {
  validateLink,
  createSession,
  uploadFile,
  LinkInfo,
} from '../services/crewUploadService';
import { extractMetadata, getFingerprint } from '../utils/exifExtractor';
import { compressBatch } from '../utils/imageCompressor';
import {
  enqueueFiles,
  markCompleted,
  markFailed,
} from '../utils/uploadQueue';

const CONCURRENT_UPLOADS = 6;

const CrewUploadPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();

  // State
  const [linkInfo, setLinkInfo] = useState<LinkInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);

  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [compressProgress, setCompressProgress] = useState('');

  const [totalFiles, setTotalFiles] = useState(0);
  const [completedFiles, setCompletedFiles] = useState(0);
  const [failedFiles, setFailedFiles] = useState(0);
  const [allDone, setAllDone] = useState(false);

  // Refs for upload loop
  const fileQueueRef = useRef<File[]>([]);
  const activeUploadsRef = useRef(0);
  const abortRef = useRef(false);
  const wakeLockRef = useRef<any>(null);
  const sessionTokenRef = useRef<string | null>(null);
  const completedRef = useRef(0);
  const failedRef = useRef(0);
  // Cache geolocation once instead of per-file (saves up to 5s per file)
  const geoRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const geoFetchedRef = useRef(false);

  // ─── Validate link on mount ───
  useEffect(() => {
    if (!token) return;

    (async () => {
      try {
        const info = await validateLink(token);
        if (!info.valid) {
          setInvalid(true);
        } else {
          setLinkInfo(info);
        }
      } catch {
        setInvalid(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  // ─── Pre-fetch geolocation once on mount ───
  useEffect(() => {
    if (geoFetchedRef.current) return;
    geoFetchedRef.current = true;

    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        geoRef.current = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        };
      },
      () => { /* denied or unavailable */ },
      { timeout: 5000, maximumAge: 300000 },
    );
  }, []);

  // ─── beforeunload warning ───
  useEffect(() => {
    if (!uploading) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [uploading]);

  // ─── Wake Lock ───
  const requestWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      }
    } catch {
      // Wake Lock not supported or failed
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
  }, []);

  // ─── Upload worker ───
  const processQueue = useCallback(async () => {
    const currentSessionToken = sessionTokenRef.current;
    if (!token || !currentSessionToken) return;

    while (fileQueueRef.current.length > 0 && !abortRef.current) {
      if (activeUploadsRef.current >= CONCURRENT_UPLOADS) {
        await new Promise(r => setTimeout(r, 50));
        continue;
      }

      const file = fileQueueRef.current.shift();
      if (!file) break;

      activeUploadsRef.current++;
      const fingerprint = getFingerprint(file);

      (async () => {
        try {
          // Extract EXIF; use cached geo as fallback (no 5s wait)
          const metadata = await extractMetadataFast(file);
          const result = await uploadFile(token, currentSessionToken, file, fingerprint, metadata);

          markCompleted(fingerprint); // fire-and-forget
          if (!result.duplicate) completedRef.current++;
          setCompletedFiles(prev => prev + (result.duplicate ? 0 : 1));
        } catch (err: any) {
          markFailed(fingerprint, err.message || 'Unknown error'); // fire-and-forget
          failedRef.current++;
          setFailedFiles(prev => prev + 1);
        } finally {
          activeUploadsRef.current--;
        }
      })();
    }

    // Wait for all active uploads to finish
    while (activeUploadsRef.current > 0) {
      await new Promise(r => setTimeout(r, 100));
    }

    setUploading(false);
    setAllDone(true);
    releaseWakeLock();

    const done = completedRef.current;
    const fail = failedRef.current;
    if (fail > 0) {
      message.warning(`${done} photo${done !== 1 ? 's' : ''} uploaded, ${fail} failed`);
    } else {
      message.success(`${done} photo${done !== 1 ? 's' : ''} uploaded successfully!`);
    }
  }, [token, releaseWakeLock]);

  // Fast metadata: EXIF only (no geolocation API call per file)
  const extractMetadataFast = useCallback(async (file: File) => {
    const metadata = await extractMetadata(file);
    // If EXIF had no GPS, use cached geolocation (instant, no API call)
    if (metadata.latitude == null && geoRef.current) {
      metadata.latitude = geoRef.current.latitude;
      metadata.longitude = geoRef.current.longitude;
    }
    return metadata;
  }, []);

  // ─── File selection handler ───
  const handleFileSelect = useCallback(async (files: FileList | File[]) => {
    if (!token || !linkInfo) return;

    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    const remaining = linkInfo.max_files - (linkInfo.upload_count || 0);
    if (fileArray.length > remaining) {
      message.error(`Only ${remaining} uploads remaining`);
      return;
    }

    // Phase 1: Compress images (parallel, uses web workers)
    setCompressing(true);
    setCompressProgress(`Preparing 0 / ${fileArray.length}...`);

    let compressedFiles: File[];
    try {
      compressedFiles = await compressBatch(fileArray, (done, total) => {
        setCompressProgress(`Preparing ${done} / ${total}...`);
      });
    } catch {
      compressedFiles = fileArray; // fallback to originals
    }
    setCompressing(false);

    // Phase 2: Upload
    setUploading(true);
    setAllDone(false);
    setTotalFiles(compressedFiles.length);
    setCompletedFiles(0);
    setFailedFiles(0);
    completedRef.current = 0;
    failedRef.current = 0;
    abortRef.current = false;

    await requestWakeLock();

    try {
      const session = await createSession(token, compressedFiles.length);
      const newSessionToken = session.session_token;
      sessionTokenRef.current = newSessionToken;
      setSessionToken(newSessionToken);
      localStorage.setItem(`crew-upload-session-${token}`, newSessionToken);

      // Enqueue in IndexedDB (fire-and-forget, don't block upload start)
      enqueueFiles(compressedFiles, token);

      // Start upload immediately
      fileQueueRef.current = [...compressedFiles];
      processQueue();
    } catch (err: any) {
      message.error(err.message || 'Failed to create upload session.');
      setUploading(false);
      releaseWakeLock();
    }
  }, [token, linkInfo, requestWakeLock, releaseWakeLock, processQueue]);

  // ─── Render ───

  if (loading) {
    return (
      <div style={styles.container}>
        <Spin size="large" />
      </div>
    );
  }

  if (invalid || !linkInfo) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔗</div>
          <h2 style={{ margin: 0, color: '#ff4d4f' }}>
            Invalid Link
          </h2>
          <p style={{ color: '#8c8c8c', marginTop: 8 }}>
            This link has expired or is invalid.
          </p>
        </div>
      </div>
    );
  }

  const percent = totalFiles > 0
    ? Math.round(((completedFiles + failedFiles) / totalFiles) * 100)
    : 0;

  const successPercent = totalFiles > 0
    ? Math.round((completedFiles / totalFiles) * 100)
    : 0;

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {/* Address */}
        <div style={styles.address}>
          📍 {linkInfo.property_address || 'Job Upload'}
        </div>

        {linkInfo.label && (
          <div style={styles.label}>{linkInfo.label}</div>
        )}

        {/* Upload Button */}
        {!uploading && !allDone && !compressing && (
          <div style={styles.uploadSection}>
            <Upload
              accept="image/*,video/*"
              multiple
              showUploadList={false}
              beforeUpload={() => false}
              onChange={(info) => {
                if (info.fileList.length > 0) {
                  const files = info.fileList.map(f => f.originFileObj as File);
                  handleFileSelect(files);
                }
              }}
            >
              <Button
                type="primary"
                size="large"
                icon={<CameraOutlined />}
                style={styles.uploadButton}
              >
                Select Photos / Videos
              </Button>
            </Upload>
            <p style={styles.hint}>
              You can select up to {linkInfo.max_files} photos and videos at once
            </p>
          </div>
        )}

        {/* Compressing Phase */}
        {compressing && (
          <div style={styles.progressSection}>
            <Spin size="large" />
            <p style={{ marginTop: 16, fontSize: 15, color: '#1890ff', fontWeight: 500 }}>
              {compressProgress}
            </p>
            <p style={{ fontSize: 13, color: '#8c8c8c' }}>
              Compressing photos for faster upload...
            </p>
          </div>
        )}

        {/* Progress Section */}
        {(uploading || allDone) && (
          <div style={styles.progressSection}>
            {allDone && failedFiles === 0 ? (
              <CheckCircleFilled style={{ fontSize: 48, color: '#52c41a', marginBottom: 16 }} />
            ) : (
              <CloudUploadOutlined style={{ fontSize: 48, color: '#1890ff', marginBottom: 16 }} />
            )}

            <Progress
              type="circle"
              percent={percent}
              success={{ percent: successPercent }}
              size={160}
              strokeWidth={8}
              format={() => (
                <div>
                  <div style={{ fontSize: 28, fontWeight: 700 }}>
                    {completedFiles}
                  </div>
                  <div style={{ fontSize: 13, color: '#8c8c8c' }}>
                    / {totalFiles}
                  </div>
                </div>
              )}
            />

            <div style={styles.statsRow}>
              <span style={{ color: '#52c41a' }}>✓ {completedFiles} done</span>
              {failedFiles > 0 && (
                <span style={{ color: '#ff4d4f', marginLeft: 16 }}>✗ {failedFiles} failed</span>
              )}
            </div>

            {uploading && (
              <p style={styles.warningText}>
                Uploading in progress. Do not close this page.
              </p>
            )}

            {allDone && (
              <Button
                type="primary"
                size="large"
                style={{ marginTop: 24, ...styles.uploadButton }}
                onClick={async () => {
                  setAllDone(false);
                  setTotalFiles(0);
                  setCompletedFiles(0);
                  setFailedFiles(0);
                  sessionTokenRef.current = null;
                  setSessionToken(null);
                  localStorage.removeItem(`crew-upload-session-${token}`);
                  if (token) {
                    try {
                      const info = await validateLink(token);
                      if (info.valid) setLinkInfo(info);
                    } catch { /* ignore */ }
                  }
                }}
              >
                Upload More
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Styles ───
const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f0f2f5',
    padding: 16,
  },
  card: {
    background: '#fff',
    borderRadius: 16,
    padding: 32,
    width: '100%',
    maxWidth: 420,
    textAlign: 'center',
    boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
  },
  address: {
    fontSize: 18,
    fontWeight: 600,
    color: '#333',
    marginBottom: 8,
    wordBreak: 'break-word' as const,
  },
  label: {
    fontSize: 14,
    color: '#8c8c8c',
    marginBottom: 24,
  },
  uploadSection: {
    marginTop: 24,
  },
  uploadButton: {
    height: 56,
    fontSize: 18,
    borderRadius: 12,
    width: '100%',
    maxWidth: 320,
  },
  hint: {
    marginTop: 12,
    fontSize: 13,
    color: '#8c8c8c',
  },
  progressSection: {
    marginTop: 16,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 12,
  },
  statsRow: {
    fontSize: 16,
    fontWeight: 500,
    marginTop: 8,
  },
  warningText: {
    marginTop: 16,
    fontSize: 14,
    color: '#faad14',
    fontWeight: 500,
  },
};

export default CrewUploadPage;
