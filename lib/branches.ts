/**
 * Odoo branches kept out of the dashboard entirely: no column, and not in any
 * total. "فرع معارض" is the exhibitions account, not a shop.
 *
 * The data is still synced and stored; it is only left out when read.
 */
const HIDDEN_BRANCHES = ["فرع معارض"];

export function isHiddenBranch(branch: string | null | undefined): boolean {
  const b = (branch ?? "").trim();
  return HIDDEN_BRANCHES.some((h) => h === b);
}
