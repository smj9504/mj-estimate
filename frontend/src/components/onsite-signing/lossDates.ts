/**
 * The dates of a water mitigation job. The date of loss is asked first; the
 * mitigation usually starts the day after and runs three days, so entering the
 * loss sets the period, which stays editable. A date someone changed by hand is
 * kept when an earlier one changes, unless it would now come before it.
 *
 * Keep the keys in sync with backend/app/domains/contract/onsite_signing.py
 */

import dayjs, { type Dayjs } from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(customParseFormat);

type Answers = Record<string, string>;

export const DATE_FORMAT = 'MM/DD/YYYY';
export const DATE_OF_LOSS = 'claim.date_of_loss';
export const MITIGATION_START = 'wm_job.mitigation_start_date';
export const MITIGATION_END = 'wm_job.mitigation_end_date';

/** Days from the loss to the first day of mitigation, and how many days it runs */
export const START_AFTER_LOSS = 1;
export const MITIGATION_DAYS = 3;

export const parseDate = (value?: string | null): Dayjs | null => {
  const date = dayjs(value ?? '', DATE_FORMAT, true);
  return date.isValid() ? date : null;
};

export const formatDate = (date: Dayjs) => date.format(DATE_FORMAT);

const defaultStart = (loss: Dayjs) => loss.add(START_AFTER_LOSS, 'day');
const defaultEnd = (start: Dayjs) => start.add(MITIGATION_DAYS - 1, 'day');

/** Whether the questions ask for the period, which then goes with the date of loss */
export const asksPeriod = (keys: string[]) => (
  [DATE_OF_LOSS, MITIGATION_START, MITIGATION_END].every(key => keys.includes(key))
);

/** A new start moves the end with it, unless the end was set to something else */
export const withStart = (answers: Answers, next: string): Answers => {
  const result: Answers = { ...answers, [MITIGATION_START]: next };
  const start = parseDate(next);
  if (!start) return result;
  const before = parseDate(answers[MITIGATION_START]);
  const end = parseDate(answers[MITIGATION_END]);
  const endWasDefault = !end || (!!before && end.isSame(defaultEnd(before), 'day'));
  if (endWasDefault || (end && end.isBefore(start, 'day'))) {
    result[MITIGATION_END] = formatDate(defaultEnd(start));
  }
  return result;
};

/** A new date of loss sets the period from it, unless the start was set to something else */
export const withLoss = (answers: Answers, next: string): Answers => {
  const result: Answers = { ...answers, [DATE_OF_LOSS]: next };
  const loss = parseDate(next);
  if (!loss) return result;
  const before = parseDate(answers[DATE_OF_LOSS]);
  const start = parseDate(answers[MITIGATION_START]);
  const startWasDefault = !start || (!!before && start.isSame(defaultStart(before), 'day'));
  if (startWasDefault || (start && start.isBefore(loss, 'day'))) {
    return withStart(result, formatDate(defaultStart(loss)));
  }
  return result;
};

/** A date of loss already on record sets a period that's still blank */
export const presetPeriod = (answers: Answers): Answers => {
  const loss = parseDate(answers[DATE_OF_LOSS]);
  if (!loss || answers[MITIGATION_START] || answers[MITIGATION_END]) return answers;
  return withStart(answers, formatDate(defaultStart(loss)));
};

/** How many days the period covers, counting both ends */
export const periodDays = (answers: Answers): number | null => {
  const start = parseDate(answers[MITIGATION_START]);
  const end = parseDate(answers[MITIGATION_END]);
  return start && end && !end.isBefore(start, 'day') ? end.diff(start, 'day') + 1 : null;
};

/** The period as one line, for the review list */
export const periodText = (answers: Answers): string => {
  const start = answers[MITIGATION_START] ?? '';
  const end = answers[MITIGATION_END] ?? '';
  if (!start && !end) return '';
  const days = periodDays(answers);
  return `${start || '?'} – ${end || '?'}${days ? ` (${days} ${days === 1 ? 'day' : 'days'})` : ''}`;
};
