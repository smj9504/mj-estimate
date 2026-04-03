import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import InsuranceExtractionPage from './InsuranceExtraction';
import { fileService } from '../services/fileService';
import { insuranceExtractionService } from '../services/insuranceExtractionService';

jest.mock('../services/fileService', () => ({
  fileService: {
    uploadFiles: jest.fn(),
  },
}));

jest.mock('../services/insuranceExtractionService', () => ({
  insuranceExtractionService: {
    extractFromFile: jest.fn(),
    getExtraction: jest.fn(),
  },
}));

// Avoid Ant Design responsive hooks (matchMedia) in Table/Upload during Jest.
jest.mock('../components/insurance-extraction', () => ({
  ExtractionUploadPanel: ({
    selectedFile,
    isExtracting,
    onFileSelect,
    onRunExtraction,
  }: {
    selectedFile: File | null;
    isExtracting: boolean;
    onFileSelect: (f: File | null) => void;
    onRunExtraction: () => void;
  }) => (
    <div>
      <input
        data-testid="mock-pdf-input"
        type="file"
        accept="application/pdf"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          onFileSelect(f);
        }}
      />
      <button
        type="button"
        data-testid="insurance-extraction-run"
        disabled={!selectedFile || isExtracting}
        onClick={onRunExtraction}
      >
        Run Extraction
      </button>
    </div>
  ),
  ExtractionSummaryCard: ({ extraction }: { extraction: { carrier?: string; pages: number } }) => (
    <div data-testid="summary">
      carrier={extraction.carrier} pages={extraction.pages}
    </div>
  ),
  ExtractionItemsTable: ({ items }: { items: { id: string; room?: string; line_item: string }[] }) => (
    <div data-testid="items-table">
      {items.map((row) => (
        <div key={row.id} data-testid={`row-${row.id}`}>
          <span data-testid="cell-room">{row.room}</span>
          <span data-testid="cell-line">{row.line_item}</span>
        </div>
      ))}
    </div>
  ),
}));

const mockUpload = fileService.uploadFiles as jest.MockedFunction<typeof fileService.uploadFiles>;
const mockExtract = insuranceExtractionService.extractFromFile as jest.MockedFunction<
  typeof insuranceExtractionService.extractFromFile
>;
const mockGet = insuranceExtractionService.getExtraction as jest.MockedFunction<
  typeof insuranceExtractionService.getExtraction
>;

describe('InsuranceExtractionPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uploads PDF, runs extraction, and shows extracted rows', async () => {
    mockUpload.mockResolvedValue([{ id: 'file-uuid-1' } as any]);
    mockExtract.mockResolvedValue({ id: 'ext-1' } as any);
    mockGet.mockResolvedValue({
      id: 'ext-1',
      file_id: 'file-uuid-1',
      carrier: 'state_farm',
      status: 'completed',
      pages: 2,
      parser_metadata: { ocr_attempted: false },
      items: [
        {
          id: 'item-1',
          room: 'Kitchen',
          line_item: 'Drywall patch',
          quantity: 10,
          unit: 'SF',
          unit_price: 3.25,
          confidence: 0.9,
          validation_flags: [],
        },
      ],
    });

    render(<InsuranceExtractionPage />);

    const input = screen.getByTestId('mock-pdf-input') as HTMLInputElement;
    const file = new File(['%PDF-1.4'], 'estimate.pdf', { type: 'application/pdf' });
    userEvent.upload(input, file);

    userEvent.click(screen.getByTestId('insurance-extraction-run'));

    await waitFor(() => {
      expect(mockUpload).toHaveBeenCalled();
      expect(mockExtract).toHaveBeenCalledWith('file-uuid-1');
      expect(mockGet).toHaveBeenCalledWith('ext-1');
    });

    expect(await screen.findByTestId('items-table')).toBeInTheDocument();
    expect(screen.getByText('Kitchen')).toBeInTheDocument();
    expect(screen.getByText('Drywall patch')).toBeInTheDocument();
  });
});
