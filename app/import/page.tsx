"use client";

import { useRef, useState } from "react";
import { useDash } from "@/components/DataProvider";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { fmtNum, toISODate } from "@/lib/format";

interface Entry {
  traffic_date: string;
  visitors: string;
  sessions: string;
  add_to_cart: string;
  reached_checkout: string;
}

const emptyEntry = (): Entry => ({
  traffic_date: toISODate(new Date()),
  visitors: "",
  sessions: "",
  add_to_cart: "",
  reached_checkout: "",
});

export default function ImportPage() {
  const { traffic, reload, loading, month } = useDash();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "err" | "info"; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [entry, setEntry] = useState<Entry>(emptyEntry());
  // When a no-date report is uploaded, assign its totals to this day.
  const [uploadDate, setUploadDate] = useState(toISODate(new Date()));

  const onFile = async (file: File) => {
    setBusy(true);
    setStatus({ tone: "info", msg: `Reading "${file.name}"…` });
    try {
      const name = file.name.toLowerCase();
      // Shopify names an export after its date range, e.g.
      // "Sessions by landing page - 2026-11-01 - 2026-11-01.csv". A one-day
      // report goes to that day rather than to whatever the picker shows
      // (it defaults to today, so a report for the 1st landed on the 16th).
      const range = file.name.match(/(\d{4}-\d{2}-\d{2})\D+(\d{4}-\d{2}-\d{2})/);
      const date = range && range[1] === range[2] ? range[1] : uploadDate;
      if (date !== uploadDate) setUploadDate(date);
      let cells: string[][];

      if (name.endsWith(".xml")) {
        cells = await parseXml(file);
      } else {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        cells = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "" });
      }

      const res = await fetch("/api/traffic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cells, month, date }),
      });
      const json = await res.json();
      if (!res.ok) {
        const found = json.headers?.length ? ` Columns found: [${json.headers.join(", ")}].` : "";
        throw new Error((json.error || "Import failed") + found);
      }

      if (json.mode === "daily-assigned") {
        const t = json.totals;
        setStatus({
          tone: "ok",
          msg: `Saved to ${json.date}: Visitors ${t.visitors}, Sessions ${t.sessions}, Cart ${t.add_to_cart}, Reached Checkout ${t.reached_checkout}. These numbers now appear on that day (and roll into the month).`,
        });
      } else if (json.mode === "monthly") {
        const t = json.totals;
        setStatus({
          tone: "ok",
          msg: `Stored as ${json.month} TOTAL (report had no dates). Visitors ${t.visitors}, Sessions ${t.sessions}, Cart ${t.add_to_cart}, Reached Checkout ${t.reached_checkout}. These fill the Month Total + monthly Conversion/Abandoned.`,
        });
      } else {
        const m = json.mapping || {};
        setStatus({
          tone: "ok",
          msg: `Imported ${json.imported} day(s). Columns used: ${
            json.columnsWritten?.join(", ") || "—"
          }. Mapped → Visitors: ${m.visitors ?? "—"}, Sessions: ${m.sessions ?? "—"}, Cart: ${
            m.add_to_cart ?? "—"
          }, Checkout: ${m.reached_checkout ?? "—"}.`,
        });
      }
      await reload();
    } catch (e) {
      setStatus({ tone: "err", msg: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const saveEntry = async () => {
    if (!entry.traffic_date) {
      setStatus({ tone: "err", msg: "Please choose a date." });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/traffic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: [entry] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      setStatus({ tone: "ok", msg: `Saved ${entry.traffic_date}.` });
      setEntry(emptyEntry());
      await reload();
    } catch (e) {
      setStatus({ tone: "err", msg: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const editRow = (t: (typeof traffic)[number]) => {
    setEntry({
      traffic_date: t.traffic_date,
      visitors: String(t.visitors),
      sessions: String(t.sessions),
      add_to_cart: String(t.add_to_cart),
      reached_checkout: String(t.reached_checkout),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const deleteRow = async (date: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/traffic?date=${date}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || "Delete failed");
      setStatus({ tone: "ok", msg: `Deleted ${date}.` });
      await reload();
    } catch (e) {
      setStatus({ tone: "err", msg: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Import Data" description="Bring in the storefront-traffic numbers Shopify's API can't provide — by file or by hand." />

      {status && (
        <div
          className={`mb-6 rounded-lg p-3 text-sm ${
            status.tone === "ok"
              ? "bg-emerald-50 text-emerald-700"
              : status.tone === "err"
              ? "bg-rose-50 text-rose-700"
              : "bg-sky-50 text-sky-700"
          }`}
        >
          {status.msg}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Manual entry */}
        <Card title="Manual Entry" subtitle="Type one day's numbers and save (overwrites that date)">
          <div className="grid grid-cols-2 gap-4 p-5">
            <Field label="Date">
              <input
                type="date"
                value={entry.traffic_date}
                onChange={(e) => setEntry({ ...entry, traffic_date: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Visitors">
              <NumInput value={entry.visitors} onChange={(v) => setEntry({ ...entry, visitors: v })} />
            </Field>
            <Field label="Sessions">
              <NumInput value={entry.sessions} onChange={(v) => setEntry({ ...entry, sessions: v })} />
            </Field>
            <Field label="Add to Cart">
              <NumInput value={entry.add_to_cart} onChange={(v) => setEntry({ ...entry, add_to_cart: v })} />
            </Field>
            <Field label="Reached Checkout">
              <NumInput value={entry.reached_checkout} onChange={(v) => setEntry({ ...entry, reached_checkout: v })} />
            </Field>
            <div className="col-span-2 flex gap-2">
              <button
                onClick={saveEntry}
                disabled={busy}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save day"}
              </button>
              <button
                onClick={() => setEntry(emptyEntry())}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                Clear
              </button>
            </div>
          </div>
        </Card>

        {/* File upload */}
        <Card title="Upload Report (Excel / CSV / XML)" subtitle="Assign a date — a no-date report's totals are saved to that day">
          <div className="p-5">
            <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
              <label className="mb-1 block text-xs font-semibold text-indigo-700">
                📅 Assign uploaded numbers to this day
              </label>
              <input
                type="date"
                value={uploadDate}
                onChange={(e) => setUploadDate(e.target.value)}
                className="w-full rounded-lg border border-indigo-300 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-[11px] text-indigo-600">
                A “by landing page” report has no dates, so its NS-Home total is stored on the day you pick here.
                If the file name has a single day (e.g. “… - 2026-11-01 - 2026-11-01.csv”), that day is used.
              </p>
            </div>
            <div
              className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 px-6 py-8 text-center"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) onFile(f);
              }}
            >
              <span className="text-3xl">📈</span>
              <p className="text-sm text-gray-600">Drag &amp; drop, or</p>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                Choose file
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls,.xml"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                  if (fileRef.current) fileRef.current.value = "";
                }}
              />
            </div>
            <ul className="mt-3 space-y-1 text-xs text-gray-500">
              <li>• <strong>By-day report</strong> (has a Day column) → fills each day automatically (the date above is ignored).</li>
              <li>• <strong>“By landing page” report</strong> (no dates) → its NS-Home total is saved to the <strong>day you pick above</strong>, so it shows in the daily columns and the month.</li>
              <li>• Only products in the <strong>ns-home</strong> collection + the NS Home page are counted.</li>
            </ul>
          </div>
        </Card>
      </div>

      <Card className="mt-6" title={`Imported Traffic — ${month}`} subtitle="Click Edit to load a day into the form above">
        {traffic.length === 0 ? (
          <EmptyState loading={loading} label="No traffic for this month yet — add a day above." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3 text-right">Visitors</th>
                  <th className="px-5 py-3 text-right">Sessions</th>
                  <th className="px-5 py-3 text-right">Add to Cart</th>
                  <th className="px-5 py-3 text-right">Reached Checkout</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {[...traffic]
                  .sort((x, y) => x.traffic_date.localeCompare(y.traffic_date))
                  .map((t) => (
                    <tr key={t.traffic_date} className="border-t hover:bg-gray-50">
                      <td className="px-5 py-2.5 font-medium">{t.traffic_date}</td>
                      <td className="px-5 py-2.5 text-right">{fmtNum(t.visitors)}</td>
                      <td className="px-5 py-2.5 text-right">{fmtNum(t.sessions)}</td>
                      <td className="px-5 py-2.5 text-right">{fmtNum(t.add_to_cart)}</td>
                      <td className="px-5 py-2.5 text-right">{fmtNum(t.reached_checkout)}</td>
                      <td className="px-5 py-2.5 text-right">
                        <button onClick={() => editRow(t)} className="mr-3 text-indigo-600 hover:underline">
                          Edit
                        </button>
                        <button onClick={() => deleteRow(t.traffic_date)} className="text-rose-600 hover:underline">
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Parse a Shopify analytics XML export (<result><meta><columns>… <data><row>…) into cells. */
async function parseXml(file: File): Promise<string[][]> {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Invalid XML file.");

  const colNames = Array.from(doc.querySelectorAll("meta > columns > column > name")).map(
    (n) => n.textContent || ""
  );
  const rowEls = Array.from(doc.querySelectorAll("data > row"));
  if (colNames.length === 0 || rowEls.length === 0) {
    // fallback: derive columns from the first row's child tags
    if (rowEls.length === 0) throw new Error("No <row> data found in XML.");
    const first = rowEls[0];
    const tags = Array.from(first.children).map((c) => c.tagName);
    const header = tags;
    const rows = rowEls.map((r) => tags.map((t) => r.getElementsByTagName(t)[0]?.textContent ?? ""));
    return [header, ...rows];
  }
  const rows = rowEls.map((r) =>
    colNames.map((c) => r.getElementsByTagName(c)[0]?.textContent ?? "")
  );
  return [colNames, ...rows];
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-gray-500">
      {label}
      {children}
    </label>
  );
}

function NumInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="number"
      min="0"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="0"
      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
    />
  );
}
