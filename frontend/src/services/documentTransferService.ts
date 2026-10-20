/**
 * Offering an estimate or invoice to someone else. They get their own copy
 * (new number, draft, payments cleared) only when they accept.
 */

import api from './api';

export type TransferDocumentType = 'estimate' | 'invoice';
export type TransferStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export interface DocumentTransfer {
  id: string;
  document_type: TransferDocumentType;
  document_label: string;
  document_number: string | null;
  client_name: string | null;
  source_id: string;
  from_staff_id: string | null;
  from_name: string | null;
  to_staff_id: string;
  to_name: string | null;
  note: string | null;
  status: TransferStatus;
  /** Only the recipient sees their copy */
  copy_id: string | null;
  copy_link: string | null;
  created_at: string;
  responded_at: string | null;
}

export const documentTransferService = {
  async send(
    documentType: TransferDocumentType,
    documentId: string,
    recipientIds: string[],
    note?: string,
  ): Promise<DocumentTransfer[]> {
    const { data } = await api.post('/api/document-transfers/', {
      document_type: documentType,
      document_id: documentId,
      recipient_ids: recipientIds,
      note: note || null,
    });
    return data;
  },

  async incoming(status?: TransferStatus): Promise<DocumentTransfer[]> {
    const { data } = await api.get('/api/document-transfers/incoming', {
      params: status ? { status } : undefined,
      suppressErrorNotification: true,
    });
    return data;
  },

  async outgoing(status?: TransferStatus): Promise<DocumentTransfer[]> {
    const { data } = await api.get('/api/document-transfers/outgoing', {
      params: status ? { status } : undefined,
    });
    return data;
  },

  async accept(id: string): Promise<DocumentTransfer> {
    const { data } = await api.post(`/api/document-transfers/${id}/accept`);
    return data;
  },

  async decline(id: string): Promise<DocumentTransfer> {
    const { data } = await api.post(`/api/document-transfers/${id}/decline`);
    return data;
  },

  async cancel(id: string): Promise<DocumentTransfer> {
    const { data } = await api.post(`/api/document-transfers/${id}/cancel`);
    return data;
  },
};
