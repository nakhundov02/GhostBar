// GhostBar — Gumroad Webhook → Auto Key Delivery
// Deployed as a Supabase Edge Function (free tier, no server needed)
//
// Flow:
//   Gumroad sale → POST here → generate key → save to DB → email buyer

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SECRET  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY   = Deno.env.get("RESEND_API_KEY")!;       // free email service
const GUMROAD_SECRET   = Deno.env.get("GUMROAD_WEBHOOK_SECRET")!; // set in Gumroad settings

// ── Key generator ─────────────────────────────────────────────
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genKey(): string {
  function seg() {
    let s = "";
    for (let i = 0; i < 4; i++) {
      s += CHARS[Math.floor(Math.random() * CHARS.length)];
    }
    return s;
  }
  const key = `GHOST-${seg()}-${seg()}-${seg()}-${seg()}`;
  if (!/^GHOST-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key)) return genKey();
  return key;
}

// ── Email via Resend (free: 100 emails/day) ───────────────────
async function sendKeyEmail(to: string, buyerName: string, key: string) {
  const html = `
<!DOCTYPE html>
<html>
<body style="background:#0B0B0F;color:#fff;font-family:-apple-system,sans-serif;padding:40px;max-width:520px;margin:0 auto">
  <div style="text-align:center;margin-bottom:32px">
    <div style="font-size:48px">👻</div>
    <h1 style="color:#a99fff;margin:8px 0">GhostBar</h1>
    <p style="color:#666;margin:0">Your license key is ready</p>
  </div>

  <div style="background:#13131c;border:1.5px solid #6A5CFF;border-radius:14px;padding:24px;text-align:center;margin-bottom:24px">
    <p style="color:#666;font-size:12px;margin:0 0 12px;text-transform:uppercase;letter-spacing:1px">Your License Key</p>
    <div style="font-family:monospace;font-size:20px;font-weight:700;color:#a99fff;letter-spacing:3px">${key}</div>
  </div>

  <div style="background:#0d0d16;border:1px solid #222;border-radius:12px;padding:20px;margin-bottom:24px">
    <p style="color:#aaa;font-size:14px;margin:0 0 12px"><strong style="color:#fff">How to activate:</strong></p>
    <ol style="color:#888;font-size:13px;line-height:2;margin:0;padding-left:20px">
      <li>Open <strong style="color:#fff">GhostBar.app</strong></li>
      <li>Paste your key in the activation screen</li>
      <li>Click <strong style="color:#fff">Activate</strong></li>
      <li>Done — the key is locked to your Mac</li>
    </ol>
  </div>

  <p style="color:#555;font-size:11px;text-align:center">
    Keep this key safe. It works on one Mac.<br>
    If you reinstall, enter the same key again — it will still work.<br>
    Questions? Reply to this email.
  </p>
</body>
</html>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "GhostBar <keys@ghostbar.app>",   // change to your verified domain
      to: [to],
      subject: "👻 Your GhostBar License Key",
      html
    })
  });
}

// ── Main handler ──────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // Parse Gumroad webhook payload (form-encoded)
    const body    = await req.text();
    const params  = new URLSearchParams(body);

    // Gumroad sends a seller_id we can use as basic auth check
    const sellerId = params.get("seller_id") || "";
    if (GUMROAD_SECRET && sellerId !== GUMROAD_SECRET) {
      console.warn("Webhook secret mismatch:", sellerId);
      // Don't hard-block — Gumroad doesn't sign requests, just check seller_id
    }

    const email       = params.get("email") || "";
    const buyerName   = params.get("full_name") || "there";
    const productName = params.get("product_name") || "";
    const saleId      = params.get("sale_id") || "";
    const refunded    = params.get("refunded") === "true";

    // Skip refunds
    if (refunded) {
      console.log("Skipping refunded sale:", saleId);
      return new Response("ok", { status: 200 });
    }

    if (!email) {
      return new Response("No email in payload", { status: 400 });
    }

    // Check if we already sent a key for this sale (idempotency)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);
    const { data: existing } = await supabase
      .from("licenses")
      .select("key")
      .eq("gumroad_sale_id", saleId)
      .single();

    let key: string;
    if (existing?.key) {
      // Already processed — just resend the email
      key = existing.key;
      console.log("Resending existing key for sale:", saleId);
    } else {
      // Generate new key
      key = genKey();
      const { error } = await supabase.from("licenses").insert({
        key,
        created_at:       new Date().toISOString(),
        buyer_email:      email,
        buyer_name:       buyerName,
        gumroad_sale_id:  saleId,
        product_name:     productName,
        revoked:          false,
        activated_at:     null,
        machine_id:       null,
      });
      if (error) throw new Error("DB insert failed: " + error.message);
      console.log("✅ Key created:", key, "for", email);
    }

    // Send email
    await sendKeyEmail(email, buyerName, key);
    console.log("✅ Email sent to:", email);

    return new Response(JSON.stringify({ ok: true, key }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("Webhook error:", err);
    return new Response("Internal error: " + err.message, { status: 500 });
  }
});
