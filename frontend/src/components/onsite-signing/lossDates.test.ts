import { describe, expect, it } from 'vitest';

import {
  DATE_OF_LOSS, MITIGATION_END, MITIGATION_START,
  asksPeriod, periodDays, periodText, presetPeriod, withLoss, withStart,
} from './lossDates';

const blank = { [DATE_OF_LOSS]: '', [MITIGATION_START]: '', [MITIGATION_END]: '' };

describe('withLoss', () => {
  it('starts the mitigation the day after the loss, for three days', () => {
    const answers = withLoss(blank, '10/01/2026');
    expect(answers).toEqual({
      [DATE_OF_LOSS]: '10/01/2026', [MITIGATION_START]: '10/02/2026', [MITIGATION_END]: '10/04/2026',
    });
    expect(periodDays(answers)).toBe(3);
  });

  it('crosses months and years', () => {
    expect(withLoss(blank, '12/30/2026')).toMatchObject({
      [MITIGATION_START]: '12/31/2026', [MITIGATION_END]: '01/02/2027',
    });
  });

  it('moves a period it set when the loss is corrected', () => {
    const answers = withLoss(withLoss(blank, '10/01/2026'), '10/05/2026');
    expect(answers).toMatchObject({ [MITIGATION_START]: '10/06/2026', [MITIGATION_END]: '10/08/2026' });
  });

  it('keeps a start changed by hand, unless it would come before the loss', () => {
    const edited = withStart(withLoss(blank, '10/01/2026'), '10/03/2026');
    expect(withLoss(edited, '09/30/2026')).toMatchObject({
      [MITIGATION_START]: '10/03/2026', [MITIGATION_END]: '10/05/2026',
    });
    expect(withLoss(edited, '10/10/2026')).toMatchObject({
      [MITIGATION_START]: '10/11/2026', [MITIGATION_END]: '10/13/2026',
    });
  });

  it('leaves the period alone when the loss is cleared', () => {
    const answers = withLoss(withLoss(blank, '10/01/2026'), '');
    expect(answers).toMatchObject({ [DATE_OF_LOSS]: '', [MITIGATION_START]: '10/02/2026' });
  });
});

describe('withStart', () => {
  it('keeps three days from a new start', () => {
    const answers = withStart(withLoss(blank, '10/01/2026'), '10/03/2026');
    expect(answers[MITIGATION_END]).toBe('10/05/2026');
  });

  it('keeps an end changed by hand, unless it would come before the start', () => {
    const longer = { ...withLoss(blank, '10/01/2026'), [MITIGATION_END]: '10/09/2026' };
    expect(withStart(longer, '10/03/2026')[MITIGATION_END]).toBe('10/09/2026');
    expect(withStart(longer, '10/12/2026')[MITIGATION_END]).toBe('10/14/2026');
  });
});

describe('presetPeriod', () => {
  it('sets a blank period from a date of loss already known', () => {
    expect(presetPeriod({ ...blank, [DATE_OF_LOSS]: '10/01/2026' })).toMatchObject({
      [MITIGATION_START]: '10/02/2026', [MITIGATION_END]: '10/04/2026',
    });
  });

  it('never overwrites a period already there', () => {
    const answers = { [DATE_OF_LOSS]: '10/01/2026', [MITIGATION_START]: '10/05/2026', [MITIGATION_END]: '' };
    expect(presetPeriod(answers)).toBe(answers);
  });
});

describe('asksPeriod and periodText', () => {
  it('only pairs the period with a date of loss when both are asked', () => {
    expect(asksPeriod([DATE_OF_LOSS, MITIGATION_START, MITIGATION_END])).toBe(true);
    expect(asksPeriod([DATE_OF_LOSS])).toBe(false);
  });

  it('reads as one line', () => {
    expect(periodText(withLoss(blank, '10/01/2026'))).toBe('10/02/2026 – 10/04/2026 (3 days)');
    expect(periodText(blank)).toBe('');
  });
});
