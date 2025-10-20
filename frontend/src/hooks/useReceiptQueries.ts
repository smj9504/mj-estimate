import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { receiptService } from '../services/receiptService';
import type { Receipt, ReceiptTemplate, ReceiptGenerateRequest } from '../types/receipt';

/**
 * Query keys for receipt-related queries
 */
export const receiptKeys = {
  all: ['receipts'] as const,
  lists: () => [...receiptKeys.all, 'list'] as const,
  list: (filters: Record<string, any>) => [...receiptKeys.lists(), filters] as const,
  details: () => [...receiptKeys.all, 'detail'] as const,
  detail: (id: string) => [...receiptKeys.details(), id] as const,
  byInvoice: (invoiceId: string) => [...receiptKeys.all, 'invoice', invoiceId] as const,
  byNumber: (invoiceId: string, receiptNumber: string) =>
    [...receiptKeys.all, 'invoice', invoiceId, 'number', receiptNumber] as const,
  templates: {
    all: ['receiptTemplates'] as const,
    byCompany: (companyId: string) => ['receiptTemplates', 'company', companyId] as const,
  },
};

/**
 * Hook to fetch receipts by invoice ID with caching
 */
export function useReceiptsByInvoice(invoiceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: receiptKeys.byInvoice(invoiceId || ''),
    queryFn: () => receiptService.getReceiptsByInvoice(invoiceId!),
    enabled: enabled && !!invoiceId,
    staleTime: 3 * 60 * 1000, // 3 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes in cache
  });
}

/**
 * Hook to fetch a specific receipt by invoice ID and receipt number
 * More efficient than fetching all receipts
 */
export function useReceiptByNumber(
  invoiceId: string | undefined,
  receiptNumber: string | undefined,
  enabled = true
) {
  return useQuery({
    queryKey: receiptKeys.byNumber(invoiceId || '', receiptNumber || ''),
    queryFn: () => receiptService.getReceiptByNumber(invoiceId!, receiptNumber!),
    enabled: enabled && !!invoiceId && !!receiptNumber,
    staleTime: 5 * 60 * 1000, // 5 minutes - receipts don't change often
    gcTime: 10 * 60 * 1000, // 10 minutes in cache
  });
}

/**
 * Hook to fetch receipt templates for a company with caching
 */
export function useReceiptTemplates(companyId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: receiptKeys.templates.byCompany(companyId || ''),
    queryFn: () => receiptService.getTemplates(companyId!),
    enabled: enabled && !!companyId,
    staleTime: 10 * 60 * 1000, // 10 minutes - templates change rarely
    gcTime: 30 * 60 * 1000, // 30 minutes in cache
  });
}

/**
 * Hook to generate a receipt
 */
export function useGenerateReceipt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ReceiptGenerateRequest) => receiptService.generateReceipt(data),
    onSuccess: (newReceipt, variables) => {
      // Invalidate receipts for this invoice
      queryClient.invalidateQueries({
        queryKey: receiptKeys.byInvoice(variables.invoice_id)
      });
      // Add the new receipt to cache
      if (newReceipt.receipt_number) {
        queryClient.setQueryData(
          receiptKeys.byNumber(variables.invoice_id, newReceipt.receipt_number),
          newReceipt
        );
      }
    },
  });
}

/**
 * Hook to update a receipt
 */
export function useUpdateReceipt(receiptId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Partial<ReceiptGenerateRequest>) =>
      receiptService.updateReceipt(receiptId, data),
    onSuccess: (updatedReceipt) => {
      // Invalidate related queries
      if (updatedReceipt.invoice_id) {
        queryClient.invalidateQueries({
          queryKey: receiptKeys.byInvoice(updatedReceipt.invoice_id)
        });
      }
      // Update specific receipt cache if we have the receipt number
      if (updatedReceipt.invoice_id && updatedReceipt.receipt_number) {
        queryClient.setQueryData(
          receiptKeys.byNumber(updatedReceipt.invoice_id, updatedReceipt.receipt_number),
          updatedReceipt
        );
      }
    },
  });
}

/**
 * Hook to delete a receipt
 */
export function useDeleteReceipt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (receiptId: string) => receiptService.deleteReceipt(receiptId),
    onSuccess: (_, receiptId) => {
      // Invalidate all receipt queries to ensure consistency
      queryClient.invalidateQueries({ queryKey: receiptKeys.all });
    },
  });
}
