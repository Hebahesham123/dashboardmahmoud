import { NextResponse } from "next/server";
import { fetchAbandonedCheckouts, fetchProductHandles } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/abandoned — live list of abandoned checkouts from Shopify,
 * each with its line items + a link to open the product on the storefront.
 * ?summary=1 returns just id/date/total (fast — no product handle lookups).
 */
export async function GET(req: Request) {
  const store = process.env.SHOPIFY_STORE_DOMAIN!;
  const summary = new URL(req.url).searchParams.get("summary") === "1";
  try {
    const checkouts = await fetchAbandonedCheckouts();

    if (summary) {
      return NextResponse.json({
        ok: true,
        count: checkouts.length,
        checkouts: checkouts.map((c) => ({
          id: c.id,
          created_at: c.created_at,
          total_price: Number(c.total_price || 0),
        })),
      });
    }

    const fmtAddr = (a: typeof checkouts[number]["shipping_address"]) => {
      if (!a) return null;
      return [a.address1, a.address2, a.city, a.province, a.country, a.zip]
        .filter((x) => x && String(x).trim())
        .join(", ");
    };

    // Resolve storefront handles so items link to the public product page.
    const ids = checkouts.flatMap((c) => (c.line_items ?? []).map((li) => li.product_id ?? 0));
    const handles = await fetchProductHandles(ids);

    const data = checkouts.map((c) => ({
      id: c.id,
      checkout_number: c.name || `#${c.id}`,
      created_at: c.created_at,
      email: c.email || c.customer?.email || null,
      phone:
        c.phone ||
        c.customer?.phone ||
        c.shipping_address?.phone ||
        c.billing_address?.phone ||
        null,
      city: c.shipping_address?.city || c.billing_address?.city || null,
      address: fmtAddr(c.shipping_address) || fmtAddr(c.billing_address) || null,
      currency: c.currency,
      total_price: Number(c.total_price || 0),
      recovery_url: c.abandoned_checkout_url,
      customer_name: c.customer
        ? `${c.customer.first_name ?? ""} ${c.customer.last_name ?? ""}`.trim()
        : null,
      items: (c.line_items ?? []).map((li) => {
        const handle = li.product_id ? handles[li.product_id] : undefined;
        return {
          title: li.title,
          variant_title: li.variant_title,
          quantity: li.quantity,
          price: Number(li.price || 0),
          product_id: li.product_id,
          variant_id: li.variant_id,
          // public storefront product page (falls back to admin if no handle)
          url: handle
            ? `https://${store}/products/${handle}`
            : li.product_id
            ? `https://${store}/admin/products/${li.product_id}`
            : null,
        };
      }),
    }));
    return NextResponse.json({ ok: true, count: data.length, checkouts: data });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
