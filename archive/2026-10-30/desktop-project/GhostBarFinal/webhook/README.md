# GhostBar — Gumroad Auto-Key Delivery

## How it works
1. Buyer purchases on Gumroad
2. Gumroad fires a webhook POST to your Supabase Edge Function URL
3. Edge Function generates a GHOST-XXXX key, saves to Supabase, emails buyer
4. Buyer gets email with their key instantly

## Deploy steps (one-time, takes 10 minutes)
See DEPLOY.md
