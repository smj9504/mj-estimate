/**
 * Client, Claim, and ClaimNegotiation API service
 */

import api from './api';
import type {
  Client,
  ClientCreate,
  ClientListItem,
  ClientAllDocumentsResponse,
  Claim,
  ClaimCreate,
  ClaimNegotiation,
  ClaimNegotiationCreate,
  ClaimPayment,
  ClaimPaymentCreate,
  ClaimExpense,
  ClaimExpenseCreate,
  PaymentSummary,
  ProfitabilitySummary,
  PdfExtractionResult,
  ClaimNote,
  ClaimNoteCreate,
  ClaimTodo,
  ClaimTodoCreate,
  ClaimTodoDashboard,
} from '../types/client';

// ============================================================
// Client API
// ============================================================

export const clientService = {
  async list(params?: { skip?: number; limit?: number; search?: string; is_active?: boolean }) {
    const { data } = await api.get('/api/clients/', { params });
    return data as { clients: ClientListItem[]; total: number };
  },

  async search(q: string, limit = 20) {
    const { data } = await api.get('/api/clients/search', { params: { q, limit } });
    return data as { clients: ClientListItem[]; total: number };
  },

  async getById(id: string) {
    const { data } = await api.get(`/api/clients/${id}`);
    return data as Client;
  },

  async getAllDocuments(
    clientId: string,
    params?: { doc_type?: string; claim_id?: string }
  ): Promise<ClientAllDocumentsResponse> {
    const { data } = await api.get(`/api/clients/${clientId}/all-documents`, { params });
    return data;
  },

  async create(payload: ClientCreate) {
    const { data } = await api.post('/api/clients/', payload);
    return data as Client;
  },

  async update(id: string, payload: Partial<ClientCreate>) {
    const { data } = await api.put(`/api/clients/${id}`, payload);
    return data;
  },

  async delete(id: string) {
    const { data } = await api.delete(`/api/clients/${id}`);
    return data;
  },

  async getLatestDateOfLoss(clientId: string) {
    const { data } = await api.get(`/api/clients/${clientId}/latest-date-of-loss`);
    return data as { date_of_loss: string | null };
  },
};

// ============================================================
// Claim API
// ============================================================

export const claimService = {
  async listByClient(clientId: string) {
    const { data } = await api.get(`/api/clients/${clientId}/claims`);
    return data as { claims: Claim[]; total: number };
  },

  async getById(clientId: string, claimId: string) {
    const { data } = await api.get(`/api/clients/${clientId}/claims/${claimId}`);
    return data as Claim;
  },

  async create(clientId: string, payload: ClaimCreate) {
    const { data } = await api.post(`/api/clients/${clientId}/claims`, payload);
    return data as Claim;
  },

  async update(clientId: string, claimId: string, payload: Partial<ClaimCreate>) {
    const { data } = await api.put(`/api/clients/${clientId}/claims/${claimId}`, payload);
    return data;
  },

  async delete(clientId: string, claimId: string) {
    const { data } = await api.delete(`/api/clients/${clientId}/claims/${claimId}`);
    return data;
  },

  async getDocuments(clientId: string, claimId: string) {
    const { data } = await api.get(`/api/clients/${clientId}/claims/${claimId}/documents`);
    return data;
  },
};

// ============================================================
// ClaimNegotiation API
// ============================================================

export const negotiationService = {
  async listByClaim(clientId: string, claimId: string) {
    const { data } = await api.get(
      `/api/clients/${clientId}/claims/${claimId}/negotiations`
    );
    return data as { negotiations: ClaimNegotiation[]; total: number };
  },

  async create(clientId: string, claimId: string, payload: ClaimNegotiationCreate) {
    const { data } = await api.post(
      `/api/clients/${clientId}/claims/${claimId}/negotiations`,
      payload
    );
    return data as ClaimNegotiation;
  },

  async update(
    clientId: string,
    claimId: string,
    negotiationId: string,
    payload: Partial<ClaimNegotiationCreate>
  ) {
    const { data } = await api.put(
      `/api/clients/${clientId}/claims/${claimId}/negotiations/${negotiationId}`,
      payload
    );
    return data;
  },

  async delete(clientId: string, claimId: string, negotiationId: string) {
    const { data } = await api.delete(
      `/api/clients/${clientId}/claims/${claimId}/negotiations/${negotiationId}`
    );
    return data;
  },

  async extractPdf(clientId: string, claimId: string, file: File) {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post(
      `/api/clients/${clientId}/claims/${claimId}/negotiations/extract-pdf`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 }
    );
    return data as PdfExtractionResult;
  },
};

