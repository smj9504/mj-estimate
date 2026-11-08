/**
 * Reads line items out of text copied from Xactimate.
 *
 * Two shapes reach the clipboard:
 *
 *  - Grid copy: rows selected in a Xactimate line item grid (or an HTML table
 *    in Xactimate online) and copied with Ctrl+C. Cells come tab-separated,
 *    usually with a header row (Cat, Sel, Act, Description, Qty, Unit, ...).
 *
 *  - Report text: text dragged over with the mouse in an estimate report or
 *    its PDF. Each item is one line like
 *      `3. R&R Baseboard - 3 1/4"   45.33 LF   0.42   2.65   3.25   27.82   170.97`
 *    with room names ("Kitchen  Height: 8'"), room dimensions, totals and page
 *    furniture mixed in between.
 *
 * Both end up as `ParsedXactimateLine` rows. The unit price never includes
 * tax or O&P; the price columns are told apart by checking which reading
 * makes the line's own total add up.
 */

export interface ParsedXactimateLine {
  key: string;
  /** Line number as printed in the report ("3." -> 3) */
  lineNumber?: number;
  /** Room / area heading the item sat under */
  room?: string;
  /** Xactimate category code, e.g. DRY */
  category?: string;
  /** Xactimate selector code, e.g. 1/2 */
  selector?: string;
  description: string;
  quantity: number;
  unit: string;
  /** Unit price without tax and O&P (remove + replace when split) */
  unitPrice: number;
  remove?: number;
  replace?: number;
  tax?: number;
  overheadProfit?: number;
  /** Line total as Xactimate printed it (RCV), tax and O&P included */
  xactimateTotal?: number;
  /** Item notes printed under the line */
  note?: string;
  warnings: string[];
}

export interface XactimatePasteResult {
  items: ParsedXactimateLine[];
  /** Room headings in the order they appeared */
  rooms: string[];
  /** Non-empty lines that were neither an item nor a recognised heading */
  skippedLines: string[];
  format: 'grid' | 'report' | 'empty';
}

/** Units Xactimate prints after a quantity */
const UNITS = new Set([
  'EA', 'LF', 'SF', 'SY', 'SQ', 'CF', 'CY', 'HR', 'HRS', 'DA', 'DAY', 'WK', 'MO', 'MN', 'YR',
  'GL', 'GAL', 'LB', 'TN', 'BF', 'MBF', 'RL', 'BX', 'CS', 'PR', 'ST', 'RM', 'LS', 'KT', 'PK',
  'BG', 'BD', 'TB', 'CT', 'DZ', 'PC', 'SH', 'LT', 'OZ', 'QT', 'PT', 'FT', 'IN', 'YD', 'MI',
  'TON', 'JOB', 'UNIT', 'EACH',
]);

const isUnit = (token: string | undefined): boolean =>
  !!token && UNITS.has(token.replace(/\.$/, '').toUpperCase());

const normUnit = (token: string): string => {
  const u = token.replace(/\.$/, '').toUpperCase();
  if (u === 'EACH' || u === 'UNIT') return 'EA';
  if (u === 'HRS') return 'HR';
  if (u === 'DAY') return 'DA';
  if (u === 'GAL') return 'GL';
  return u;
};

const NUMBER_RE = /^[<(]?-?\$?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?[>)]?$/;

