/**
 * Photo Analysis Types
 *
 * Type definitions for the multi-room photo upload and AI analysis system.
 * Supports PHOTO mode in pack calculation with room-based photo grouping.
 */

import { RoomType, DensityLevel } from './pack-calculation';

// ============================================================================
// Enums
// ============================================================================

/**
 * Photo upload status for individual files
 */
export enum PhotoUploadStatus {
  PENDING = 'pending',
  UPLOADING = 'uploading',
  UPLOADED = 'uploaded',
  FAILED = 'failed',
}

/**
 * Analysis status for room photo groups
 */
export enum AnalysisStatus {
  PENDING = 'pending',
  ANALYZING = 'analyzing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

// ============================================================================
// Photo Management Types
// ============================================================================

/**
 * Individual photo file with upload metadata
 */
export interface PhotoFile {
  /** Unique client-side ID */
  id: string;
  /** Original File object */
  file: File;
  /** Preview URL (blob URL) */
  preview: string;
  /** Upload status */
  status: PhotoUploadStatus;
  /** Server-assigned ID after upload */
  serverId?: string;
  /** Error message if upload failed */
  error?: string;
  /** File size in bytes */
  size: number;
  /** MIME type */
  type: string;
}

/**
 * Room photo group with analysis results
 */
export interface PhotoGroup {
  /** Unique client-side ID */
  id: string;
  /** Room type */
  roomType: RoomType;
  /** Array of photos for this room */
  photos: PhotoFile[];
  /** Analysis status */
  analysisStatus: AnalysisStatus;
  /** Analysis result (null until analyzed) */
  result?: RoomAnalysisResult;
  /** Error message if analysis failed */
  error?: string;
  /** Timestamp when group was created */
  createdAt: Date;
  /** Timestamp when analysis was completed */
  analyzedAt?: Date;
}

// ============================================================================
// Analysis Result Types
// ============================================================================

/**
 * Detected item from photo analysis
 */
export interface DetectedItem {
  /** Item category */
  category: string;
  /** Item subcategory */
  subcategory: string;
  /** Estimated quantity */
  quantity: number;
  /** Recommended pack size */
  pack_size: number;
  /** Detection confidence (0-1) */
  confidence: number;
  /** Detailed packing instructions */
  packing_method?: string;
  /** Recommended box type (SMALL_BOX, MEDIUM_BOX, LARGE_BOX, etc.) */
  box_type?: string;
  /** Special handling requirements (FRAGILE, HEAVY, etc.) */
  special_handling?: string[];
}

/**
 * Room analysis result from AI
 */
export interface RoomAnalysisResult {
  /** Room type (from request) */
  room_type: RoomType;
  /** Detected density level */
  density_level: DensityLevel;
  /** List of detected items */
  estimated_items: DetectedItem[];
  /** Overall confidence score (0-100) */
  confidence_score: number;
  /** Detected visual features */
  detected_features: string[];
  /** Analysis timestamp */
  analyzed_at: Date;
  /** Total boxes estimate */
  total_boxes?: number;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

/**
 * Request to upload photos for a room
 */
export interface UploadPhotosRequest {
  /** Room type for these photos */
  room_type: RoomType;
  /** Array of photo files (FormData) */
  files: File[];
}

/**
 * Response from photo upload
 */
export interface UploadPhotosResponse {
  /** Server-assigned photo IDs */
  photo_ids: string[];
  /** Upload status message */
  message: string;
  /** Room group ID */
  room_id: string;
}

/**
 * Request to analyze room photos
 */
export interface AnalyzeRoomRequest {
  /** Room group ID */
  room_id: string;
  /** Photo IDs to analyze */
  photo_ids: string[];
  /** Optional density override */
  density_override?: DensityLevel;
}

/**
 * Response from room analysis
 */
export interface AnalyzeRoomResponse {
  /** Analysis result */
  result: RoomAnalysisResult;
  /** Processing time in seconds */
  processing_time: number;
}

/**
 * Request to analyze all rooms
 */
export interface AnalyzeAllRoomsRequest {
  /** Array of room photo groups */
  rooms: Array<{
    room_id: string;
    room_type: RoomType;
    photo_ids: string[];
  }>;
}

/**
 * Response from analyzing all rooms
 */
export interface AnalyzeAllRoomsResponse {
  /** Array of room analysis results */
  results: Array<{
    room_id: string;
    result: RoomAnalysisResult;
  }>;
  /** Overall confidence (average) */
  overall_confidence: number;
  /** Total boxes across all rooms */
  total_boxes: number;
  /** Total processing time */
  processing_time: number;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Photo validation result
 */
export interface PhotoValidation {
  /** Whether file is valid */
  valid: boolean;
  /** Error message if invalid */
  error?: string;
}

/**
 * Room group summary for display
 */
export interface RoomGroupSummary {
  /** Room type */
  roomType: RoomType;
  /** Number of photos */
  photoCount: number;
  /** Analysis status */
  status: AnalysisStatus;
  /** Confidence score if analyzed */
  confidence?: number;
  /** Total boxes if analyzed */
  totalBoxes?: number;
}

/**
 * Aggregate analysis summary
 */
export interface AggregateAnalysisSummary {
  /** Total rooms */
  totalRooms: number;
  /** Total photos */
  totalPhotos: number;
  /** Analyzed rooms count */
  analyzedRooms: number;
  /** Overall confidence (average) */
  averageConfidence: number;
  /** Total boxes estimate */
  totalBoxes: number;
  /** Total items count */
  totalItems: number;
}
