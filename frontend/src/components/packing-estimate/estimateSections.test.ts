import { describe, expect, it } from 'vitest';
import { estimateSectionNames } from './estimateSections';

const lines = { lines: [{}] };

describe('estimateSectionNames', () => {
  it('lists a section that has a charge but no lines, so the page adds up', () => {
    expect(estimateSectionNames({
      sections: { 'Pack-Out Labor': 100, Materials: 50 },
      section_details: { 'Pack-Out Labor': lines },
    })).toEqual(['Pack-Out Labor', 'Materials']);
  });

  it('leaves out a section with neither a charge nor lines', () => {
    expect(estimateSectionNames({
      sections: { 'Pack-Out Labor': 100, Storage: 0 },
      section_details: { 'Pack-Out Labor': lines, Storage: { lines: [] } },
    })).toEqual(['Pack-Out Labor']);
  });

  it('keeps the same order however the database returned the keys', () => {
    expect(estimateSectionNames({
      sections: { Storage: 1, Materials: 1, 'Special Items': 1, 'Pack-Back Labor': 1, 'Pack-Out Labor': 1 },
      section_details: {},
    })).toEqual(['Pack-Out Labor', 'Materials', 'Storage', 'Pack-Back Labor', 'Special Items']);
  });

  it('puts a section it does not know after the ones it does', () => {
    expect(estimateSectionNames({
      sections: { 'Something New': 1, Materials: 1 },
    })).toEqual(['Materials', 'Something New']);
  });

  it('copes with an estimate that has nothing yet', () => {
    expect(estimateSectionNames({})).toEqual([]);
  });
});
