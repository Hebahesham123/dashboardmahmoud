/**
 * Meta (Facebook / Instagram) Marketing API client — read-only ad insights.
 *
 * Needs, in .env.local (server-side only):
 *   META_ACCESS_TOKEN    long-lived System User token with `ads_read`
 *   META_AD_ACCOUNT_ID   the ad account number (with or without "act_")
 *   META_API_VERSION     optional, defaults to v23.0
 */

export interface MetaConfig {
  token: string;
  account: string; // always "act_123…"
  version: string;
}

export function metaConfig(): MetaConfig | null {
  const token = process.env.META_ACCESS_TOKEN?.trim();
  const raw = process.env.META_AD_ACCOUNT_ID?.trim();
  if (!token || !raw) return null;
  return {
    token,
    account: raw.startsWith("act_") ? raw : `act_${raw}`,
    version: process.env.META_API_VERSION?.trim() || "v23.0",
  };
}

type Params = Record<string, string | number | undefined>;

async function graph<T>(cfg: MetaConfig, path: string, params: Params = {}): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${cfg.version}/${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  url.searchParams.set("access_token", cfg.token);
  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json();
  if (!res.ok || json.error) {
    const e = json.error || {};
    throw new Error(`Meta API: ${e.message || res.statusText}${e.code ? ` (code ${e.code})` : ""}`);
  }
  return json as T;
}

/** Follows `paging.next` until the edge is exhausted (capped for safety). */
async function graphAll<T>(cfg: MetaConfig, path: string, params: Params = {}, maxPages = 20): Promise<T[]> {
  const out: T[] = [];
  let page = await graph<{ data: T[]; paging?: { next?: string } }>(cfg, path, params);
  out.push(...page.data);
  for (let i = 1; i < maxPages && page.paging?.next; i++) {
    const res = await fetch(page.paging.next, { cache: "no-store" });
    page = await res.json();
    if (!Array.isArray(page.data)) break;
    out.push(...page.data);
  }
  return out;
}

// ---------------------------------------------------------------- insights

interface Action {
  action_type: string;
  value: string;
}
interface RawInsight {
  date_start: string;
  date_stop: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  frequency?: string;
  clicks?: string;
  inline_link_clicks?: string;
  actions?: Action[];
  action_values?: Action[];
  video_thruplay_watched_actions?: Action[];
  campaign_id?: string;
  campaign_name?: string;
  objective?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  age?: string;
  gender?: string;
  publisher_platform?: string;
  platform_position?: string;
  region?: string;
  device_platform?: string;
  hourly_stats_aggregated_by_advertiser_time_zone?: string;
}

const FIELDS = [
  "spend",
  "impressions",
  "reach",
  "clicks",
  "inline_link_clicks",
  "actions",
  "action_values",
].join(",");

/** Meta reports the same event under several names; take the first one present. */
const EVENT_KEYS = {
  purchase: ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"],
  addToCart: ["omni_add_to_cart", "add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"],
  checkout: ["omni_initiated_checkout", "initiate_checkout", "offsite_conversion.fb_pixel_initiate_checkout"],
  viewContent: ["omni_view_content", "view_content", "offsite_conversion.fb_pixel_view_content"],
  landingView: ["landing_page_view", "omni_landing_page_view"],
  messages: ["onsite_conversion.messaging_conversation_started_7d"],
  leads: ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"],
};

