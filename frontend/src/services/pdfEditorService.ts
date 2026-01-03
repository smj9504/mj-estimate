import api from './api';

export interface TextEditOperation {
  operation: 'add' | 'delete' | 'modify';
  page_number: number;
  x: number;
  y: number;
  text?: string;
  width?: number;
  height?: number;
  font_size?: number;
  font_family?: string;
  color?: string;
}

export interface PDFEditRequest {
  file_id?: string;
  file_url?: string;
  edits: TextEditOperation[];
}

export interface PDFEditResponse {
  success: boolean;
  file_id?: string;
  file_url?: string;
  message: string;
}

export const pdfEditorService = {
  // Edit existing PDF
  async editPDF(request: PDFEditRequest): Promise<PDFEditResponse> {
    const response = await api.post('/api/pdf-editor/edit', request);
    return response.data;
  },

  // Upload and edit PDF in one operation
  async uploadAndEdit(
    file: File,
    edits?: TextEditOperation[]
  ): Promise<PDFEditResponse> {
    const formData = new FormData();
    formData.append('file', file);

    if (edits && edits.length > 0) {
      formData.append(
        'request',
        JSON.stringify({ edits })
      );
    }

    const response = await api.post('/api/pdf-editor/upload-and-edit', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    return response.data;
  },
};

export default pdfEditorService;