/** Parses "1,234.56", "$12", "(3.20)" and "<3.20>" (negatives); null when not a number */
export const parseNumber = (raw: string | undefined): number | null => {
  if (raw == null) return null;
  const token = raw.trim();
  if (!token || !/\d/.test(token) || !NUMBER_RE.test(token)) return null;
  const negative = /^[<(-]/.test(token) || token.includes('-');
  const value = parseFloat(token.replace(/[<>()$,-]/g, ''));
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
};

/**
 * Tokens allowed after the unit: prices, depreciation in brackets, and the
 * age/life/condition columns (`10/20 yrs`, `Avg.`, `50%`, `[%]`, `NA`).
 */
const isTailToken = (token: string): boolean =>
  parseNumber(token) != null ||
  /^\[?-?[\d.]*%\]?$/.test(token) ||
  /^(yrs?\.?|avg\.?|good|fair|poor|below|above|na|n\/a|\d+\/(\d+|na)|[[\]%]+|\$)$/i.test(token);

const close = (a: number, b: number): boolean =>
  Math.abs(a - b) <= Math.max(0.05, Math.abs(b) * 0.005);

type PriceLayout = 'unitPrice' | 'removeReplace';

interface PriceReading {
  unitPrice: number;
  remove?: number;
  replace?: number;
  tax?: number;
  overheadProfit?: number;
  total?: number;
  consistent: boolean;
}

const readUnitPrice = (qty: number, n: number[]): PriceReading => {
  const [up, a, b, c] = n;
  if (n.length >= 4) {
    return { unitPrice: up, tax: a, overheadProfit: b, total: c, consistent: close(qty * up + a + b, c) };
  }
  if (n.length === 3) {
    // Either tax or O&P is switched off in the report; both read the same.
    return { unitPrice: up, tax: a, total: b, consistent: close(qty * up + a, b) };
  }
  if (n.length === 2) return { unitPrice: up, total: a, consistent: close(qty * up, a) };
  return { unitPrice: up ?? 0, consistent: false };
};

const readRemoveReplace = (qty: number, n: number[]): PriceReading => {
  const [rm, rp, a, b, c] = n;
  const up = (rm ?? 0) + (rp ?? 0);
  if (n.length >= 5) {
    return { unitPrice: up, remove: rm, replace: rp, tax: a, overheadProfit: b, total: c,
      consistent: close(qty * up + a + b, c) };
  }
  if (n.length === 4) {
    return { unitPrice: up, remove: rm, replace: rp, tax: a, total: b, consistent: close(qty * up + a, b) };
  }
  if (n.length === 3) {
    return { unitPrice: up, remove: rm, replace: rp, total: a, consistent: close(qty * up, a) };
  }
  return { unitPrice: up, remove: rm, replace: rp, consistent: false };
};

/** Picks the price columns whose numbers add up to the printed total */
export const readPrices = (qty: number, numbers: number[], hint?: PriceLayout): PriceReading & { warning?: string } => {
  if (numbers.length === 0) {
    return { unitPrice: 0, consistent: false, warning: 'No price found' };
  }
  if (numbers.length === 1) return { unitPrice: numbers[0], consistent: true };

  const byUnit = readUnitPrice(qty, numbers);
  const byRemove = numbers.length >= 3 ? readRemoveReplace(qty, numbers) : null;

  if (hint === 'removeReplace' && byRemove?.consistent) return byRemove;
  if (byUnit.consistent) return byUnit;
  if (byRemove?.consistent) return byRemove;

  const fallback = hint === 'removeReplace' && byRemove ? byRemove : byUnit;
  return { ...fallback, warning: "Prices don't add up to the line total - check the unit price" };
};

const tokenize = (line: string): string[] => line.trim().split(/\s+/).filter(Boolean);

interface TailMatch {
  description: string;
  quantity: number;
  unit: string;
  numbers: number[];
}

/**
 * Splits `<description> <qty> <unit> <numbers...>` apart. The quantity is the
 * first number+unit pair after which everything is a price column.
 */
const matchTail = (line: string, allowEmptyDescription = false): TailMatch | null => {
  const tokens = tokenize(line);
  for (let i = allowEmptyDescription ? 0 : 1; i < tokens.length - 1; i++) {
    let qtyToken = tokens[i];
    let unitToken = tokens[i + 1];
    let tailStart = i + 2;
    // "45.33LF"
    const glued = /^([\d,.]+)([A-Za-z]{2,4})$/.exec(tokens[i]);
    if (glued && isUnit(glued[2])) {
      qtyToken = glued[1];
      unitToken = glued[2];
      tailStart = i + 1;
    }
    const qty = parseNumber(qtyToken);
    if (qty == null || !isUnit(unitToken)) continue;
    const tail = tokens.slice(tailStart);
    if (!tail.every(isTailToken)) continue;
    const numbers = tail
      .filter((t) => !t.includes('%') && !t.includes('/'))
      .map((t) => parseNumber(t))
      .filter((n): n is number => n != null);
    return {
      description: tokens.slice(0, i).join(' '),
      quantity: qty,
      unit: normUnit(unitToken),
      numbers,
    };
  }
  return null;
};

const LINE_NUMBER_RE = /^\s*(\d{1,4})\.\s+(?=\S)/;

/** Report furniture: column headers, totals, page headers and room geometry */
const HEADER_WORDS = new Set([
  'description', 'desc', 'desc.', 'qty', 'quantity', 'unit', 'price', 'unit price', 'remove', 'replace',
  'tax', 'o&p', 'o', '&', 'p', 'rcv', 'acv', 'total', 'deprec', 'deprec.', 'depreciation', 'age/life',
  'cond', 'cond.', 'dep', 'dep%', '%', 'cat', 'sel', 'act', 'calc', 'reset', '#',
]);

/** A column header row, e.g. `DESCRIPTION QUANTITY UNIT PRICE TAX O&P RCV DEPREC. ACV` */
const isColumnHeader = (line: string): boolean => {
  const tokens = tokenize(line.toLowerCase());
  return tokens.length >= 2 && tokens.every((t) => HEADER_WORDS.has(t))
    && tokens.some((t) => t === 'description' || t === 'qty' || t === 'quantity' || t === 'remove');
};

const SKIP_RES: RegExp[] = [
  /^totals?\b/i,
  /^(line item totals|area totals?|area subtotal|subtotal|grand total|summary|recap|labor minimums?)\b/i,
  /^(page|continued|cont\.)\b/i,
  /^(missing wall|subroom|opens into|goes to|door|window|opening)\b/i,
  /\b(sf|lf|sy)\s+(walls?|ceiling|floor|long wall|short wall|floor perimeter|ceil\.? perimeter|flooring|perimeter)\b/i,
  /^(date|insured|property|claim|policy|type of loss|estimator|price list|estimate)\s*:/i,
  /^\d{1,2}\/\d{1,2}\/\d{2,4}\b/,
];

const isSkipLine = (line: string): boolean =>
  isColumnHeader(line) || SKIP_RES.some((re) => re.test(line.trim()));

const HEIGHT_RE = /\bheight\s*:/i;

const isGeometryLine = (line: string): boolean =>
  HEIGHT_RE.test(line) ||
  /\b(sf|lf|sy)\s+(walls?|ceiling|floor|long wall|short wall|floor perimeter|ceil\.? perimeter|perimeter)\b/i.test(line);

const looksLikeHeading = (line: string): boolean => {
  const text = line.trim();
  if (text.length === 0 || text.length > 48) return false;
  if (!/^[A-Z0-9]/.test(text)) return false;
  if (/[.,;:]$/.test(text)) return false;
  if (text.split(/\s+/).length > 6) return false;
  return /[A-Za-z]/.test(text);
};

const headingFrom = (line: string): string | null => {
  const text = line.trim();
  if (HEIGHT_RE.test(text)) {
    const before = text.split(HEIGHT_RE)[0].trim();
    return before || null;
  }
  return text || null;
};

let keySeq = 0;
const nextKey = () => `xp_${Date.now().toString(36)}_${(keySeq++).toString(36)}`;

const ACTIVITY_PREFIX: Record<string, string> = {
  '+': '',
  '-': 'Remove',
  '&': 'R&R',
  R: 'Detach & Reset',
  I: 'Install',
  M: 'Material Only',
};

const buildLine = (
  base: Omit<ParsedXactimateLine, 'key' | 'unitPrice' | 'warnings'>,
  numbers: number[],
  hint?: PriceLayout,
): ParsedXactimateLine => {
  const prices = readPrices(base.quantity, numbers, hint);
  const warnings: string[] = [];
  if (prices.warning) warnings.push(prices.warning);
  if (!base.description) warnings.push('No description');
  return {
    ...base,
    key: nextKey(),
    unitPrice: prices.unitPrice,
    remove: prices.remove,
    replace: prices.replace,
    tax: prices.tax,
    overheadProfit: prices.overheadProfit,
    xactimateTotal: prices.total,
    warnings,
  };
};

// ---------------------------------------------------------------------------
// Report text
// ---------------------------------------------------------------------------

const layoutHint = (text: string): PriceLayout | undefined => {
  if (/\bremove\b[\s\S]{0,40}\breplace\b/i.test(text)) return 'removeReplace';
  if (/\bunit\s*price\b/i.test(text)) return 'unitPrice';
  return undefined;
};

const CONTINUED_RE = /^continued\s*[-–:]\s*(.+)$/i;

const parseReport = (lines: string[], hint?: PriceLayout): XactimatePasteResult => {
  const items: ParsedXactimateLine[] = [];
  const rooms: string[] = [];
  const skippedLines: string[] = [];
  let room: string | undefined;
  let pending: { lineNumber?: number; parts: string[] } | null = null;
  let last: ParsedXactimateLine | null = null;
  let lastEndedAt = -2;

  // A full report prints room geometry or column headers. When it does, a
  // room name is only taken from right above those, so page headers (company
  // name, claim number) are not mistaken for rooms.
  const strictHeadings = lines.some((l) => isGeometryLine(l) || isColumnHeader(l));

  const setRoom = (name: string | null) => {
    if (!name) return;
    room = name;
    last = null;
    if (!rooms.includes(name)) rooms.push(name);
  };

  const nextSignificant = (from: number): string | undefined => {
    for (let j = from + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (t) return t;
    }
    return undefined;
  };

  const flushPending = () => {
    if (!pending) return;
    skippedLines.push([pending.lineNumber ? `${pending.lineNumber}.` : '', ...pending.parts].join(' ').trim());
    pending = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const numbered = LINE_NUMBER_RE.exec(line);
    const body = numbered ? line.slice(numbered[0].length) : line;

    if (pending) {
      const tail = !numbered ? matchTail(body, true) : null;
      if (tail && !isGeometryLine(line)) {
        const description = [...pending.parts, tail.description].filter(Boolean).join(' ');
        last = buildLine({ lineNumber: pending.lineNumber, room, description, quantity: tail.quantity, unit: tail.unit },
          tail.numbers, hint);
        items.push(last);
        lastEndedAt = i;
        pending = null;
        continue;
      }
      if (!numbered && !isSkipLine(line) && !isGeometryLine(line) && !CONTINUED_RE.test(line)) {
        pending.parts.push(line);
        continue;
      }
      // The numbered line never got its numbers: it was text, not an item.
      flushPending();
    }

    const continued = CONTINUED_RE.exec(line);
    if (continued) {
      setRoom(headingFrom(continued[1]));
      continue;
    }
    if (HEIGHT_RE.test(line)) {
      setRoom(headingFrom(line));
      continue;
    }

    const tail = matchTail(body);
    if (tail && !isGeometryLine(line)) {
      last = buildLine({ lineNumber: numbered ? Number(numbered[1]) : undefined, room,
        description: tail.description, quantity: tail.quantity, unit: tail.unit }, tail.numbers, hint);
      items.push(last);
      lastEndedAt = i;
      continue;
    }

    if (isSkipLine(line) || isGeometryLine(line)) continue;

    if (numbered) {
      pending = { lineNumber: Number(numbered[1]), parts: [body] };
      continue;
    }

    // Plain text: a room heading, a wrapped description, or an item note.
    const upcoming = nextSignificant(i);
    const upcomingNamesRoom = upcoming != null && HEIGHT_RE.test(upcoming) && headingFrom(upcoming) != null;
    if (upcoming && !upcomingNamesRoom && (isGeometryLine(upcoming) || isColumnHeader(upcoming))
      && looksLikeHeading(line)) {
      setRoom(headingFrom(line));
      continue;
    }
    const prev = last as ParsedXactimateLine | null;
    if (prev && lastEndedAt === i - 1 && !prev.note && prev.description.length >= 25 && line.length < 60
      && !/[.!?:]$/.test(line) && !/^[A-Z][a-z]+:/.test(line)) {
      // Long descriptions wrap onto the next line in reports.
      prev.description = `${prev.description} ${line}`;
      lastEndedAt = i;
      continue;
    }
    if (!strictHeadings && looksLikeHeading(line)) {
      const upcomingIsItem = upcoming != null && (LINE_NUMBER_RE.test(upcoming) || matchTail(upcoming) != null);
      if (upcomingIsItem || !prev) {
        setRoom(headingFrom(line));
        continue;
      }
    }
    if (prev) {
      prev.note = prev.note ? `${prev.note}\n${line}` : line;
      lastEndedAt = i;
      continue;
    }
    skippedLines.push(line);
  }
  flushPending();

  // Only rooms that ended up holding items
  const used = rooms.filter((r) => items.some((it) => it.room === r));
  return { items, rooms: used, skippedLines, format: 'report' };
};

// ---------------------------------------------------------------------------
// Grid copy (tab-separated)
// ---------------------------------------------------------------------------

type Column =
  | 'lineNumber' | 'category' | 'selector' | 'activity' | 'description' | 'quantity' | 'unit'
  | 'unitPrice' | 'remove' | 'replace' | 'tax' | 'overheadProfit' | 'total' | 'room';

const HEADER_PATTERNS: Array<[Column, RegExp]> = [
  ['lineNumber', /^(#|no\.?|line(\s*#)?|ln)$/i],
  ['category', /^(cat\.?|category|cat\s*code)$/i],
  ['selector', /^(sel\.?|selector|selection|item\s*code|code)$/i],
  ['activity', /^(act\.?|activity|action)$/i],
  ['description', /^(desc\.?|description|item description|line item)$/i],
  ['quantity', /^(qty\.?|quantity)$/i],
  ['unit', /^(unit|units|uom|u\/m)$/i],
  ['unitPrice', /^(unit\s*price|price|unit\s*cost|rate|reset)$/i],
  ['remove', /^remove$/i],
  ['replace', /^replace$/i],
  ['tax', /^(tax|sales\s*tax)$/i],
  ['overheadProfit', /^(o\s*&\s*p|o&p|op|overhead(\s*&\s*profit)?)$/i],
  ['total', /^(total|rcv|amount|ext\.?\s*price|line\s*total|extension)$/i],
  ['room', /^(room|area|group|section|location|level)$/i],
];

const headerColumn = (cell: string): Column | null => {
  const text = cell.trim();
  for (const [col, re] of HEADER_PATTERNS) if (re.test(text)) return col;
  return null;
};

const splitCells = (line: string): string[] => line.split('\t').map((c) => c.trim());

const parseGridRow = (
  cells: string[],
  map: Map<Column, number>,
  room: string | undefined,
  hint: PriceLayout | undefined,
): ParsedXactimateLine | null => {
  const get = (col: Column) => {
    const idx = map.get(col);
    return idx == null ? undefined : cells[idx];
  };
  let description = get('description') ?? '';
  let qtyText = get('quantity');
  let unitText = get('unit');
  // "45.33 LF" in a single Qty cell
  const combined = qtyText && /^([\d,.]+)\s*([A-Za-z]{2,4})$/.exec(qtyText);
  if (combined && isUnit(combined[2])) {
    qtyText = combined[1];
    unitText = unitText || combined[2];
  }
  const quantity = parseNumber(qtyText);
  if (!description || quantity == null) return null;

  const activity = (get('activity') ?? '').trim();
  const prefix = ACTIVITY_PREFIX[activity.toUpperCase()] ?? ACTIVITY_PREFIX[activity];
  if (prefix && !description.toLowerCase().startsWith(prefix.toLowerCase())) {
    description = `${prefix} ${description}`;
  }

  const num = (col: Column) => parseNumber(get(col)) ?? undefined;
  const remove = num('remove');
  const replace = num('replace');
  const unitPrice = num('unitPrice');
  const tax = num('tax');
  const overheadProfit = num('overheadProfit');
  const total = num('total');

  const warnings: string[] = [];
  let price: number;
  if (remove != null || replace != null) price = (remove ?? 0) + (replace ?? 0);
  else if (unitPrice != null) price = unitPrice;
  else if (total != null && quantity) {
    price = Math.round(((total - (tax ?? 0) - (overheadProfit ?? 0)) / quantity) * 100) / 100;
    warnings.push('Unit price worked out from the total');
  } else {
    price = 0;
    warnings.push('No price found');
  }
  if (total != null && !warnings.length && !close(quantity * price + (tax ?? 0) + (overheadProfit ?? 0), total)
    && !close(quantity * price, total)) {
    warnings.push("Prices don't add up to the line total - check the unit price");
  }
  void hint;

  const lineNo = parseNumber((get('lineNumber') ?? '').replace(/\.$/, ''));
  return {
    key: nextKey(),
    lineNumber: lineNo ?? undefined,
    room: get('room') || room,
    category: get('category') || undefined,
    selector: get('selector') || undefined,
    description,
    quantity,
    unit: unitText ? normUnit(unitText) : 'EA',
    unitPrice: price,
    remove,
    replace,
    tax,
    overheadProfit,
    xactimateTotal: total,
    warnings,
  };
};

/** Grid rows without a header row: find the unit cell and read around it */
const parseHeaderlessRow = (
  cells: string[],
  room: string | undefined,
  hint: PriceLayout | undefined,
): ParsedXactimateLine | null => {
  const filled = cells.filter(Boolean);
  let unitIdx = -1;
  let qty: number | null = null;
  let unit = '';
  for (let i = 0; i < cells.length; i++) {
    const glued = /^([\d,.]+)\s*([A-Za-z]{2,4})$/.exec(cells[i]);
    if (glued && isUnit(glued[2])) {
      unitIdx = i; qty = parseNumber(glued[1]); unit = normUnit(glued[2]);
      break;
    }
    if (isUnit(cells[i]) && i > 0) {
      const before = parseNumber(cells[i - 1]);
      if (before != null) { unitIdx = i; qty = before; unit = normUnit(cells[i]); break; }
    }
  }
  if (unitIdx < 0 || qty == null) {
    if (filled.length === 0) return null;
    const joined = matchTail(filled.join(' '));
    if (!joined) return null;
    return buildLine({ room, description: joined.description.replace(LINE_NUMBER_RE, ''),
      quantity: joined.quantity, unit: joined.unit }, joined.numbers, hint);
  }

  const qtyIdx = /^([\d,.]+)\s*[A-Za-z]{2,4}$/.test(cells[unitIdx]) ? unitIdx : unitIdx - 1;
  const leading = cells.slice(0, qtyIdx);
  // The description is the longest text cell before the quantity.
  let descIdx = -1;
  leading.forEach((c, i) => {
    if (parseNumber(c) != null && !/\s/.test(c)) return;
    if (descIdx < 0 || c.length > leading[descIdx].length) descIdx = i;
  });
  if (descIdx < 0) return null;
  const codes = leading.slice(0, descIdx).filter((c) => c && parseNumber(c.replace(/\.$/, '')) == null);
  const lineNo = leading.slice(0, descIdx).map((c) => parseNumber(c.replace(/\.$/, ''))).find((n) => n != null);
  let category: string | undefined;
  let selector: string | undefined;
  let description = leading[descIdx];
  for (const code of codes) {
    if (!category && /^[A-Z]{2,4}$/.test(code)) category = code;
    else if (category && !selector && !/\s/.test(code) && code.length <= 12 && !(code in ACTIVITY_PREFIX)) selector = code;
    else if (code in ACTIVITY_PREFIX && ACTIVITY_PREFIX[code]) description = `${ACTIVITY_PREFIX[code]} ${description}`;
  }
  const numbers = cells.slice(unitIdx + 1)
    .filter((c) => c && !c.includes('%') && !c.includes('/'))
    .map((c) => parseNumber(c))
    .filter((n): n is number => n != null);
  return buildLine({ lineNumber: lineNo ?? undefined, room, category, selector,
    description: description.replace(LINE_NUMBER_RE, ''), quantity: qty, unit }, numbers, hint);
};

const parseGrid = (lines: string[], hint?: PriceLayout): XactimatePasteResult => {
  const items: ParsedXactimateLine[] = [];
  const rooms: string[] = [];
  const skippedLines: string[] = [];
  let map: Map<Column, number> | null = null;
  let room: string | undefined;
  let rowHint = hint;

  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = splitCells(line);
    const filled = cells.filter(Boolean);

    const headerHits = cells.map(headerColumn);
    if (headerHits.filter(Boolean).length >= 2 && headerHits.includes('description')) {
      const header = new Map<Column, number>();
      headerHits.forEach((col, idx) => { if (col && !header.has(col)) header.set(col, idx); });
      if (header.has('remove') || header.has('replace')) rowHint = 'removeReplace';
      map = header;
      continue;
    }

    const item = map ? parseGridRow(cells, map, room, rowHint) : parseHeaderlessRow(cells, room, rowHint);
    if (item) {
      items.push(item);
      if (item.room && !rooms.includes(item.room)) rooms.push(item.room);
      continue;
    }

    const text = filled.join(' ');
    if (filled.length === 1 && !isSkipLine(text) && (looksLikeHeading(text) || HEIGHT_RE.test(text))) {
      const name = headingFrom(text);
      if (name) {
        room = name;
        if (!rooms.includes(name)) rooms.push(name);
      }
      continue;
    }
    if (!isSkipLine(text) && !isGeometryLine(text)) skippedLines.push(text);
  }
  return { items, rooms, skippedLines, format: 'grid' };
};

// ---------------------------------------------------------------------------

export const parseXactimatePaste = (text: string): XactimatePasteResult => {
  const lines = (text || '').replace(/\r\n?/g, '\n').replace(/ /g, ' ').split('\n');
  const nonEmpty = lines.filter((l) => l.trim());
  if (nonEmpty.length === 0) return { items: [], rooms: [], skippedLines: [], format: 'empty' };

  const hint = layoutHint(text);
  const tabbed = nonEmpty.filter((l) => l.includes('\t')).length;
  if (tabbed > 0 && tabbed >= nonEmpty.length * 0.5) {
    const grid = parseGrid(lines, hint);
    if (grid.items.length > 0) return grid;
    // Tabs but nothing usable: fall back to reading it as text.
    return parseReport(lines.map((l) => l.replace(/\t+/g, '  ')), hint);
  }
  return parseReport(lines, hint);
};

/**
 * Turns the HTML a browser puts on the clipboard for a copied table into
 * tab-separated text, so cells survive even when the plain text flattens them.
 * Returns null when the HTML holds no table. Needs a DOM (`DOMParser`).
 */
export const htmlTableToTsv = (html: string): string | null => {
  if (!html || typeof DOMParser === 'undefined' || !/<table[\s>]/i.test(html)) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rows = Array.from(doc.querySelectorAll('tr'));
  if (rows.length === 0) return null;
  return rows
    .map((tr) => Array.from(tr.querySelectorAll('th,td'))
      .map((cell) => (cell.textContent || '').replace(/\s+/g, ' ').trim())
      .join('\t'))
    .join('\n');
};
