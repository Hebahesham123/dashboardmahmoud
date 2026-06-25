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
export function aggregateTraffic(cells: string[][]): {
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

  // If this is a "by landing page" report, only count the NS Home page
  // (/pages/ns-home-1 and its /en, /ar variants) — not every landing page.
  const pathIdx = findCol(headers, (h) => h.includes("landingpagepath") || h.includes("path"));
  if (pathIdx >= 0) {
    const NS_HOME = "pages/ns-home-1";
    const filtered = dataRows.filter((c) =>
      (c[pathIdx] || "").toLowerCase().includes(NS_HOME)
    );
    // only narrow if we actually matched the page (otherwise keep all rows)
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
  // e.g. "June 20, 2026" or "20/06/2026" — let Date try, then format UTC
  const d = new Date(t);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return null;
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

  // Find the header row: scan the first 15 rows for one that contains a
  // date/day column (handles title/preamble rows above the table).
  let headerRow = 0;
  for (let r = 0; r < Math.min(cells.length, 15); r++) {
    if (cells[r].some((h) => norm(h).includes("day") || norm(h).includes("date"))) {
      headerRow = r;
      break;
    }
  }
  const headers = cells[headerRow];
  const dataRows = cells.slice(headerRow + 1);

  const dateIdx = findCol(headers, (h) => h.includes("day") || h.includes("date"));
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

  const rows: TrafficRow[] = [];
  for (const c of dataRows) {
    const date = toDate(c[dateIdx]);
    if (!date) continue;
    rows.push({
      traffic_date: date,
      visitors: toNum(c[visitorsIdx]),
      sessions: toNum(c[sessionsIdx]),
      add_to_cart: toNum(c[cartIdx]),
      reached_checkout: toNum(c[checkoutIdx]),
    });
  }
  if (rows.length === 0)
    errors.push(`No valid date rows found under the "${headers[dateIdx]}" column.`);

  return { rows, mapping, headers, errors };
}
