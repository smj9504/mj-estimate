import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoiceService } from '../services/invoiceService';
import type { InvoiceData, InvoiceDetailResponse } from '../services/invoiceService';

/**
 * Query keys for invoice-related queries
 */
export const invoiceKeys = {
  all: ['invoices'] as const,
  lists: () => [...invoiceKeys.all, 'list'] as const,
  list: (filters: Record<string, any>) => [...invoiceKeys.lists(), filters] as const,
  details: () => [...invoiceKeys.all, 'detail'] as const,
  detail: (id: string) => [...invoiceKeys.details(), id] as const,
};

/**
 * Hook to fetch a single invoice by ID with caching
 */
export function useInvoice(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: invoiceKeys.detail(id || ''),
    queryFn: () => invoiceService.getInvoice(id!),
    enabled: enabled && !!id,
    staleTime: 5 * 60 * 1000, // 5 minutes - invoice data doesn't change often
    gcTime: 10 * 60 * 1000, // 10 minutes in cache
  });
}

/**
 * Hook to fetch invoices list with optional filters
 */
export function useInvoices(params?: {
  skip?: number;
  limit?: number;
  client_name?: string;
  status?: string;
}) {
  return useQuery({
    queryKey: invoiceKeys.list(params || {}),
    queryFn: () => invoiceService.getInvoices(params),
    staleTime: 1 * 60 * 1000, // 1 minute - lists change more frequently
    gcTime: 5 * 60 * 1000, // 5 minutes in cache
  });
}

/**
 * Hook to create a new invoice
 */
export function useCreateInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: InvoiceData) => invoiceService.createInvoice(data),
    onSuccess: (newInvoice) => {
      // Invalidate and refetch invoice lists
      queryClient.invalidateQueries({ queryKey: invoiceKeys.lists() });
      // Add the new invoice to cache
      queryClient.setQueryData(invoiceKeys.detail(newInvoice.id), newInvoice);
    },
  });
}

/**
 * Hook to update an existing invoice
 */
export function useUpdateInvoice(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Partial<InvoiceData>) => invoiceService.updateInvoice(id, data),
    onSuccess: (updatedInvoice) => {
      // Update the cached invoice data
      queryClient.setQueryData(invoiceKeys.detail(id), updatedInvoice);
      // Invalidate lists to reflect changes
      queryClient.invalidateQueries({ queryKey: invoiceKeys.lists() });
    },
  });
}

/**
 * Hook to delete an invoice
 */
export function useDeleteInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => invoiceService.deleteInvoice(id),
    onSuccess: (_, id) => {
      // Remove from cache
      queryClient.removeQueries({ queryKey: invoiceKeys.detail(id) });
      // Invalidate lists
      queryClient.invalidateQueries({ queryKey: invoiceKeys.lists() });
    },
  });
}

/**
 * Hook to generate invoice number
 */
export function useGenerateInvoiceNumber(companyId?: string) {
  return useQuery({
    queryKey: ['invoiceNumber', companyId],
    queryFn: () => invoiceService.generateInvoiceNumber(companyId),
    enabled: false, // Only run when manually triggered
    staleTime: 0, // Always generate fresh number
    gcTime: 0, // Don't cache
  });
}