function pick(list: Action[] | undefined, keys: string[]): number {
  if (!list) return 0;
  for (const k of keys) {
    const hit = list.find((a) => a.action_type === k);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

/** One normalised row: raw counts only. Rates are derived on the client. */
export interface MetaRow {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  linkClicks: number;
  landingViews: number;
  viewContent: number;
  addToCart: number;
  checkout: number;
  purchases: number;
  revenue: number;
  messages: number;
  leads: number;
}

function norm(r: RawInsight): MetaRow {
  return {
    spend: Number(r.spend) || 0,
    impressions: Number(r.impressions) || 0,
    reach: Number(r.reach) || 0,
    clicks: Number(r.clicks) || 0,
    linkClicks: Number(r.inline_link_clicks) || 0,
    landingViews: pick(r.actions, EVENT_KEYS.landingView),
    viewContent: pick(r.actions, EVENT_KEYS.viewContent),
    addToCart: pick(r.actions, EVENT_KEYS.addToCart),
    checkout: pick(r.actions, EVENT_KEYS.checkout),
    purchases: pick(r.actions, EVENT_KEYS.purchase),
    revenue: pick(r.action_values, EVENT_KEYS.purchase),
    messages: pick(r.actions, EVENT_KEYS.messages),
    leads: pick(r.actions, EVENT_KEYS.leads),
  };
}

function insights(cfg: MetaConfig, from: string, to: string, extra: Params) {
  return graphAll<RawInsight>(cfg, `${cfg.account}/insights`, {
    fields: FIELDS,
    time_range: JSON.stringify({ since: from, until: to }),
    limit: 500,
    ...extra,
  });
}

// ---------------------------------------------------------------- report

export interface MetaReport {
  account: { name: string; currency: string; timezone: string };
  window: { from: string; to: string };
  totals: MetaRow;
  daily: (MetaRow & { day: string })[];
  campaigns: (MetaRow & { id: string; name: string; objective: string; status: string; budget: number | null })[];
  adsets: (MetaRow & { id: string; name: string; campaign: string })[];
  ads: (MetaRow & { id: string; name: string; campaign: string; thumbnail: string | null })[];
  ageGender: (MetaRow & { age: string; gender: string })[];
  placements: (MetaRow & { platform: string; position: string })[];
  regions: (MetaRow & { region: string })[];
  devices: (MetaRow & { device: string })[];
  hours: (MetaRow & { hour: number })[];
  sample?: boolean;
}

const empty = (): MetaRow => ({
  spend: 0, impressions: 0, reach: 0, clicks: 0, linkClicks: 0, landingViews: 0, viewContent: 0,
  addToCart: 0, checkout: 0, purchases: 0, revenue: 0, messages: 0, leads: 0,
});

/** Breakdowns are optional extras — one failing must not sink the report. */
async function soft<T>(p: Promise<T[]>): Promise<T[]> {
  try {
    return await p;
  } catch {
    return [];
  }
}

export async function fetchMetaReport(cfg: MetaConfig, from: string, to: string): Promise<MetaReport> {
  const [acct, total, daily, camps, campMeta, adsets, ads, ageGender, placements, regions, devices, hours] =
    await Promise.all([
      graph<{ name: string; currency: string; timezone_name: string }>(cfg, cfg.account, {
        fields: "name,currency,timezone_name",
      }),
      insights(cfg, from, to, { level: "account" }),
      insights(cfg, from, to, { level: "account", time_increment: 1 }),
      insights(cfg, from, to, { level: "campaign", fields: `${FIELDS},campaign_id,campaign_name,objective` }),
      soft(
        graphAll<{ id: string; effective_status: string; daily_budget?: string; lifetime_budget?: string }>(
          cfg,
          `${cfg.account}/campaigns`,
          { fields: "id,effective_status,daily_budget,lifetime_budget", limit: 500 }
        )
      ),
      soft(insights(cfg, from, to, { level: "adset", fields: `${FIELDS},adset_id,adset_name,campaign_name` })),
      soft(
        insights(cfg, from, to, {
          level: "ad",
          fields: `${FIELDS},ad_id,ad_name,campaign_name`,
          sort: "spend_descending",
        })
      ),
      soft(insights(cfg, from, to, { level: "account", breakdowns: "age,gender" })),
      soft(insights(cfg, from, to, { level: "account", breakdowns: "publisher_platform,platform_position" })),
      soft(insights(cfg, from, to, { level: "account", breakdowns: "region" })),
      soft(insights(cfg, from, to, { level: "account", breakdowns: "device_platform" })),
      soft(insights(cfg, from, to, {
          level: "account",
          breakdowns: "hourly_stats_aggregated_by_advertiser_time_zone",
          // Reach can't be split by hour — Meta rejects the call if asked.
          fields: "spend,impressions,clicks,inline_link_clicks,actions,action_values",
        })),
    ]);

  const status = new Map(campMeta.map((c) => [c.id, c]));
  // Budgets come back in the currency's minor unit (piasters, cents).
  const budget = (id: string) => {
    const c = status.get(id);
    const b = c?.daily_budget ?? c?.lifetime_budget;
    return b ? Number(b) / 100 : null;
  };

  // Ad thumbnails: one batched lookup for the top ads by spend.
  const topAds = ads.slice(0, 50);
  const thumbs = new Map<string, string>();
  if (topAds.length) {
    try {
      const res = await graph<Record<string, { creative?: { thumbnail_url?: string; image_url?: string } }>>(cfg, "", {
        ids: topAds.map((a) => a.ad_id).join(","),
        fields: "creative{thumbnail_url,image_url}",
      });
      for (const [id, v] of Object.entries(res)) {
        const u = v.creative?.image_url || v.creative?.thumbnail_url;
        if (u) thumbs.set(id, u);
      }
    } catch {
      /* thumbnails are cosmetic */
    }
  }

  return {
    account: { name: acct.name, currency: acct.currency, timezone: acct.timezone_name },
    window: { from, to },
    totals: total[0] ? norm(total[0]) : empty(),
    daily: daily.map((r) => ({ day: r.date_start, ...norm(r) })),
    campaigns: camps
      .map((r) => ({
        id: r.campaign_id || "",
        name: r.campaign_name || "—",
        objective: (r.objective || "").replace(/^OUTCOME_/, "").replace(/_/g, " ").toLowerCase(),
        status: status.get(r.campaign_id || "")?.effective_status || "UNKNOWN",
        budget: budget(r.campaign_id || ""),
        ...norm(r),
      }))
      .sort((a, b) => b.spend - a.spend),
    adsets: adsets
      .map((r) => ({ id: r.adset_id || "", name: r.adset_name || "—", campaign: r.campaign_name || "", ...norm(r) }))
      .sort((a, b) => b.spend - a.spend),
    ads: topAds.map((r) => ({
      id: r.ad_id || "",
      name: r.ad_name || "—",
      campaign: r.campaign_name || "",
      thumbnail: thumbs.get(r.ad_id || "") || null,
      ...norm(r),
    })),
    ageGender: ageGender.map((r) => ({ age: r.age || "?", gender: r.gender || "unknown", ...norm(r) })),
    placements: placements
      .map((r) => ({ platform: r.publisher_platform || "?", position: r.platform_position || "?", ...norm(r) }))
      .sort((a, b) => b.spend - a.spend),
    regions: regions.map((r) => ({ region: r.region || "Unknown", ...norm(r) })).sort((a, b) => b.spend - a.spend),
    devices: devices.map((r) => ({ device: r.device_platform || "?", ...norm(r) })),
    hours: hours
      .map((r) => ({ hour: Number((r.hourly_stats_aggregated_by_advertiser_time_zone || "0").slice(0, 2)), ...norm(r) }))
      .sort((a, b) => a.hour - b.hour),
  };
}

// ---------------------------------------------------------------- sample data

/**
 * Deterministic made-up numbers so the page can be previewed before the
 * Meta credentials are added. Always flagged `sample: true`.
 */
export function sampleMetaReport(from: string, to: string): MetaReport {
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const mk = (spend: number, roas: number, ctr = 0.012): MetaRow => {
    const impressions = Math.round((spend / 45) * 1000 * (0.8 + rnd() * 0.4));
    const linkClicks = Math.round(impressions * ctr * (0.8 + rnd() * 0.4));
    const landingViews = Math.round(linkClicks * 0.72);
    const viewContent = Math.round(landingViews * 0.85);
    const addToCart = Math.round(viewContent * (0.08 + rnd() * 0.05));
    const checkout = Math.round(addToCart * 0.45);
    const revenue = spend * roas * (0.8 + rnd() * 0.4);
    const purchases = Math.max(0, Math.round(revenue / 2400));
    return {
      spend, impressions, reach: Math.round(impressions / (1.6 + rnd())), clicks: Math.round(linkClicks * 1.6),
      linkClicks, landingViews, viewContent, addToCart, checkout, purchases, revenue,
      messages: Math.round(linkClicks * 0.02), leads: 0,
    };
  };
  const add = (rows: MetaRow[]): MetaRow =>
    rows.reduce((t, r) => {
      (Object.keys(t) as (keyof MetaRow)[]).forEach((k) => (t[k] += r[k]));
      return t;
    }, empty());

  const days: string[] = [];
  for (let d = new Date(from + "T00:00:00Z"); d <= new Date(to + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  const daily = days.map((day, i) => ({ day, ...mk(2500 + rnd() * 2500 + i * 40, 3 + rnd() * 2.5) }));
  const totals = add(daily);
  totals.reach = Math.round(totals.reach * 0.55);

  const split = (names: string[], weights: number[], roas: number[]) => {
    const sum = weights.reduce((a, b) => a + b, 0);
    return names.map((n, i) => ({ n, row: mk((totals.spend * weights[i]) / sum, roas[i]) }));
  };

  const campaigns = split(
    ["Sales | Bedroom Collection", "Sales | Retargeting 30d", "Sales | Advantage+ Catalog", "Awareness | New Arrivals", "Traffic | Bathroom Sets"],
    [34, 18, 26, 12, 10],
    [3.8, 7.1, 4.6, 0.6, 1.9]
  ).map(({ n, row }, i) => ({
    id: `c${i}`, name: n, objective: n.split(" | ")[0].toLowerCase(),
    status: i === 4 ? "PAUSED" : "ACTIVE", budget: [1500, 800, 1200, 500, 400][i], ...row,
  }));

  const ads = split(
    ["Duvet set – video 15s", "Carousel – best sellers", "UGC review – towels", "Catalog DPA", "Static – 20% off", "Reel – room makeover", "Story – free delivery", "Static – new colors"],
    [22, 18, 14, 13, 10, 9, 8, 6],
    [5.2, 4.4, 6.0, 4.1, 3.0, 2.2, 1.5, 0.9]
  ).map(({ n, row }, i) => ({ id: `a${i}`, name: n, campaign: campaigns[i % 3].name, thumbnail: null, ...row }));

  const adsets = split(
    ["Broad 22-55 F", "Lookalike 1% buyers", "Website visitors 30d", "Interests – home decor", "Cairo & Giza"],
    [28, 22, 18, 17, 15],
    [3.6, 4.9, 7.4, 2.8, 3.1]
  ).map(({ n, row }, i) => ({ id: `s${i}`, name: n, campaign: campaigns[i % 3].name, ...row }));

  const ageGender: MetaReport["ageGender"] = [];
  const ages = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"];
  const aw = [6, 26, 30, 20, 12, 6];
  for (const g of ["female", "male"]) {
    ages.forEach((a, i) => {
      const w = (aw[i] * (g === "female" ? 0.68 : 0.32)) / 100;
      ageGender.push({ age: a, gender: g, ...mk(totals.spend * w, g === "female" ? 4.4 : 2.6) });
    });
  }

  const placements = (
    [
      ["facebook", "feed", 30, 3.9], ["instagram", "feed", 22, 4.6], ["instagram", "instagram_reels", 16, 3.2],
      ["instagram", "instagram_stories", 12, 2.9], ["facebook", "facebook_reels", 7, 2.1],
      ["audience_network", "an_classic", 5, 0.8], ["facebook", "marketplace", 5, 2.4], ["messenger", "messenger_inbox", 3, 1.2],
    ] as [string, string, number, number][]
  ).map(([platform, position, w, roas]) => ({ platform, position, ...mk((totals.spend * w) / 100, roas) }));

  const regions = (
    [["Cairo Governorate", 38, 4.4], ["Giza Governorate", 22, 4.1], ["Alexandria Governorate", 14, 3.7],
     ["Qalyubia Governorate", 7, 2.9], ["Sharqia Governorate", 5, 2.5], ["Dakahlia Governorate", 5, 2.2],
     ["Red Sea Governorate", 4, 3.3], ["Other", 5, 1.8]] as [string, number, number][]
  ).map(([region, w, roas]) => ({ region, ...mk((totals.spend * w) / 100, roas) }));

  const devices = ([["mobile_app", 78, 3.6], ["mobile_web", 9, 2.7], ["desktop", 13, 5.1]] as [string, number, number][])
    .map(([device, w, roas]) => ({ device, ...mk((totals.spend * w) / 100, roas) }));

  const hw = [2, 1, 1, 0.5, 0.5, 0.5, 1, 2, 3, 4, 5, 5, 6, 6, 6, 6, 6, 6, 7, 8, 9, 9, 7, 4];
  const hsum = hw.reduce((a, b) => a + b, 0);
  const hours = hw.map((w, hour) => ({ hour, ...mk((totals.spend * w) / hsum, 2 + (w / 9) * 3) }));

  return {
    account: { name: "Sample Ad Account", currency: "EGP", timezone: "Africa/Cairo" },
    window: { from, to },
    totals, daily, campaigns, adsets, ads, ageGender, placements, regions, devices, hours,
    sample: true,
  };
}