export const paymentService = {
  async list(clientId: string, claimId: string) {
    const { data } = await api.get(
      `/api/clients/${clientId}/claims/${claimId}/payments`
    );
    return data as ClaimPayment[];
  },

  async getSummary(clientId: string, claimId: string) {
    const { data } = await api.get(
      `/api/clients/${clientId}/claims/${claimId}/payment-summary`
    );
    return data as PaymentSummary;
  },

  async create(clientId: string, claimId: string, payload: ClaimPaymentCreate) {
    const { data } = await api.post(
      `/api/clients/${clientId}/claims/${claimId}/payments`,
      payload
    );
    return data as ClaimPayment;
  },

  async update(clientId: string, claimId: string, paymentId: string, payload: Partial<ClaimPaymentCreate>) {
    const { data } = await api.put(
      `/api/clients/${clientId}/claims/${claimId}/payments/${paymentId}`,
      payload
    );
    return data as ClaimPayment;
  },

  async delete(clientId: string, claimId: string, paymentId: string) {
    await api.delete(
      `/api/clients/${clientId}/claims/${claimId}/payments/${paymentId}`
    );
  },
};

export const expenseService = {
  async list(clientId: string, claimId: string) {
    const { data } = await api.get(
      `/api/clients/${clientId}/claims/${claimId}/expenses`
    );
    return data as ClaimExpense[];
  },

  async getProfitability(clientId: string, claimId: string) {
    const { data } = await api.get(
      `/api/clients/${clientId}/claims/${claimId}/profitability`
    );
    return data as ProfitabilitySummary;
  },

  async create(clientId: string, claimId: string, payload: ClaimExpenseCreate) {
    const { data } = await api.post(
      `/api/clients/${clientId}/claims/${claimId}/expenses`,
      payload
    );
    return data as ClaimExpense;
  },

  async update(clientId: string, claimId: string, expenseId: string, payload: Partial<ClaimExpenseCreate>) {
    const { data } = await api.put(
      `/api/clients/${clientId}/claims/${claimId}/expenses/${expenseId}`,
      payload
    );
    return data as ClaimExpense;
  },

  async delete(clientId: string, claimId: string, expenseId: string) {
    await api.delete(
      `/api/clients/${clientId}/claims/${claimId}/expenses/${expenseId}`
    );
  },
};

export const claimActivityService = {
  async getActivities(clientId: string, claimId: string) {
    const { data } = await api.get(
      `/api/clients/${clientId}/claims/${claimId}/activities`
    );
    return data;
  },
};

// ============================================================
// Claim Note API
// ============================================================

export const claimNoteService = {
  async list(clientId: string, claimId: string) {
    const { data } = await api.get(
      `/api/clients/${clientId}/claims/${claimId}/notes`
    );
    return data as ClaimNote[];
  },

  async create(clientId: string, claimId: string, payload: ClaimNoteCreate) {
    const { data } = await api.post(
      `/api/clients/${clientId}/claims/${claimId}/notes`,
      payload
    );
    return data as ClaimNote;
  },

  async update(clientId: string, claimId: string, noteId: string, payload: Partial<ClaimNoteCreate>) {
    const { data } = await api.patch(
      `/api/clients/${clientId}/claims/${claimId}/notes/${noteId}`,
      payload
    );
    return data as ClaimNote;
  },

  async delete(clientId: string, claimId: string, noteId: string) {
    await api.delete(
      `/api/clients/${clientId}/claims/${claimId}/notes/${noteId}`
    );
  },
};

// ============================================================
// Claim Todo API
// ============================================================

export const claimTodoService = {
  async list(clientId: string, claimId: string) {
    const { data } = await api.get(
      `/api/clients/${clientId}/claims/${claimId}/todos`
    );
    return data as ClaimTodo[];
  },

  async create(clientId: string, claimId: string, payload: ClaimTodoCreate) {
    const { data } = await api.post(
      `/api/clients/${clientId}/claims/${claimId}/todos`,
      payload
    );
    return data as ClaimTodo;
  },

  async update(
    clientId: string, claimId: string, todoId: string,
    payload: Partial<ClaimTodoCreate & { is_completed?: boolean }>
  ) {
    const { data } = await api.patch(
      `/api/clients/${clientId}/claims/${claimId}/todos/${todoId}`,
      payload
    );
    return data as ClaimTodo;
  },

  async delete(clientId: string, claimId: string, todoId: string) {
    await api.delete(
      `/api/clients/${clientId}/claims/${claimId}/todos/${todoId}`
    );
  },

  async getActiveTodos(includeCompleted = false) {
    const { data } = await api.get('/api/claim-todos/active', {
      params: { include_completed: includeCompleted },
    });
    return data as ClaimTodoDashboard[];
  },
};
