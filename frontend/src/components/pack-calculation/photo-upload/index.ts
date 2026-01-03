/**
 * Photo Upload Module - Barrel Export
 *
 * Centralized exports for the photo upload system components.
 */

export { default as PhotoUploadManager } from './PhotoUploadManager';
export { default as RoomPhotoGroup } from './RoomPhotoGroup';

// Re-export types for convenience
export type {
  PhotoGroup,
  PhotoFile,
  RoomAnalysisResult,
  PhotoUploadStatus,
  AnalysisStatus,
  AggregateAnalysisSummary,
} from '../../../types/photoAnalysis';
