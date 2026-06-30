/** One row per day from the `daily_metrics` view — mirrors the sheet's top table. */
export interface DailyMetric {
  day: string; // YYYY-MM-DD
  month: string; // YYYY-MM
  visitors: number;
  sessions: number;
  add_to_cart: number;
  reached_checkout: number;
  orders_count: number;
  checkout_count: number; // abandoned = reached_checkout - orders
  total_sales: number;
  total_refunds: number; // lost value (gross - net)
  aov: number;
  orders_fulfilled: number;
  items_sold: number;
  conversion_rate: number; // fraction (0..1)
  abandoned_rate: number; // fraction (0..1)
  unpaid_orders: number; // COD / pending (not paid yet)
  unpaid_sales: number; // value of those unpaid orders
}

/** One row per (day, channel) from `daily_orders_by_channel`. */
export interface ChannelSales {
  order_date: string;
  channel: "online" | "offline" | "draft";
  orders: number;
  sales: number;
  fulfilled: number;
  items: number;
}

export interface BestSeller {
  product_id: number | null;
  title: string;
  units_sold: number;
  revenue: number;
}
