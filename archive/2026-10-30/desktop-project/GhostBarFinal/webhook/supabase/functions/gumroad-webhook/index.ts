// GhostBar — Gumroad Webhook → Auto Key Delivery via Brevo
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SECRET = Deno.env.get("GB_SERVICE_ROLE_KEY")!;
const BREVO_KEY       = Deno.env.get("BREVO_API_KEY")!;
const GMAIL_USER      = Deno.env.get("GMAIL_USER")!;

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genKey(): string {
  const seg = () => Array.from({length:4}, () => CHARS[Math.floor(Math.random()*CHARS.length)]).join('');
  return `GHOST-${seg()}-${seg()}-${seg()}-${seg()}`;
}

async function sendKeyEmail(to: string, buyerName: string, key: string) {
  const html = `<!DOCTYPE html>
<html>
<body style="background:#0B0B0F;color:#fff;font-family:-apple-system,sans-serif;padding:40px;max-width:520px;margin:0 auto">
  <div style="text-align:center;margin-bottom:32px">
    <img src="https://i.imgur.com/QdEyGxn.png" width="80" height="80" style="border-radius:16px;margin-bottom:8px" />
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
    Keep this key safe. It works on one Mac only.<br>
    If you reinstall macOS, enter the same key again.<br>
    Support: ${GMAIL_USER}
  </p>
</body>
</html>`;

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": BREVO_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      sender: { name: "GhostBar", email: GMAIL_USER },
      to: [{ email: to, name: buyerName }],
      subject: "👻 Your GhostBar License Key",
      htmlContent: html
    })
  });

  const result = await res.json();
  if (!res.ok) throw new Error("Brevo error: " + JSON.stringify(result));
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200 });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const body   = await req.text();
    const params = new URLSearchParams(body);

    const email       = params.get("email") || "";
    const buyerName   = params.get("full_name") || "there";
    const productName = params.get("product_name") || "";
    const saleId      = params.get("sale_id") || "";
    const refunded    = params.get("refunded") === "true";

    if (refunded) return new Response("ok", { status: 200 });
    if (!email)   return new Response("No email", { status: 400 });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);

    const { data: existing } = await supabase
      .from("licenses")
      .select("key")
      .eq("gumroad_sale_id", saleId)
      .maybeSingle();

    let key: string;
    if (existing?.key) {
      key = existing.key;
    } else {
      key = genKey();
      const { error } = await supabase.from("licenses").insert({
        key,
        created_at:      new Date().toISOString(),
        buyer_email:     email,
        buyer_name:      buyerName,
        gumroad_sale_id: saleId,
        product_name:    productName,
        revoked:         false,
      });
      if (error) throw new Error("DB insert: " + error.message);
    }

    await sendKeyEmail(email, buyerName, key);
    console.log("✅ Key sent to:", email);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("Webhook error:", err);
    return new Response("Error: " + err.message, { status: 500 });
  }
});
