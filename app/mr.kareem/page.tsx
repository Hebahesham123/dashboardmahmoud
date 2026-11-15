"use client";

import { useEffect } from "react";

/**
 * Mr. Kareem's link. Opening it switches this browser to a view that shows
 * only Insights and Summary (see AppShell), then goes to Insights.
 *
 * /mr.kareem?exit=1 switches the browser back to the full dashboard.
 */
export default function MrKareemPage() {
  useEffect(() => {
    const exit = new URLSearchParams(window.location.search).get("exit") === "1";
    try {
      if (exit) localStorage.removeItem("viewer_mode");
      else localStorage.setItem("viewer_mode", "kareem");
    } catch {
      /* no browser storage — the restriction cannot stick */
    }
    window.location.replace("/insights");
  }, []);
  return <p className="p-6 text-sm text-gray-400">Opening…</p>;
}
