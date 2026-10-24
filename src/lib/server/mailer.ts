import { headers } from "next/headers";

/**
 * Transactional email through Brevo's HTTP API — a plain fetch, no SDK.
 *
 * Needs BREVO_API_KEY and MAIL_FROM (a sender address verified in Brevo).
 * Without them, development prints the email to the server console so the
 * flow stays testable; production logs an error and sends nothing.
 */
export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  const from = process.env.MAIL_FROM;

  if (!apiKey || !from) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`\n[dev email] to ${input.to}: ${input.subject}\n${input.text}\n`);
      return true;
    }
    console.error("sendEmail: BREVO_API_KEY or MAIL_FROM is not set; email not sent.");
    return false;
  }

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: from, name: "RaktSetu" },
        to: [{ email: input.to }],
        subject: input.subject,
        textContent: input.text,
        htmlContent: input.html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`sendEmail failed: ${res.status} ${await res.text().catch(() => "")}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("sendEmail failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

/** Absolute origin for links in emails: configured URL first, request host only as a dev fallback. */
export async function siteOrigin(): Promise<string> {
  const configured = process.env.RAKTSETU_SITE_URL
    ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const proto = (h.get("x-forwarded-proto") ?? "http").split(",")[0].trim();
  return `${proto}://${h.get("host") ?? "localhost:3000"}`;
}
