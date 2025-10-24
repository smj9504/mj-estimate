/**
 * React Query infinite scroll hook for Water Mitigation photos
 * Provides automatic pagination and infinite loading for photo data
 */

import { useInfiniteQuery } from '@tanstack/react-query';

interface Photo {
  id: string;
  file_path: string;
  caption?: string;
  category?: string;
  captured_date?: string;
  description?: string;
  thumbnail_path?: string;
}

interface PhotoPageResponse {
  items: Photo[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

interface UseInfinitePhotosOptions {
  jobId: string;
  enabled?: boolean;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export const useInfiniteWaterMitigationPhotos = ({
  jobId,
  enabled = true,
  pageSize = 50,
  sortBy = 'captured_date',
  sortOrder = 'desc'
}: UseInfinitePhotosOptions) => {
  return useInfiniteQuery<PhotoPageResponse>({
    queryKey: ['water-mitigation-photos-infinite', jobId, pageSize, sortBy, sortOrder],
    queryFn: async ({ pageParam = 1 }) => {
      const params = new URLSearchParams({
        page: String(pageParam),
        page_size: String(pageSize),
        sort_by: sortBy,
        sort_order: sortOrder
      });

      const response = await fetch(`/api/water-mitigation/jobs/${jobId}/photos?${params}`);
      if (!response.ok) {
        throw new Error(`Failed to load photos: ${response.status}`);
      }
      const data = await response.json();
      return data;
    },
    getNextPageParam: (lastPage) => {
      // If there are more pages, return the next page number
      if (lastPage.page < lastPage.total_pages) {
        return lastPage.page + 1;
      }
      // Otherwise, return undefined to indicate no more pages
      return undefined;
    },
    initialPageParam: 1,
    staleTime: 5 * 60 * 1000,        // 5분간 신선한 데이터로 간주
    gcTime: 10 * 60 * 1000,          // 10분간 캐시 보관
    refetchOnWindowFocus: false,     // 탭 포커스시 자동 갱신 비활성화
    enabled: enabled && !!jobId,     // jobId가 있을 때만 쿼리 실행
  });
};

export default useInfiniteWaterMitigationPhotos;
