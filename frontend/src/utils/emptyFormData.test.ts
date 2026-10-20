import { describe, expect, it } from 'vitest';
import { isEmptyFormData } from './emptyFormData';

describe('isEmptyFormData', () => {
  it('flags a form nothing was appended to', () => {
    expect(isEmptyFormData(new FormData())).toBe(true);
  });

  it('passes a form with any field, even a blank one', () => {
    const notes = new FormData();
    notes.append('resolution_notes', '');
    expect(isEmptyFormData(notes)).toBe(false);

    const upload = new FormData();
    upload.append('file', new File(['%PDF-1.7'], 'estimate.pdf', { type: 'application/pdf' }));
    expect(isEmptyFormData(upload)).toBe(false);
  });

  it('leaves non-form bodies alone', () => {
    expect(isEmptyFormData(undefined)).toBe(false);
    expect(isEmptyFormData({})).toBe(false);
    expect(isEmptyFormData('')).toBe(false);
  });
});
