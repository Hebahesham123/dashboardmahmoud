import { NextRequest, NextResponse } from "next/server";
import { createDraftOrder } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/order — create a Shopify Draft Order from a (recovered) cart,
 * applying an optional percentage discount. Returns the invoice URL the
 * call center can send to the customer to complete payment.
 */
export async function POST(req: NextRequest) {
  const store = process.env.SHOPIFY_STORE_DOMAIN!;
  try {
    const body = await req.json();
    const lineItems = Array.isArray(body.lineItems) ? body.lineItems : [];
    if (lineItems.length === 0) {
      return NextResponse.json({ error: "No line items." }, { status: 400 });
    }
    const draft = await createDraftOrder({
      lineItems: lineItems.map((li: Record<string, unknown>) => ({
        variant_id: li.variant_id ? Number(li.variant_id) : null,
        title: li.title ? String(li.title) : undefined,
        price: li.price != null ? Number(li.price) : undefined,
        quantity: Math.max(1, Number(li.quantity) || 1),
      })),
      email: body.email ?? null,
      discountCode: body.discountCode ?? "",
      discountPct: Number(body.discountPct) || 0,
      note: body.note ?? "Created by call center from abandoned cart",
    });

    return NextResponse.json({
      ok: true,
      id: draft.id,
      name: draft.name,
      total_price: Number(draft.total_price || 0),
      invoice_url: draft.invoice_url,
      admin_url: `https://${store}/admin/draft_orders/${draft.id}`,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
