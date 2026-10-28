import { createServiceClient } from "@/lib/supabase";
import { fetchAbandonedCheckouts } from "@/lib/shopify";

/** Egyptian mobile without the leading 0 or country code: 01012345678 / +201012345678 → 1012345678. */
export function cleanMobile(raw: string | null | undefined): string | null {
  let d = (raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  // Country code, sometimes typed with the 0 still on: 201012345678, 2001012345678.
  const eg = d.match(/^20(0?1\d{9})$/);
  if (eg) d = eg[1];
  d = d.replace(/^0+/, "");
  return d.length >= 9 ? d : null;
}

const cairoDay = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date(iso));

/**
 * Pull every open abandoned checkout from Shopify into abandoned_checkouts.
 * A saved checkout that is no longer open, but is newer than the oldest one
 * Shopify still returns, was bought — it gets recovered_at and leaves the sheets.
 */
export async function saveAbandonedCheckouts() {
  const checkouts = await fetchAbandonedCheckouts(200);
  const now = new Date().toISOString();
  const rows = checkouts.map((c) => {
    const a = c.shipping_address ?? c.billing_address;
    const name =
      [c.customer?.first_name, c.customer?.last_name].filter(Boolean).join(" ").trim() ||
      (a?.name ?? "").trim() ||
      [a?.first_name, a?.last_name].filter(Boolean).join(" ").trim();
    const phone = c.phone || c.customer?.phone || c.shipping_address?.phone || c.billing_address?.phone || null;
    return {
      id: c.id,
      created_at: c.created_at,
      day: cairoDay(c.created_at),
      mobile: cleanMobile(phone),
      phone_raw: phone,
      name: name || null,
      email: c.email || c.customer?.email || null,
      total_price: Number(c.total_price || 0),
      recovered_at: null,
      updated_at: now,
    };
  });

  const sb = createServiceClient();
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("abandoned_checkouts").upsert(rows.slice(i, i + 500), { onConflict: "id" });
    if (error) throw new Error(`abandoned_checkouts upsert: ${error.message}`);
  }

  let recovered = 0;
  if (rows.length) {
    const oldest = rows.reduce((m, r) => (r.created_at < m ? r.created_at : m), rows[0].created_at);
    const open = new Set(rows.map((r) => r.id));
    const { data } = await sb
      .from("abandoned_checkouts")
      .select("id")
      .gte("created_at", oldest)
      .is("recovered_at", null);
    const gone = ((data ?? []) as { id: number }[]).map((r) => r.id).filter((id) => !open.has(id));
    for (let i = 0; i < gone.length; i += 500) {
      await sb.from("abandoned_checkouts").update({ recovered_at: now }).in("id", gone.slice(i, i + 500));
    }
    recovered = gone.length;
  }
  return { saved: rows.length, recovered };
}
