/**
 * Lightweight CSV parser + Shopify-Analytics header mapper.
 * No external dependencies. Handles quoted fields and commas/newlines.
 */

export interface TrafficRow {
  traffic_date: string; // YYYY-MM-DD
  visitors: number;
  sessions: number;
  add_to_cart: number;
  reached_checkout: number;
}

/** Parse raw CSV text into an array of cell-arrays. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  // strip BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((f) => f.trim() !== "")) rows.push(row);
  }
  return rows;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Aggregate a report that has NO per-day breakdown (e.g. "Sessions by
 * landing page") into a single set of totals by summing every data row.
 * Returns null if none of the four metric columns can be found.
 */
export function aggregateTraffic(
  cells: string[][],
  opts?: { productHandles?: Set<string> }
): {
  visitors: number;
  sessions: number;
  add_to_cart: number;
  reached_checkout: number;
  headers: string[];
} | null {
  if (cells.length < 2) return null;

  // Find header row (first row containing any known metric keyword).
  let headerRow = 0;
  for (let r = 0; r < Math.min(cells.length, 15); r++) {
    if (
      cells[r].some((h) => {
        const n = norm(h);
        return n.includes("visitor") || n.includes("session");
      })
    ) {
      headerRow = r;
      break;
    }
  }
  const headers = cells[headerRow];
  let dataRows = cells.slice(headerRow + 1);

  const visitorsIdx = findCol(headers, (h) => h.includes("visitor"));
  const sessionsIdx = findCol(
    headers,
    (h) => h.includes("session") && !h.includes("cart") && !h.includes("checkout") && !h.includes("visitor")
  );
  const cartIdx = findCol(headers, (h) => h.includes("cart"));
  const checkoutIdx = findCol(headers, (h) => h.includes("checkout"));

  if (visitorsIdx < 0 && sessionsIdx < 0 && cartIdx < 0 && checkoutIdx < 0) return null;

  // If this is a "by landing page" report, only count NS Home store traffic:
  // the NS Home page/homepage, OR a product page that belongs to the
  // "ns-home" collection (productHandles). Plain product pages NOT in the
  // collection are excluded.
  const pathIdx = findCol(headers, (h) => h.includes("landingpagepath") || h.includes("path"));
  if (pathIdx >= 0) {
    const handles = opts?.productHandles;
    const productHandle = (p: string) => {
      const m = (p || "").toLowerCase().match(/\/products\/([^/?#]+)/);
      return m ? m[1] : null;
    };
    const isStore = (p: string) => {
      const x = (p || "").toLowerCase();
      if (x.includes("ns-home")) return true; // the NS Home page (not the generic homepage)
      const h = productHandle(x);
      if (!h) return false;
      // product page: include only if it's in the ns-home collection
      return handles ? handles.has(h) : false;
    };
    const filtered = dataRows.filter((c) => isStore(c[pathIdx]));
    if (filtered.length > 0) dataRows = filtered;
  }

  const sum = (idx: number) =>
    idx < 0 ? 0 : dataRows.reduce((s, c) => s + toNum(c[idx]), 0);

  return {
    visitors: sum(visitorsIdx),
    sessions: sum(sessionsIdx),
    add_to_cart: sum(cartIdx),
    reached_checkout: sum(checkoutIdx),
    headers,
  };
}

/** Find the index of the first header that matches a predicate. */
function findCol(headers: string[], pred: (h: string) => boolean): number {
  return headers.findIndex((h) => pred(norm(h)));
}

function toNum(v: string | undefined): number {
  if (!v) return 0;
  const n = Number(v.replace(/[, %]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Normalize a date cell (handles YYYY-MM-DD and common formats) to YYYY-MM-DD. */
function toDate(v: string | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  // already ISO
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // A bare number is not a date to Date(): "261308" became the year 261308 and
  // the database refused it ("time zone displacement out of range"). Only an
  // Excel day serial (≈ 2000–2100) counts; any other number is a count, not a day.
  if (/^\d+(\.\d+)?$/.test(t)) {
    const serial = Number(t);
    if (serial < 36_526 || serial > 73_051) return null;
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
  }
  // Only text that carries a 4-digit year can be a date. Date() is lenient:
  // it read the landing page "/pages/ns-home-1" as 1 Jan 2001.
  if (!/\b(19|20)\d{2}\b/.test(t) || t.startsWith("/")) return null;
  // e.g. "June 20, 2026". Date reads it as local midnight, so take the local
  // day — UTC would move it to the day before east of Greenwich.
  const d = new Date(t);
  if (isNaN(d.getTime())) return null;
  const year = d.getFullYear();
  if (year < 2000 || year > 2100) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Map parsed CSV rows to TrafficRow[]. Auto-detects Shopify Analytics headers.
 * Expected/recognized columns (case-insensitive, fuzzy):
 *   Date/Day · Visitors · Sessions · Add to cart · Reached checkout
 * Returns { rows, mapping } so the UI can show what was detected.
 */
export function mapTrafficCsv(cells: string[][]): {
  rows: TrafficRow[];
  mapping: Record<string, string | null>;
  headers: string[];
  errors: string[];
} {
  const errors: string[] = [];
  if (cells.length < 2) {
    return { rows: [], mapping: {}, headers: cells[0] ?? [], errors: ["File has no data rows."] };
  }

  // Find the header row: scan the first 15 rows for one that has a Day/Date
  // column AND a traffic metric (handles title/preamble rows above the
  // table). The column name must BE "Day"/"Date": matching any cell that
  // contains "day" took the landing page ".../black-friday" for a header.
  const isDateHeader = (h: string) => h === "day" || h === "date" || h === "reportdate";
  const isMetric = (h: string) => h.includes("visitor") || h.includes("session");
  let headerRow = -1;
  for (let r = 0; r < Math.min(cells.length, 15); r++) {
    const n = cells[r].map(norm);
    if (n.some(isDateHeader) && n.some(isMetric)) {
      headerRow = r;
      break;
    }
  }
  const headers = cells[Math.max(headerRow, 0)];
  const dataRows = cells.slice(Math.max(headerRow, 0) + 1);

  const dateIdx = headerRow < 0 ? -1 : findCol(headers, isDateHeader);
  const visitorsIdx = findCol(headers, (h) => h.includes("visitor"));
  // sessions: a "session" column that is NOT the cart/checkout/visitor one
  const sessionsIdx = findCol(
    headers,
    (h) =>
      h.includes("session") &&
      !h.includes("cart") &&
      !h.includes("checkout") &&
      !h.includes("visitor")
  );
  const cartIdx = findCol(headers, (h) => h.includes("cart"));
  const checkoutIdx = findCol(headers, (h) => h.includes("checkout"));

  const mapping = {
    date: dateIdx >= 0 ? headers[dateIdx] : null,
    visitors: visitorsIdx >= 0 ? headers[visitorsIdx] : null,
    sessions: sessionsIdx >= 0 ? headers[sessionsIdx] : null,
    add_to_cart: cartIdx >= 0 ? headers[cartIdx] : null,
    reached_checkout: checkoutIdx >= 0 ? headers[checkoutIdx] : null,
  };

  if (dateIdx < 0) {
    errors.push(
      `Could not find a Date/Day column. Columns found: [${headers.join(", ")}].`
    );
    return { rows: [], mapping, headers, errors };
  }

  // One row per day. A report can list the same day more than once (split
  // by hour, landing page, device…); those rows are added together. Sending
  // a day twice made the database refuse the whole upload ("ON CONFLICT DO
  // UPDATE command cannot affect row a second time").
  const byDay = new Map<string, TrafficRow>();
  for (const c of dataRows) {
    const date = toDate(c[dateIdx]);
    if (!date) continue;
    const r = byDay.get(date) ?? { traffic_date: date, visitors: 0, sessions: 0, add_to_cart: 0, reached_checkout: 0 };
    r.visitors += toNum(c[visitorsIdx]);
    r.sessions += toNum(c[sessionsIdx]);
    r.add_to_cart += toNum(c[cartIdx]);
    r.reached_checkout += toNum(c[checkoutIdx]);
    byDay.set(date, r);
  }
  const rows = [...byDay.values()];
  if (rows.length === 0)
    errors.push(`No valid date rows found under the "${headers[dateIdx]}" column.`);

  return { rows, mapping, headers, errors };
}
