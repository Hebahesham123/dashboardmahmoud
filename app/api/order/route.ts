import { NextRequest, NextResponse } from "next/server";
import { createDraftOrder, fetchDraftOrders } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET /api/order — list recent draft orders created via the dashboard. */
export async function GET() {
  const store = process.env.SHOPIFY_STORE_DOMAIN!;
  try {
    const list = await fetchDraftOrders(50);
    return NextResponse.json({
      ok: true,
      orders: list.map((d) => ({
        id: d.id,
        name: d.name,
        created_at: d.created_at,
        total_price: Number(d.total_price || 0),
        status: d.status,
        customer_name: d.customer
          ? `${d.customer.first_name ?? ""} ${d.customer.last_name ?? ""}`.trim()
          : null,
        email: d.email,
        invoice_url: d.invoice_url,
        admin_url: `https://${store}/admin/draft_orders/${d.id}`,
      })),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

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

    const dValue = Number(body.discountValue) || 0;
    const dType = body.discountType === "fixed_amount" ? "fixed_amount" : "percentage";
    const dCode = (body.discountCode ?? "").trim();
    // Tag the order: always "checkout", plus the discount % (or amount) and code.
    const tagParts = ["checkout"];
    if (dValue > 0) tagParts.push(dType === "percentage" ? `${dValue}%` : `discount ${dValue}`);
    if (dCode) tagParts.push(dCode);

    const draft = await createDraftOrder({
      lineItems: lineItems.map((li: Record<string, unknown>) => ({
        variant_id: li.variant_id ? Number(li.variant_id) : null,
        title: li.title ? String(li.title) : undefined,
        price: li.price != null ? Number(li.price) : undefined,
        quantity: Math.max(1, Number(li.quantity) || 1),
      })),
      email: body.email ?? null,
      discountCode: dCode,
      discountType: dType,
      discountValue: dValue,
      note: body.note ?? "Created by call center from abandoned cart",
      tags: tagParts.join(", "),
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
