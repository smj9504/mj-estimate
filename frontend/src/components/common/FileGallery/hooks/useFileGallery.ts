import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { message } from 'antd';
import { FileItem, FileContext, FileCategory } from '../types';
import { fileService } from '../../../../services/fileService';

interface UseFileGalleryProps {
  context: FileContext;
  contextId?: string;
  fileCategory?: FileCategory;
  onUpload?: (files: File[], category?: string) => Promise<void>;
  onDelete?: (fileId: string) => Promise<void>;
}

export const useFileGallery = ({
  context,
  contextId,
  fileCategory,
  onUpload,
  onDelete
}: UseFileGalleryProps) => {
  const queryClient = useQueryClient();
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});


  // Query for files
  const {
    data: files = [],
    isLoading: loading,
    error,
    refetch
  } = useQuery<FileItem[]>({
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
    enabled: !!contextId,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
  });

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

      await fileService.deleteFile(fileId);
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
      await fileService.updateFile(fileId, { category });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['files', context, contextId, fileCategory]
      });
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
    refetch
  };
};