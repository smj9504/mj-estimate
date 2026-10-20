import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { message } from 'antd';
import { messageService } from '../services/messageService';
import { documentTransferService, DocumentTransfer } from '../services/documentTransferService';

export const messagingKeys = {
  unread: ['messages', 'unread'] as const,
  conversations: ['messages', 'conversations'] as const,
  thread: (id: string) => ['messages', 'thread', id] as const,
  people: ['messages', 'people'] as const,
  pendingTransfers: ['document-transfers', 'incoming', 'pending'] as const,
};

/** Unread messages for the header badge; checked every 30 seconds while the tab is open */
export function useUnreadMessages() {
  return useQuery({
    queryKey: messagingKeys.unread,
    queryFn: messageService.unreadCount,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
  });
}

/** Everyone who can be messaged or sent a document */
export function usePeople() {
  return useQuery({
    queryKey: messagingKeys.people,
    queryFn: messageService.people,
    staleTime: 5 * 60_000,
  });
}

/** Estimates and invoices offered to me and not answered yet */
export function usePendingTransfers() {
  return useQuery({
    queryKey: messagingKeys.pendingTransfers,
    queryFn: () => documentTransferService.incoming('pending'),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

const errorDetail = (error: any, fallback: string) => error?.response?.data?.detail || fallback;

/** Accept, decline or take back an offer, refreshing everything it shows up in */
export function useTransferActions() {
  const queryClient = useQueryClient();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['document-transfers'] });
    queryClient.invalidateQueries({ queryKey: ['messages'] });
    queryClient.invalidateQueries({ queryKey: ['documents'] });
  };

  const accept = useMutation({
    mutationFn: (id: string) => documentTransferService.accept(id),
    onSuccess: (transfer: DocumentTransfer) => {
      message.success(`${transfer.document_label} #${transfer.document_number ?? ''} is now in your list as a draft`);
      refresh();
    },
    onError: (error) => {
      message.error(errorDetail(error, "Couldn't accept it"));
      refresh();
    },
  });

  const decline = useMutation({
    mutationFn: (id: string) => documentTransferService.decline(id),
    onSuccess: () => {
      message.success('Declined');
      refresh();
    },
    onError: (error) => {
      message.error(errorDetail(error, "Couldn't decline it"));
      refresh();
    },
  });

  const cancel = useMutation({
    mutationFn: (id: string) => documentTransferService.cancel(id),
    onSuccess: () => {
      message.success('Taken back');
      refresh();
    },
    onError: (error) => {
      message.error(errorDetail(error, "Couldn't take it back"));
      refresh();
    },
  });

  return { accept, decline, cancel };
}
