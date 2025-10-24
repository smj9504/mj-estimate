/**
 * React Query hook for Water Mitigation photos
 * Provides automatic caching and refetching for photo data
 */

import { useQuery } from '@tanstack/react-query';

interface Photo {
  id: string;
  file_path: string;
  caption?: string;
  category?: string;
  taken_date?: string;
  description?: string;
  thumbnail_path?: string;
}

export const useWaterMitigationPhotos = (jobId: string, enabled: boolean = true) => {
  return useQuery<Photo[]>({
    queryKey: ['water-mitigation-photos', jobId],
    queryFn: async () => {
      const response = await fetch(`/api/water-mitigation/jobs/${jobId}/photos`);
      if (!response.ok) {
        throw new Error(`Failed to load photos: ${response.status}`);
      }
      const data = await response.json();
      // API returns array directly
      return Array.isArray(data) ? data : (data.photos || []);
    },
    staleTime: 5 * 60 * 1000,        // 5분간 신선한 데이터로 간주
    gcTime: 10 * 60 * 1000,          // 10분간 캐시 보관
    refetchOnWindowFocus: false,     // 탭 포커스시 자동 갱신 비활성화
    enabled: enabled && !!jobId,     // jobId가 있을 때만 쿼리 실행
  });
};

export default useWaterMitigationPhotos;
