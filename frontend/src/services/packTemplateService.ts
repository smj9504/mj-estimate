/**
 * Pack Template API Service (Simplified)
 *
 * Only contains density estimation functionality for SmartEstimation component.
 */

import api from './api';
import {
  DensityEstimationRequest,
  DensityEstimationResponse,
  RoomType,
  DensityLevel,
} from '../types/pack-calculation';

const API_BASE_URL = '/api/pack-calculation';

// ============================================================================
// Density Estimation API
// ============================================================================

/**
 * Estimate pack items based on room type and density level
 */
export const estimateByDensity = async (
  request: DensityEstimationRequest
): Promise<DensityEstimationResponse> => {
  try {
    const response = await api.post<DensityEstimationResponse>(
      `${API_BASE_URL}/estimate/density`,
      request
    );
    return response.data;
  } catch (error: any) {
    console.error('[PackTemplate] Density estimation failed:', error);
    if (error.response?.status === 400) {
      throw new Error(
        error.response?.data?.detail || 'Invalid estimation parameters'
      );
    }
    throw new Error(
      error.response?.data?.detail || 'Density estimation failed'
    );
  }
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert RoomType enum to human-readable label
 */
export const getRoomTypeLabel = (roomType: RoomType | string): string => {
  const labels: Record<string, string> = {
    [RoomType.LIVING_ROOM]: 'Living Room',
    [RoomType.BEDROOM]: 'Bedroom',
    [RoomType.KITCHEN]: 'Kitchen',
    [RoomType.DINING_ROOM]: 'Dining Room',
    [RoomType.HOME_OFFICE]: 'Home Office',
    [RoomType.BATHROOM]: 'Bathroom',
    [RoomType.GARAGE]: 'Garage',
    [RoomType.BASEMENT]: 'Basement',
    [RoomType.ATTIC]: 'Attic',
  };
  return labels[roomType] || roomType.toString();
};

/**
 * Get all room type options for Select component
 */
export const getAllRoomTypeOptions = (): { value: string; label: string }[] => {
  return Object.values(RoomType).map((roomType) => ({
    value: roomType,
    label: getRoomTypeLabel(roomType),
  }));
};

/**
 * Convert DensityLevel enum to human-readable label with description
 */
export const getDensityLevelInfo = (
  densityLevel: DensityLevel | string
): { label: string; description: string; multiplier: number } => {
  const info: Record<
    string,
    { label: string; description: string; multiplier: number }
  > = {
    [DensityLevel.MINIMAL]: {
      label: 'Minimal',
      description: 'Sparse furnishings, few belongings',
      multiplier: 0.7,
    },
    [DensityLevel.MODERATE]: {
      label: 'Moderate',
      description: 'Average furnishings, typical household',
      multiplier: 1.0,
    },
    [DensityLevel.FULL]: {
      label: 'Full',
      description: 'Well-furnished, many belongings',
      multiplier: 1.4,
    },
    [DensityLevel.PACKED]: {
      label: 'Packed',
      description: 'Heavily furnished, maximum storage utilization',
      multiplier: 1.8,
    },
  };
  return (
    info[densityLevel] || {
      label: densityLevel.toString(),
      description: '',
      multiplier: 1.0,
    }
  );
};
