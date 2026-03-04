/**
 * Photo Analysis API Service
 *
 * API service for multi-room photo upload and AI-powered analysis.
 * Integrates with backend APIs for real photo upload and OpenAI-powered analysis.
 */

import api from './api';
import { RoomType, DensityLevel } from '../types/pack-calculation';
import {
  PhotoGroup,
  UploadPhotosResponse,
  AnalyzeRoomResponse,
  AnalyzeAllRoomsResponse,
  RoomAnalysisResult,
  DetectedItem,
} from '../types/photoAnalysis';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Analysis provider configuration
 * - 'openai': Use OpenAI GPT-4 Vision (costs API credits)
 * - 'mock': Use mock data for testing (free)
 */
export type AnalysisProvider = 'openai' | 'mock';

/**
 * Default provider - can be overridden per request
 */
const DEFAULT_PROVIDER: AnalysisProvider = 'openai'; // Use OpenAI GPT-4 Vision for real analysis

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get authentication token from localStorage
 */
const getAuthToken = (): string | null => {
  return localStorage.getItem('auth_token');
};

/**
 * Convert DetectedItem from backend format to frontend format
 */
const mapDetectedItem = (item: any): DetectedItem => ({
  category: item.category,
  subcategory: item.subcategory || '',
  quantity: item.quantity,
  pack_size: item.pack_size || 1,
  confidence: item.confidence,
  packing_method: item.packing_method || undefined,
  box_type: item.box_type || undefined,
  special_handling: item.special_handling || [],
});

/**
 * Map backend response to RoomAnalysisResult
 * Note: Backend returns confidence_score as 0-1, we convert to 0-100 for UI
 */
const mapAnalysisResponse = (response: any): RoomAnalysisResult => {
  // Backend returns 0-1, convert to 0-100 percentage
  const rawConfidence = response.confidence_score || 0;
  const confidencePercent = rawConfidence <= 1 ? rawConfidence * 100 : rawConfidence;

  return {
    room_type: response.room_type || RoomType.LIVING_ROOM,
    density_level: response.density_level || DensityLevel.MODERATE,
    estimated_items: (response.items || []).map(mapDetectedItem),
    confidence_score: Math.round(confidencePercent * 10) / 10, // Round to 1 decimal
    detected_features: response.detected_features || [],
    analyzed_at: new Date(),
    total_boxes: response.total_boxes || 0,
  };
};

// ============================================================================
// API Functions
// ============================================================================

/**
 * Upload room photos to backend storage
 *
 * @param roomType - Room type for classification
 * @param files - Array of photo files
 * @returns Promise with uploaded photo URLs
 */
