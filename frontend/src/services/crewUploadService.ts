/**
 * Crew Upload API service
 * Public endpoints - no auth token needed
 */

const API_BASE = '/api/crew-upload';

export interface LinkInfo {
  valid: boolean;
  property_address?: string;
  job_id?: string;
  label?: string;
  crew_name?: string;
  max_files: number;
  max_file_size_mb: number;
  upload_count: number;
  expires_at?: string;
}

export interface SessionInfo {
  session_token: string;
  session_id: string;
}

export interface SessionStatus {
  session_token: string;
  total_files: number;
  completed_files: number;
  failed_files: number;
  completed_fingerprints: string[];
  status: string;
}

export interface FileUploadResult {
  file_id: string;
  filename: string;
  size: number;
  fingerprint: string;
  completed_files: number;
  total_files: number;
  duplicate?: boolean;
}

/** Validate upload link and get job info */
export async function validateLink(token: string): Promise<LinkInfo> {
  const res = await fetch(`${API_BASE}/${token}`);
  if (!res.ok) throw new Error('Failed to validate link');
  return res.json();
}

/** Create an upload session for tracking progress */
export async function createSession(
  token: string,
  totalFiles: number,
  deviceInfo?: string,
): Promise<SessionInfo> {
  const res = await fetch(`${API_BASE}/${token}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      total_files: totalFiles,
      device_info: deviceInfo || navigator.userAgent,
    }),
  });
  if (!res.ok) throw new Error('Failed to create session');
  return res.json();
}

/** Get session status (for resume after interruption) */
export async function getSessionStatus(
  token: string,
  sessionToken: string,
): Promise<SessionStatus> {
  const res = await fetch(`${API_BASE}/${token}/session/${sessionToken}`);
  if (!res.ok) throw new Error('Failed to get session status');
  return res.json();
}

/** Upload a single file */
export async function uploadFile(
  token: string,
  sessionToken: string,
  file: File,
  fingerprint: string,
  metadata?: {
    latitude?: number;
    longitude?: number;
    captured_at?: string;
    device_model?: string;
  },
): Promise<FileUploadResult> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('session_token', sessionToken);
  formData.append('fingerprint', fingerprint);

  if (metadata?.latitude != null) formData.append('latitude', String(metadata.latitude));
  if (metadata?.longitude != null) formData.append('longitude', String(metadata.longitude));
  if (metadata?.captured_at) formData.append('captured_at', metadata.captured_at);
  if (metadata?.device_model) formData.append('device_model', metadata.device_model);

  const res = await fetch(`${API_BASE}/${token}/files`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Upload failed' }));
    throw new Error(err.detail || 'Upload failed');
  }

  return res.json();
}
