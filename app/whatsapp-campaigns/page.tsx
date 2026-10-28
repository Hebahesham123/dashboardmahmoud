"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader, EmptyState } from "@/components/ui";
import { fmtNum } from "@/lib/format";

interface Checkout {
  id: number;
  mobile: string | null;
  name: string;
  date: string; // YYYY-MM-DD, Cairo
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_KEY = "wa_campaign_days";

/** Dates are handled as plain YYYY-MM-DD strings, worked on at UTC noon so no timezone shifts a day. */
const toDate = (s: string) => new Date(`${s}T12:00:00Z`);
const toStr = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toStr(d);
};
const weekday = (s: string) => toDate(s).getUTCDay();
const nice = (s: string) =>
  toDate(s).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const cairoToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());

interface Sheet {
  sendOn: string; // the campaign day
  from: string; // first abandoned day it covers
  to: string; // last abandoned day it covers (the day before sendOn)
  rows: Checkout[]; // one per mobile, newest abandon kept
  skipped: number; // checkouts in the window with no mobile
}

/**
 * Cut the checkouts into sheets: each campaign day takes everything abandoned
 * from the previous campaign day up to the day before it.
 */
function buildSheets(checkouts: Checkout[], days: number[], today: string): Sheet[] {
  if (!checkouts.length || !days.length) return [];
  const first = checkouts[0].date;
  // The first campaign day after the first abandon.
  let sendOn = addDays(first, 1);
  while (!days.includes(weekday(sendOn))) sendOn = addDays(sendOn, 1);
  let from = first;

  const sheets: Sheet[] = [];
  // Run on until the sheet that holds today (still filling up).
  for (let guard = 0; guard < 1000; guard++) {
    const to = addDays(sendOn, -1);
    const inWindow = checkouts.filter((c) => c.date >= from && c.date <= to);
    const byMobile = new Map<string, Checkout>();
    for (const c of inWindow) if (c.mobile) byMobile.set(c.mobile, c); // sorted oldest first, so the latest wins
    sheets.push({
      sendOn,
      from,
      to,
      rows: [...byMobile.values()].sort((a, b) => a.date.localeCompare(b.date)),
      skipped: inWindow.filter((c) => !c.mobile).length,
    });
    if (to >= today) break;
    from = sendOn;
    sendOn = addDays(sendOn, 1);
    while (!days.includes(weekday(sendOn))) sendOn = addDays(sendOn, 1);
  }
  return sheets.reverse();
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function downloadSheet(s: Sheet) {
  const lines = ["Mobile,Name,Date", ...s.rows.map((r) => [r.mobile ?? "", csvCell(r.name), r.date].join(","))];
  // The BOM makes Excel read the Arabic names as UTF-8.
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `whatsapp-abandoned-${s.sendOn}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function WhatsAppCampaignsPage() {
  const [checkouts, setCheckouts] = useState<Checkout[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [days, setDays] = useState<number[]>([0, 3]); // Sunday and Wednesday
  const [openSheet, setOpenSheet] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(DAYS_KEY) || "null");
      if (Array.isArray(saved) && saved.length === 2) setDays(saved);
    } catch {}
  }, []);

  const pickDay = (slot: 0 | 1, d: number) => {
    const next = [...days];
    next[slot] = d;
    setDays(next);
    try {
      localStorage.setItem(DAYS_KEY, JSON.stringify(next));
    } catch {}
  };

  useEffect(() => {
    fetch("/api/whatsapp-campaigns")
      .then(async (r) => {
        const text = await r.text();
        try {
          return JSON.parse(text);
        } catch {
          throw new Error(`Server error (${r.status}).`);
        }
      })
      .then((j) => {
        if (!j.ok) return setError(j.error || "Failed to load");
        setCheckouts(j.checkouts);
        setSaveError(j.saveError ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const today = cairoToday();
  const uniqueDays = useMemo(() => [...new Set(days)], [days]);
  const sheets = useMemo(
    () => (checkouts ? buildSheets(checkouts, uniqueDays, today) : []),
    [checkouts, uniqueDays, today]
  );

  return (
    <div>
      <PageHeader
        title="WhatsApp Campaigns"
        description="Abandoned checkouts cut into one sheet per campaign day, ready to download for WhatsApp."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-[#e7e2dc] bg-white p-3 text-xs">
        <span className="text-gray-400">Campaign days</span>
        {([0, 1] as const).map((slot) => (
          <select
            key={slot}
            value={days[slot]}
            onChange={(e) => pickDay(slot, Number(e.target.value))}
            className="rounded-lg border border-[#ddd6cd] bg-white px-2.5 py-1.5 font-medium text-gray-700"
          >
            {WEEKDAYS.map((w, i) => (
              <option key={w} value={i}>
                {w}
              </option>
            ))}
          </select>
        ))}
        <span className="text-gray-400">
          · each sheet holds what was abandoned since the last campaign day
        </span>
      </div>

      {saveError && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          Couldn&apos;t fetch the newest checkouts from Shopify ({saveError}) — showing what is already saved.
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      )}

      {!sheets.length ? (
        <EmptyState loading={loading} label="No abandoned checkouts." />
      ) : (
        <section className="overflow-hidden rounded-xl border border-[#e7e2dc] bg-white">
          <div className="flex items-baseline justify-between gap-3 border-b border-gray-200 px-4 py-3">
            <h2 className="text-sm font-bold text-gray-900">Sheets</h2>
            <p className="text-[11px] text-gray-400">
              {fmtNum(sheets.length)} sheets since {nice(sheets[sheets.length - 1].from)}
            </p>
          </div>
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-gray-50">
              <tr className="text-[10px] uppercase tracking-wider text-gray-500">
                <th className="border-b border-gray-200 px-4 py-2 font-semibold">Send on</th>
                <th className="border-b border-gray-200 px-3 py-2 font-semibold">Abandoned</th>
                <th className="border-b border-gray-200 px-3 py-2 text-right font-semibold">Mobiles</th>
                <th className="border-b border-gray-200 px-3 py-2 text-right font-semibold">No mobile</th>
                <th className="border-b border-gray-200 px-4 py-2 text-right font-semibold">CSV</th>
              </tr>
            </thead>
            <tbody>
              {sheets.map((s) => {
                const isOpen = openSheet === s.sendOn;
                const current = s.to >= today;
                return (
                  <SheetRows key={s.sendOn} s={s} isOpen={isOpen} current={current} onToggle={() => setOpenSheet(isOpen ? null : s.sendOn)} />
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <p className="mt-3 px-1 text-[11px] leading-relaxed text-gray-400">
        Mobiles are shown without the leading 0 or the +20 (01012345678 → 1012345678). A number that abandoned more than
        once in the same sheet appears once, with its latest date. Checkouts left without a mobile can&apos;t be sent to,
        so they are counted but not in the CSV. Checkouts are saved to the database each time this page opens and on the daily
        sync, so sheets stay even after Shopify drops them (it keeps about three months). Anyone who went on to buy is
        taken off.
      </p>
    </div>
  );
}

function SheetRows({
  s,
  isOpen,
  current,
  onToggle,
}: {
  s: Sheet;
  isOpen: boolean;
  current: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-b border-gray-100 hover:bg-gray-50 ${isOpen ? "bg-[#faf7f3]" : ""}`}
      >
        <td className="px-4 py-2 font-medium text-gray-900">
          <span className={`mr-1.5 inline-block w-3 text-[9px] text-gray-400 ${isOpen ? "rotate-90" : ""}`}>▶</span>
          {nice(s.sendOn)}
          {current && (
            <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
              filling up
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-gray-500">
          {s.from === s.to ? nice(s.from) : `${nice(s.from)} – ${nice(s.to)}`}
        </td>
        <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900">{fmtNum(s.rows.length)}</td>
        <td className="px-3 py-2 text-right tabular-nums text-gray-400">{s.skipped ? fmtNum(s.skipped) : "—"}</td>
        <td className="px-4 py-2 text-right">
          <button
            disabled={!s.rows.length}
            onClick={(e) => {
              e.stopPropagation();
              downloadSheet(s);
            }}
            className="rounded-lg border border-[#ddd6cd] bg-white px-2.5 py-1 text-[11px] font-medium text-[#6f4423] hover:bg-[#faf7f3] disabled:opacity-40"
          >
            Download
          </button>
        </td>
      </tr>
      {isOpen &&
        (s.rows.length ? (
          s.rows.map((r) => (
            <tr key={r.id} className="border-b border-gray-100 bg-[#fdfbf8] text-[11px]">
              <td className="py-1.5 pl-9 pr-3 tabular-nums text-gray-800">{r.mobile}</td>
              <td className="px-3 py-1.5 text-gray-700" dir="auto">
                {r.name || <span className="text-gray-300">—</span>}
              </td>
              <td colSpan={3} className="px-4 py-1.5 text-right tabular-nums text-gray-500">
                {r.date}
              </td>
            </tr>
          ))
        ) : (
          <tr className="border-b border-gray-100 bg-[#fdfbf8]">
            <td colSpan={5} className="py-2 pl-9 text-[11px] text-gray-400">
              No mobiles in this sheet.
            </td>
          </tr>
        ))}
    </>
  );
}