export const uploadRoomPhotos = async (
  roomType: RoomType,
  files: File[]
): Promise<string[]> => {
  console.log(`[PhotoAnalysis] Uploading ${files.length} photos for ${roomType}...`);

  try {
    // Create FormData for multipart upload
    const formData = new FormData();

    // Add context and metadata
    formData.append('context', 'photo_analysis');
    formData.append('context_id', `room_${roomType}_${Date.now()}`);
    formData.append('category', 'room_photo');
    formData.append('description', `Photos for ${roomType} analysis`);

    // Add all files
    files.forEach((file) => {
      formData.append('files', file);
    });

    // Upload files
    const response = await api.post('/api/files/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    // Extract photo URLs from response
    const uploadedFiles = response.data.data || [];
    const photoUrls = uploadedFiles.map((file: any) => {
      // Use preview URL for API (backend will download from storage)
      return `${window.location.origin}/api/files/preview/${file.id}`;
    });

    console.log(`[PhotoAnalysis] Uploaded ${photoUrls.length} photos:`, photoUrls);
    return photoUrls;

  } catch (error: any) {
    console.error('[PhotoAnalysis] Upload failed:', error);
    throw new Error(
      error.response?.data?.detail ||
      error.message ||
      'Failed to upload photos'
    );
  }
};

/**
 * Analyze photos for a single room
 *
 * @param roomType - Room type for analysis
 * @param photoUrls - Array of photo URLs (from uploadRoomPhotos)
 * @param provider - Analysis provider ('openai' or 'mock')
 * @returns Promise with analysis result
 */
export const analyzeRoom = async (
  roomType: RoomType,
  photoUrls: string[],
  provider: AnalysisProvider = DEFAULT_PROVIDER
): Promise<AnalyzeRoomResponse> => {
  console.log(
    `[PhotoAnalysis] Analyzing ${roomType} with ${photoUrls.length} photos using ${provider}...`
  );

  try {
    const startTime = Date.now();

    // Call backend analysis API
    const response = await api.post('/api/photo-analysis/analyze', {
      room_type: roomType,
      photo_urls: photoUrls,
      provider: provider,
      use_cache: true,
    });

    const processingTime = (Date.now() - startTime) / 1000;

    const result: RoomAnalysisResult = mapAnalysisResponse(response.data);

    console.log(`[PhotoAnalysis] Analysis complete in ${processingTime.toFixed(2)}s`);
    console.log(`[PhotoAnalysis] Detected ${result.estimated_items.length} items`);
    console.log(`[PhotoAnalysis] Confidence: ${(result.confidence_score * 100).toFixed(1)}%`);

    return {
      result,
      processing_time: response.data.processing_time || processingTime,
    };

  } catch (error: any) {
    console.error('[PhotoAnalysis] Analysis failed:', error);
    throw new Error(
      error.response?.data?.detail ||
      error.message ||
      'Failed to analyze room photos'
    );
  }
};

/**
 * Upload and analyze room photos in one call
 *
 * Convenience function that combines upload + analysis
 *
 * @param roomType - Room type
 * @param files - Photo files to upload
 * @param provider - Analysis provider
 * @returns Promise with analysis result
 */
export const uploadAndAnalyzeRoom = async (
  roomType: RoomType,
  files: File[],
  provider: AnalysisProvider = DEFAULT_PROVIDER
): Promise<AnalyzeRoomResponse> => {
  console.log(`[PhotoAnalysis] Upload + Analyze ${roomType} (${files.length} photos)`);

  try {
    // Step 1: Upload photos
    const photoUrls = await uploadRoomPhotos(roomType, files);

    // Step 2: Analyze uploaded photos
    const result = await analyzeRoom(roomType, photoUrls, provider);

    return result;

  } catch (error: any) {
    console.error('[PhotoAnalysis] Upload + Analyze failed:', error);
    throw error;
  }
};

/**
 * Analyze all rooms in parallel
 *
 * @param rooms - Array of photo groups to analyze
 * @param provider - Analysis provider
 * @returns Promise with aggregate analysis results
 */
export const analyzeAllRooms = async (
  rooms: PhotoGroup[],
  provider: AnalysisProvider = DEFAULT_PROVIDER
): Promise<AnalyzeAllRoomsResponse> => {
  console.log(`[PhotoAnalysis] Analyzing all ${rooms.length} rooms in parallel...`);

  try {
    const startTime = Date.now();

    // Step 1: Upload all photos first
    const uploadPromises = rooms.map(async (room) => {
      const photoUrls = await uploadRoomPhotos(
        room.roomType,
        room.photos.map(p => p.file)
      );
      return { room, photoUrls };
    });

    const uploadResults = await Promise.all(uploadPromises);

    // Step 2: Analyze all rooms in parallel
    const analysisPromises = uploadResults.map(async ({ room, photoUrls }) => {
      const analysis = await analyzeRoom(room.roomType, photoUrls, provider);
      return {
        room_id: room.id,
        result: analysis.result,
      };
    });

    const results = await Promise.all(analysisPromises);

    // Step 3: Calculate aggregate statistics
    const totalBoxes = results.reduce((sum, r) => sum + (r.result.total_boxes || 0), 0);
    const totalConfidence = results.reduce((sum, r) => sum + r.result.confidence_score, 0);
    const overallConfidence = rooms.length > 0 ? Math.round((totalConfidence / rooms.length) * 100) : 0;
    const processingTime = (Date.now() - startTime) / 1000;

    console.log(`[PhotoAnalysis] All rooms analyzed in ${processingTime.toFixed(2)}s`);
    console.log(`[PhotoAnalysis] Total boxes: ${totalBoxes}`);
    console.log(`[PhotoAnalysis] Overall confidence: ${overallConfidence}%`);

    return {
      results,
      overall_confidence: overallConfidence,
      total_boxes: totalBoxes,
      processing_time: processingTime,
    };

  } catch (error: any) {
    console.error('[PhotoAnalysis] Batch analysis failed:', error);
    throw new Error(
      error.message || 'Failed to analyze all rooms'
    );
  }
};

/**
 * Get cached analysis result by cache key
 *
 * @param cacheKey - Cache key from previous analysis
 * @returns Promise with cached analysis or null if not found
 */
export const getCachedAnalysis = async (
  cacheKey: string
): Promise<AnalyzeRoomResponse | null> => {
  try {
    console.log(`[PhotoAnalysis] Looking up cached analysis: ${cacheKey}`);

    const response = await api.get(`/api/photo-analysis/cache/${cacheKey}`);

    const result: RoomAnalysisResult = mapAnalysisResponse(response.data);

    console.log(`[PhotoAnalysis] Cache hit: ${cacheKey}`);

    return {
      result,
      processing_time: 0, // Cached results are instant
    };

  } catch (error: any) {
    if (error.response?.status === 404) {
      console.log(`[PhotoAnalysis] Cache miss: ${cacheKey}`);
      return null;
    }
    console.error('[PhotoAnalysis] Cache lookup failed:', error);
    return null;
  }
};

/**
 * Get service health and information
 *
 * @returns Promise with service info
 */
export const getServiceInfo = async (): Promise<any> => {
  try {
    const response = await api.get('/api/photo-analysis/info');
    return response.data;
  } catch (error: any) {
    console.error('[PhotoAnalysis] Failed to get service info:', error);
    throw error;
  }
};

/**
 * Check if photo analysis service is healthy
 *
 * @returns Promise<boolean> - true if service is operational
 */
export const checkServiceHealth = async (): Promise<boolean> => {
  try {
    const response = await api.get('/api/photo-analysis/health');
    return response.data.status === 'healthy';
  } catch (error: any) {
    console.error('[PhotoAnalysis] Health check failed:', error);
    return false;
  }
};

// ============================================================================
// Legacy API Functions (Deprecated - kept for backward compatibility)
// ============================================================================

/**
 * @deprecated Use uploadRoomPhotos instead
 * Upload photos for a room (legacy interface)
 */
export const uploadPhotos = async (
  roomType: RoomType,
  files: File[]
): Promise<UploadPhotosResponse> => {
  console.warn('[PhotoAnalysis] uploadPhotos is deprecated, use uploadRoomPhotos instead');

  const photoUrls = await uploadRoomPhotos(roomType, files);

  return {
    room_id: `room_${Date.now()}`,
    photo_ids: photoUrls,
    message: `Successfully uploaded ${files.length} photos`,
  };
};

// ============================================================================
// Helper Functions (Validation, Preview)
// ============================================================================

/**
 * Validate photo file
 *
 * @param file - File to validate
 * @returns Validation result with error message if invalid
 */
export const validatePhotoFile = (file: File): { valid: boolean; error?: string } => {
  // Check file type
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
  if (!allowedTypes.includes(file.type)) {
    return {
      valid: false,
      error: 'Only JPG and PNG files are allowed',
    };
  }

  // Check file size (20MB max to match backend)
  const maxSize = 20 * 1024 * 1024; // 20MB in bytes
  if (file.size > maxSize) {
    return {
      valid: false,
      error: 'File size must be less than 20MB',
    };
  }

  return { valid: true };
};

/**
 * Create preview URL for photo
 *
 * @param file - File object
 * @returns Blob URL for preview
 */
export const createPhotoPreview = (file: File): string => {
  return URL.createObjectURL(file);
};

/**
 * Revoke preview URL to free memory
 *
 * @param url - Blob URL to revoke
 */
export const revokePhotoPreview = (url: string): void => {
  URL.revokeObjectURL(url);
};

// Export all as a single object
export const photoAnalysisAPI = {
  // Core API
  uploadRoomPhotos,
  analyzeRoom,
  uploadAndAnalyzeRoom,
  analyzeAllRooms,
  getCachedAnalysis,

  // Service info
  getServiceInfo,
  checkServiceHealth,

  // Legacy (deprecated)
  uploadPhotos,

  // Helpers
  validatePhotoFile,
  createPhotoPreview,
  revokePhotoPreview,
};

export default photoAnalysisAPI;
