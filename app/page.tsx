import { redirect } from "next/navigation";

/**
 * Insights is the landing page. Overview moved to /overview; this redirect
 * keeps every existing bookmark and the "back to Overview" links working, and
 * happens on the server so there is no flash of the wrong page.
 */
export default function Home() {
  redirect("/insights");
}
