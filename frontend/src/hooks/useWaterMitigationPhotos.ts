/**
 * React Query hook for Water Mitigation photos
 * Provides automatic caching and refetching for photo data
 */

import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

export interface WMPhoto {
  id: string;
  file_path: string;
  caption?: string;
  category?: string;
  taken_date?: string;
  captured_date?: string;
  description?: string;
  thumbnail_url?: string;  // CompanyCam CDN thumbnail URL (fast)
  preview_url?: string;    // Preview URL from API
  location_level?: string;  // Location tag: floor/level (e.g. "Basement", "1st Floor")
  location_room?: string;   // Location tag: room name (e.g. "Kitchen")
}

interface UseWaterMitigationPhotosOptions {
  enabled?: boolean;
  pageSize?: number;  // Default 50, max 200 - use higher for document creation
  categoryFilter?: string;  // Filter by category
}

const resolveUrl = (url: string | undefined, baseURL: string): string | undefined => {
  if (!url) return undefined;
  return url.startsWith('http') ? url : `${baseURL}${url}`;
};

const mapPhotoResponse = (photo: any, baseURL: string): WMPhoto => ({
  id: photo.id,
  file_path: photo.file_path,
  caption: photo.title || photo.caption,
  category: photo.category,
  taken_date: photo.captured_date || photo.taken_date,
  captured_date: photo.captured_date,
  description: photo.description,
  // Use thumbnail_url from API (CompanyCam CDN) - fastest option
  // Prepend baseURL for relative paths (production: backend on different domain)
  thumbnail_url: resolveUrl(photo.thumbnail_url || photo.storage_thumbnail_url, baseURL),
  preview_url: resolveUrl(photo.preview_url, baseURL),
  location_level: photo.location_level,
  location_room: photo.location_room,
});

export const useWaterMitigationPhotos = (
  jobId: string, 
  options: UseWaterMitigationPhotosOptions | boolean = true
) => {
  // Handle legacy boolean parameter for backwards compatibility
  const opts: UseWaterMitigationPhotosOptions = typeof options === 'boolean' 
    ? { enabled: options } 
    : options;
  
  const { enabled = true, pageSize = 200, categoryFilter } = opts;

  return useQuery<WMPhoto[]>({
    queryKey: ['water-mitigation-photos', jobId, pageSize, categoryFilter],
    queryFn: async () => {
      // Fetch ALL pages to ensure no photos are missing
      let allItems: any[] = [];
      let page = 1;
      let totalPages = 1;

      do {
        const params = new URLSearchParams({
          page_size: pageSize.toString(),
          page: String(page),
        });

        if (categoryFilter && categoryFilter !== 'all') {
          params.append('category_filter', categoryFilter);
        }

        const response = await api.get(`/api/water-mitigation/jobs/${jobId}/photos?${params}`);
        const data = response.data;

        const items = data.items || data.photos || (Array.isArray(data) ? data : []);
        allItems.push(...items);

        // total_pages is only returned on page 1
        if (page === 1 && data.total_pages) {
          totalPages = data.total_pages;
        }
        page++;
      } while (page <= totalPages);

      const baseURL = api.defaults.baseURL || '';
      return allItems.map((p) => mapPhotoResponse(p, baseURL));
    },
    staleTime: 5 * 60 * 1000,        // 5분간 신선한 데이터로 간주
    gcTime: 10 * 60 * 1000,          // 10분간 캐시 보관
    refetchOnWindowFocus: false,     // 탭 포커스시 자동 갱신 비활성화
    enabled: enabled && !!jobId,     // jobId가 있을 때만 쿼리 실행
  });
};

export default useWaterMitigationPhotos;
