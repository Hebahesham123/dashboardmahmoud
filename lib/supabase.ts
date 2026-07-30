import { createClient } from "@supabase/supabase-js";

// Read env vars lazily (inside the functions) so that tools which load env
// after import — e.g. the dotenv-based backfill script — work correctly.

/**
 * Next.js caches `fetch` responses by default, and supabase-js issues its
 * queries through `fetch` — so a route that reads a table would keep serving
 * the row set from the first request forever (persisted in .next/cache and
 * across deploys). `export const dynamic = "force-dynamic"` does not cover it.
 * Every Supabase read must opt out explicitly.
 */
const noStoreFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: "no-store" });

/**
 * Browser/anon client — read-only access (RLS allows public select).
 * Safe to use in client components.
 */
export function createBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { fetch: noStoreFetch },
  });
}

/**
 * Service-role client — FULL access, bypasses RLS.
 * Server-side ONLY (sync job, backfill). Never import into a client component.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
    global: { fetch: noStoreFetch },
  });
}
