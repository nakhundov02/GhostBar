# Deploy Guide — Gumroad Auto-Key Delivery

## What you need (all free)
- Supabase account (you already have one)
- Resend account → resend.com (free: 100 emails/day = 100 sales/day)
- Gumroad account

---

## STEP 1 — Add columns to your Supabase licenses table

Go to: https://supabase.com/dashboard/project/yekxijqiodiafhhcrvhf/editor

Run this SQL:

```sql
ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS buyer_email     text,
  ADD COLUMN IF NOT EXISTS buyer_name      text,
  ADD COLUMN IF NOT EXISTS gumroad_sale_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS product_name    text;
```

---

## STEP 2 — Set up Resend (free email sender)

1. Go to resend.com → sign up free
2. Go to Domains → Add Domain
   - If you have a domain (e.g. ghostbar.app) → verify it (takes 5 min, add DNS records)
   - If you have NO domain → use Resend's shared domain for now:
     change the "from" line in index.ts to:
     `from: "GhostBar <onboarding@resend.dev>"`
     (works immediately, no domain needed, limited to your own email for testing)
3. Go to API Keys → Create API Key → copy it

---

## STEP 3 — Deploy the Edge Function

Install Supabase CLI on your Mac:
```bash
brew install supabase/tap/supabase
```

Login and link your project:
```bash
supabase login
supabase link --project-ref yekxijqiodiafhhcrvhf
```

Set the secret environment variables:
```bash
supabase secrets set RESEND_API_KEY=re_your_key_here
supabase secrets set GUMROAD_WEBHOOK_SECRET=your_gumroad_seller_id
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

To get your service role key:
→ Supabase Dashboard → Settings → API → service_role key (keep secret!)

To get your Gumroad seller_id:
→ Gumroad → Settings → Advanced → your seller ID is shown there

Deploy:
```bash
supabase functions deploy gumroad-webhook
```

Your webhook URL will be:
https://yekxijqiodiafhhcrvhf.supabase.co/functions/v1/gumroad-webhook

---

## STEP 4 — Set up Gumroad

1. Go to gumroad.com → your product → Edit
2. Scroll to Advanced → Webhooks
3. Paste your webhook URL:
   https://yekxijqiodiafhhcrvhf.supabase.co/functions/v1/gumroad-webhook
4. Save

That's it. Every purchase now automatically:
→ Generates a GHOST-XXXX key
→ Saves it to your Supabase database
→ Emails the buyer immediately

---

## STEP 5 — Test it

In Gumroad, click "Send Test Ping" on your webhook.
Check Supabase → Table Editor → licenses → you should see a new row.
Check your email — you should receive the key email.

---

## Managing keys

Use your Admin Dashboard (admin/index.html) to:
- See all sold keys and who bought them
- Revoke a key if someone requests a refund
- Search by email or key

## Pricing suggestion
- $15–$25 per key is reasonable for a tool like this
- Gumroad takes 10% → you keep $13.50–$22.50 per sale
- 10 sales/month = ~$135–$225 passive income as a student
