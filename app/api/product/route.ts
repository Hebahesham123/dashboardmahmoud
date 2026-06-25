import { NextRequest, NextResponse } from "next/server";
import { fetchProductByHandle } from "@/lib/shopify";

export const dynamic = "force-dynamic";

/** Extract the product handle from a storefront URL or a raw handle. */
function parseHandle(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  // full URL like https://store/products/handle or /en/products/handle?variant=...
  const m = s.match(/\/products\/([^/?#]+)/i);
  if (m) return decodeURIComponent(m[1]);
  // if they pasted just the handle (no slashes/spaces)
  if (!/[\s/]/.test(s)) return s;
  return null;
}

/** GET /api/product?url=<storefront product url> — returns the product + variants. */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") || req.nextUrl.searchParams.get("handle") || "";
  const handle = parseHandle(url);
  if (!handle) {
    return NextResponse.json(
      { error: "Couldn't read a product handle from that URL. Paste a link like .../products/your-product." },
      { status: 400 }
    );
  }
  try {
    const product = await fetchProductByHandle(handle);
    if (!product) {
      return NextResponse.json({ error: `No product found for "${handle}".` }, { status: 404 });
    }
    return NextResponse.json({ ok: true, product });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
