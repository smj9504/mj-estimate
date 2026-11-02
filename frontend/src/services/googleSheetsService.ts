/**
 * Google Sheets Integration Service
 * Handles synchronization with Google Sheets
 */

import api from './api';

export interface SyncRequest {
  spreadsheet_id: string;
  sheet_name?: string;
  sync_type?: 'full' | 'incremental';
}

export interface SyncStats {
  status: 'success' | 'partial' | 'failed';
  processed: number;
  created: number;
  updated: number;
  /** Jobs that followed their row to a new row number */
  moved?: number;
  /** Jobs whose row is gone from the sheet, keeping their data */
  off_sheet?: number;
  /** Rows at the address of something entered by hand, waiting on a decision */
  needs_review?: number;
  failed: number;
  errors?: Array<{
    /** Absent when a whole tab failed */
    row?: number;
    sheet_name?: string;
    error: string;
  }>;
}

/** The facts a sheet row and what was entered by hand are compared on */
export interface SheetRowFacts {
  homeowner_name?: string | null;
  homeowner_phone?: string | null;
  homeowner_email?: string | null;
  insurance_company?: string | null;
  claim_number?: string | null;
  /** YYYY-MM-DD, or the cell as typed when it can't be read as a date */
  date_of_loss?: string | null;
}

export interface SheetRowCandidate extends SheetRowFacts {
  type: 'job' | 'client';
  id: string;
  address: string;
  status?: string | null;
  source?: string | null;
  /** The tab a job was on, when its row has gone from there */
  sheet_name?: string | null;
  client_id?: string | null;
  created_at?: string | null;
}

export interface SheetRowMatch {
  id: string;
  sheet_name: string;
  row_number: number;
  address: string;
  row: SheetRowFacts;
  candidates: SheetRowCandidate[];
  created_at?: string | null;
}

export type SheetRowDecision =
  | { decision: 'different' }
  | { decision: 'same'; candidate_type: 'job' | 'client'; candidate_id: string };

export interface SyncLogEntry {
  id: string;
  integration_type: string;
  sync_type: string;
  status: string;
  rows_processed: number;
  rows_created: number;
  rows_updated: number;
  rows_failed: number;
  error_message?: string;
  started_at: string;
  completed_at?: string;
}

class GoogleSheetsService {
  /**
   * Trigger full sync from Google Sheets
   */
  async syncGoogleSheets(request: SyncRequest): Promise<SyncStats> {
    const response = await api.post<SyncStats>(
      `/api/integrations/google-sheets/sync`,
      {
        spreadsheet_id: request.spreadsheet_id,
        sheet_name: request.sheet_name || 'Sheet1',
        sync_type: request.sync_type || 'full'
      },
      // Full sync processes every sheet row sequentially (DB writes + client/claim
      // sync + PA mapping per row), which routinely exceeds the default 30s timeout.
      { timeout: 120000 }
    );
    return response.data;
  }

  /**
   * Sheet rows waiting on whether they are the same as something entered by hand
   */
  async getRowMatches(): Promise<SheetRowMatch[]> {
    const response = await api.get<SheetRowMatch[]>(`/api/integrations/google-sheets/row-matches`);
    return response.data;
  }

  /**
   * Decide a waiting row. Links or creates the job, so it can take as long as a row of a sync.
   */
  async resolveRowMatch(id: string, decision: SheetRowDecision): Promise<{ status: string; job_id: string }> {
    const response = await api.post(
      `/api/integrations/google-sheets/row-matches/${id}/resolve`,
      decision,
      { timeout: 60000 }
    );
    return response.data;
  }

  /**
   * Get sync history
   */
  async getSyncHistory(limit: number = 10): Promise<SyncLogEntry[]> {
    const response = await api.get<SyncLogEntry[]>(
      `/api/integrations/google-sheets/sync-history`,
      { params: { limit } }
    );
    return response.data;
  }

  /**
   * Get sheet metadata
   */
  async getSheetMetadata(spreadsheetId: string): Promise<any> {
    const response = await api.get(
      `/api/integrations/google-sheets/sheet-metadata`,
      { params: { spreadsheet_id: spreadsheetId } }
    );
    return response.data;
  }
}

export default new GoogleSheetsService();
