/**
 * GhostBar — Supabase License Validator
 * Validates keys against the server on activation + periodic re-check
 */

const SUPABASE_URL = 'https://yekxijqiodiafhhcrvhf.supabase.co';
// Publishable key — safe to embed in app binary
// RLS policies ensure users can only read/update their own license row
const SUPABASE_KEY = 'sb_publishable_zBwjow1aU5rxckm_QdANMw_Zt3ZQbJ6';

const API = `${SUPABASE_URL}/rest/v1`;

function headers(extra = {}) {
  return {
    'apikey':        SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type':  'application/json',
    'Prefer':        'return=representation',
    ...extra
  };
}

/**
 * Validate + activate a key on the server.
 * - If key doesn't exist → rejected
 * - If key is revoked → rejected
 * - If key already activated on a DIFFERENT machine → rejected
 * - If key is fresh → activates it, saves machine_id
 * - If key already on THIS machine → allowed (re-install)
 */
async function validateKeyOnServer(rawKey, machineId) {
  try {
    // Fetch the license row
    const res = await fetch(
      `${API}/licenses?key=eq.${encodeURIComponent(rawKey)}&select=*`,
      { headers: headers(), signal: AbortSignal.timeout(8000) }
    );

    if (!res.ok) return { ok: false, msg: 'Server error. Check your internet connection.' };

    const rows = await res.json();

    if (!rows || rows.length === 0) {
      return { ok: false, msg: 'Invalid license key. Please check and try again.' };
    }

    const license = rows[0];

    if (license.revoked) {
      return { ok: false, msg: 'This license key has been revoked. Contact support.' };
    }

    // Already activated on a different machine
    if (license.machine_id && license.machine_id !== machineId) {
      return {
        ok: false,
        msg: 'This key is already activated on another Mac. Each key works on one machine only.'
      };
    }

    // Fresh or same machine — activate / confirm
    const updateRes = await fetch(
      `${API}/licenses?key=eq.${encodeURIComponent(rawKey)}`,
      {
        method:  'PATCH',
        headers: headers(),
        body: JSON.stringify({
          machine_id:   machineId,
          machine_info: `macOS / activated ${new Date().toISOString()}`,
          activated_at: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(8000)
      }
    );

    if (!updateRes.ok) return { ok: false, msg: 'Activation failed. Try again.' };

    return { ok: true, msg: 'License activated successfully!' };

  } catch (e) {
    if (e.name === 'TimeoutError') {
      return { ok: false, msg: 'Server timeout. Check your internet connection.' };
    }
    return { ok: false, msg: 'Connection failed: ' + e.message };
  }
}

/**
 * Re-verify an already-activated key on launch.
 * Returns { ok, msg } — if server unreachable, allows offline grace.
 */
async function verifyKeyOnLaunch(rawKey, machineId) {
  try {
    const res = await fetch(
      `${API}/licenses?key=eq.${encodeURIComponent(rawKey)}&select=key,revoked,machine_id`,
      { headers: headers(), signal: AbortSignal.timeout(5000) }
    );

    if (!res.ok) return { ok: true, offline: true }; // allow if server error

    const rows = await res.json();
    if (!rows || rows.length === 0) return { ok: false, msg: 'License not found on server.' };

    const license = rows[0];
    if (license.revoked)    return { ok: false, msg: 'Your license has been revoked. Contact support.' };
    if (license.machine_id && license.machine_id !== machineId) {
      return { ok: false, msg: 'License machine mismatch detected.' };
    }

    return { ok: true };

  } catch {
    // Network error — allow offline use (don't block if no internet)
    return { ok: true, offline: true };
  }
}

module.exports = { validateKeyOnServer, verifyKeyOnLaunch };
