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
  failed: number;
  errors?: Array<{
    row: number;
    error: string;
  }>;
}

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
      }
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
