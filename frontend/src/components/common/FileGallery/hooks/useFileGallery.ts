import { useState, useCallback } from 'react';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { message } from 'antd';
import { FileItem, FileContext, FileCategory } from '../types';
import { fileService } from '../../../../services/fileService';
import api from '../../../../services/api';

interface UseFileGalleryProps {
  context: FileContext;
  contextId?: string;
  fileCategory?: FileCategory;
  onUpload?: (files: File[], category?: string) => Promise<void>;
  onDelete?: (fileId: string) => Promise<void>;
  enableInfiniteScroll?: boolean;
  pageSize?: number;
}

export const useFileGallery = ({
  context,
  contextId,
  fileCategory,
  onUpload,
  onDelete,
  enableInfiniteScroll = false,
  pageSize = 20  // Optimized default: smaller initial load for faster perceived performance
}: UseFileGalleryProps) => {
  const queryClient = useQueryClient();
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});

  // Infinite scroll query for water-mitigation photos
  const infiniteQuery = useInfiniteQuery({
    queryKey: ['files-infinite', context, contextId, fileCategory, pageSize],
    queryFn: async ({ pageParam = 1 }) => {
      if (!contextId) return { items: [], total: 0, page: 1, page_size: pageSize, total_pages: 1 };

      // Use pagination API for water-mitigation photos
      if (context === 'water-mitigation' && fileCategory === 'image') {
        // Dynamic page size: smaller for first page (faster initial load), larger for subsequent pages
        const dynamicPageSize = pageParam === 1 ? 20 : 30;
        
        const params = {
          page: pageParam,
          page_size: dynamicPageSize,
          sort_by: 'captured_date',
          sort_order: 'desc'
        };

        const response = await api.get(`/api/water-mitigation/jobs/${contextId}/photos`, { params });
        const data = response.data;

        // Get API base URL for production photo preview URLs
        const baseURL = api.defaults.baseURL || '';

        // Convert to FileItem format - use preview URLs from API response (optimized)
        const items = data.items.map((photo: any) => {
          // Use preview_url from API response (already optimized by backend)
          // Fallback to thumbnail_url or default preview endpoint
          const imageUrl = photo.preview_url
            ? (photo.preview_url.startsWith('http') ? photo.preview_url : `${baseURL}${photo.preview_url}`)
            : photo.thumbnail_url
            ? (photo.thumbnail_url.startsWith('http') ? photo.thumbnail_url : `${baseURL}${photo.thumbnail_url}`)
            : `${baseURL}/api/water-mitigation/photos/${photo.id}/preview?size=web`;

          const thumbUrl = photo.thumbnail_url
            ? (photo.thumbnail_url.startsWith('http') ? photo.thumbnail_url : `${baseURL}${photo.thumbnail_url}`)
            : imageUrl;

          // Original full-resolution URL for preview modal
          const originalUrl = photo.url
            ? (photo.url.startsWith('http') ? photo.url : `${baseURL}${photo.url}`)
            : `${baseURL}/api/water-mitigation/photos/${photo.id}/preview?size=original`;

          return {
            id: photo.id,
            filename: photo.file_name,
            originalName: photo.file_name,
            url: imageUrl,  // Optimized web preview for grid display
            fileUrl: originalUrl,  // Original high-res for modal preview
            thumbnailUrl: thumbUrl,  // Small thumbnail
            contentType: photo.mime_type || 'image/jpeg',
            mimeType: photo.mime_type,
            size: photo.file_size || 0,
            category: photo.category || '',
            description: photo.description || '',
            uploadDate: photo.captured_date || photo.created_at,
            createdAt: photo.created_at,
            updatedAt: photo.updated_at
          };
        });

        return {
          items,
          total: data.total,
          page: data.page,
          page_size: data.page_size,
          total_pages: data.total_pages
        };
      }

      // Fallback to regular API for other contexts
      const result = await fileService.getFiles(context, contextId, undefined, fileCategory);
      return {
        items: result,
        total: result.length,
        page: 1,
        page_size: result.length,
        total_pages: 1
      };
    },
    getNextPageParam: (lastPage) => {
      // If total_pages is None (performance optimization), continue loading
      // until we get an empty page
      if (lastPage.total_pages === null || lastPage.total_pages === undefined) {
        return lastPage.items.length > 0 ? lastPage.page + 1 : undefined;
      }
      if (lastPage.page < lastPage.total_pages) {
        return lastPage.page + 1;
      }
      return undefined;
    },
    initialPageParam: 1,
    enabled: !!contextId && enableInfiniteScroll,
    staleTime: 5 * 60 * 1000, // 5 minutes - data is fresh for longer
    gcTime: 10 * 60 * 1000, // 10 minutes - keep cache longer to preserve scroll position
    maxPages: undefined, // No limit - keep all loaded pages for smooth scrolling
    refetchOnWindowFocus: false, // Don't refetch when window regains focus
    refetchOnMount: false, // Don't refetch on mount if data exists
  });

  // Regular query for non-infinite scroll
  const regularQuery = useQuery<FileItem[]>({
    queryKey: ['files', context, contextId, fileCategory],
    queryFn: async () => {
      if (!contextId) return [];
      const result = await fileService.getFiles(context, contextId, undefined, fileCategory);
      console.log('🔍 Fetched files:', {
        context,
        contextId,
        fileCategory,
        count: result?.length || 0,
        files: result
      });
      return result;
    },
    enabled: !!contextId && !enableInfiniteScroll,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
  });

  // Select the appropriate query based on mode
  // For infinite scroll, keep all loaded pages to preserve scroll position
  // This allows smooth scrolling up and down without losing data
  const files = enableInfiniteScroll
    ? (infiniteQuery.data?.pages
        .flatMap(page => page.items) || []) // Keep all pages for smooth bidirectional scrolling
    : (regularQuery.data || []);

  const loading = enableInfiniteScroll ? infiniteQuery.isLoading : regularQuery.isLoading;
  const error = enableInfiniteScroll ? infiniteQuery.error : regularQuery.error;
  const refetch = enableInfiniteScroll ? infiniteQuery.refetch : regularQuery.refetch;

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async ({ files, category }: { files: File[]; category?: string }) => {
      if (onUpload) {
        return await onUpload(files, category);
      }

      if (!contextId) {
        throw new Error('Context ID is required for file upload');
      }

      const result = await fileService.uploadFiles(files, context, contextId, category || 'general');
      return result;
    },
    onSuccess: async () => {
      // Invalidate and refetch files immediately
      await queryClient.invalidateQueries({
        queryKey: ['files', context, contextId, fileCategory]
      });

      // Also invalidate file count queries
      await queryClient.invalidateQueries({
        queryKey: ['work-order-images-count', contextId]
      });
      await queryClient.invalidateQueries({
        queryKey: ['work-order-documents-count', contextId]
      });

      // Force refetch to ensure UI updates
      await refetch();

      setUploadProgress({});
    },
    onError: (error: any) => {
      console.error('Upload failed:', error);
      message.error(`Upload failed: ${error.message || 'Unknown error'}`);
      setUploadProgress({});
    }
  });

  // Delete mutation (uses trash for water-mitigation photos, hard delete for others)
  const deleteMutation = useMutation({
    mutationFn: async (fileId: string) => {
      if (onDelete) {
        return await onDelete(fileId);
      }

      // Use water-mitigation specific API for WM photos (images only) - trash instead of delete
      if (context === 'water-mitigation' && fileCategory === 'image') {
        const { default: waterMitigationService } = await import('../../../../services/waterMitigationService');
        await waterMitigationService.photos.trash(fileId);  // Changed from delete to trash
      } else {
        // Use general file API for documents or other contexts
        await fileService.deleteFile(fileId);
      }
    },
    onSuccess: () => {
      // Invalidate and refetch files
      queryClient.invalidateQueries({
        queryKey: ['files', context, contextId, fileCategory]
      });
      queryClient.invalidateQueries({
        queryKey: ['files-infinite', context, contextId, fileCategory]
      });

      // Also invalidate file count queries
      queryClient.invalidateQueries({
        queryKey: ['work-order-images-count', contextId]
      });
      queryClient.invalidateQueries({
        queryKey: ['work-order-documents-count', contextId]
      });

      // Invalidate trashed photos query
      queryClient.invalidateQueries({
        queryKey: ['trashed-photos', contextId]
      });

      message.success('File moved to trash');
    },
    onError: (error: any) => {
      console.error('Trash failed:', error);
      message.error(`Failed to move to trash: ${error.message || 'Unknown error'}`);
    }
  });

  // Category update mutation
  const categoryMutation = useMutation({
    mutationFn: async ({ fileId, category }: { fileId: string; category: string }) => {
      // Use water-mitigation specific API for WM photos (images only)
      if (context === 'water-mitigation' && fileCategory === 'image') {
        const { default: waterMitigationService } = await import('../../../../services/waterMitigationService');
        await waterMitigationService.photos.updateCategory(fileId, category);
      } else {
        // Use general file API for documents or other contexts
        await fileService.updateFile(fileId, { category });
      }
    },
    onSuccess: async () => {
      // Invalidate and refetch files
      await queryClient.invalidateQueries({
        queryKey: ['files', context, contextId, fileCategory]
      });

      // Force refetch to ensure UI updates
      await refetch();

      message.success('File category updated');
    },
    onError: (error: any) => {
      console.error('Category update failed:', error);
      message.error(`Category update failed: ${error.message || 'Unknown error'}`);
    }
  });

  // Upload files function
  const uploadFiles = useCallback(async (files: File[], category?: string) => {
    uploadMutation.mutate({ files, category });
  }, [uploadMutation]);

  // Delete file function
  const deleteFile = useCallback(async (fileId: string) => {
    deleteMutation.mutate(fileId);
  }, [deleteMutation]);

  // Update file category function
  const updateFileCategory = useCallback(async (fileId: string, category: string) => {
    categoryMutation.mutate({ fileId, category });
  }, [categoryMutation]);

  return {
    files,
    loading,
    error,
    uploadFiles,
    deleteFile,
    updateFileCategory,
    uploading: uploadMutation.isPending,
    deleting: deleteMutation.isPending,
    uploadProgress,
    refetch,
    // Infinite scroll specific
    hasNextPage: enableInfiniteScroll ? infiniteQuery.hasNextPage : false,
    fetchNextPage: enableInfiniteScroll ? infiniteQuery.fetchNextPage : undefined,
    isFetchingNextPage: enableInfiniteScroll ? infiniteQuery.isFetchingNextPage : false,
  };
};