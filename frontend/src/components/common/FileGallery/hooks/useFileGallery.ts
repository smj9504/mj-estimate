import { useState, useEffect, useCallback } from 'react';
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
  pageSize = 50
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
        const params = {
          page: pageParam,
          page_size: pageSize,
          sort_by: 'captured_date',
          sort_order: 'desc'
        };

        const response = await api.get(`/api/water-mitigation/jobs/${contextId}/photos`, { params });
        const data = response.data;

        // Get API base URL for production photo preview URLs
        const baseURL = api.defaults.baseURL || '';

        // Convert to FileItem format
        const items = data.items.map((photo: any) => {
          // Use absolute URL for image preview (supports both dev and production)
          const imageUrl = `${baseURL}/api/water-mitigation/photos/${photo.id}/preview`;

          return {
            id: photo.id,
            filename: photo.file_name,
            originalName: photo.file_name,
            url: imageUrl,
            fileUrl: imageUrl,
            thumbnailUrl: imageUrl, // Use same endpoint (backend can optimize if needed)
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
      if (lastPage.page < lastPage.total_pages) {
        return lastPage.page + 1;
      }
      return undefined;
    },
    initialPageParam: 1,
    enabled: !!contextId && enableInfiniteScroll,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
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
  const files = enableInfiniteScroll
    ? (infiniteQuery.data?.pages.flatMap(page => page.items) || [])
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

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (fileId: string) => {
      if (onDelete) {
        return await onDelete(fileId);
      }

      // Use water-mitigation specific API for WM photos (images only)
      if (context === 'water-mitigation' && fileCategory === 'image') {
        const { default: waterMitigationService } = await import('../../../../services/waterMitigationService');
        await waterMitigationService.photos.delete(fileId);
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

      // Also invalidate file count queries
      queryClient.invalidateQueries({
        queryKey: ['work-order-images-count', contextId]
      });
      queryClient.invalidateQueries({
        queryKey: ['work-order-documents-count', contextId]
      });

      message.success('File deleted successfully');
    },
    onError: (error: any) => {
      console.error('Delete failed:', error);
      message.error(`Delete failed: ${error.message || 'Unknown error'}`);
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