/**
 * React Query hook for Water Mitigation photos
 * Provides automatic caching and refetching for photo data
 *
 * This hook fetches ALL photos (not just first page) to ensure consistency
 * with Photos tab which uses infinite scroll.
 */

import { useQuery } from '@tanstack/react-query';

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
}

interface UseWaterMitigationPhotosOptions {
  enabled?: boolean;
  pageSize?: number;  // Page size for each request (default 200)
  categoryFilter?: string;  // Filter by category
}

const mapPhotoResponse = (photo: any): WMPhoto => ({
  id: photo.id,
  file_path: photo.file_path,
  caption: photo.title || photo.caption,
  category: photo.category,
  taken_date: photo.captured_date || photo.taken_date,
  captured_date: photo.captured_date,
  description: photo.description,
  // Use thumbnail_url from API (CompanyCam CDN) - fastest option
  thumbnail_url: photo.thumbnail_url || photo.storage_thumbnail_url,
  preview_url: photo.preview_url,
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
      const allPhotos: WMPhoto[] = [];
      let currentPage = 1;
      let hasMorePages = true;

      // Fetch all pages to ensure we get all photos (consistent with Photos tab)
      while (hasMorePages) {
        // Build query params
        const params = new URLSearchParams({
          page_size: pageSize.toString(),
          page: currentPage.toString(),
        });

        if (categoryFilter && categoryFilter !== 'all') {
          params.append('category_filter', categoryFilter);
        }

        const response = await fetch(`/api/water-mitigation/jobs/${jobId}/photos?${params}`);
        if (!response.ok) {
          throw new Error(`Failed to load photos: ${response.status}`);
        }
        const data = await response.json();

        // API returns { items: [...], total, page, page_size, total_pages } format
        const items = data.items || data.photos || (Array.isArray(data) ? data : []);

        // Map response and add to all photos
        allPhotos.push(...items.map(mapPhotoResponse));

        // Check if there are more pages
        const totalPages = data.total_pages;
        if (totalPages && currentPage < totalPages) {
          currentPage++;
        } else {
          hasMorePages = false;
        }
      }

      return allPhotos;
    },
    staleTime: 5 * 60 * 1000,        // 5분간 신선한 데이터로 간주
    gcTime: 10 * 60 * 1000,          // 10분간 캐시 보관
    refetchOnWindowFocus: false,     // 탭 포커스시 자동 갱신 비활성화
    enabled: enabled && !!jobId,     // jobId가 있을 때만 쿼리 실행
  });
};

export default useWaterMitigationPhotos;
