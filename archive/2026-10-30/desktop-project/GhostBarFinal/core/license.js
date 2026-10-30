/**
 * core/license.js
 * ─────────────────────────────────────────────────────────────
 * Machine-lock system.
 * On first launch: generates a fingerprint from Mac serial +
 * hardware UUID, saves it. On every subsequent launch: verifies
 * the fingerprint matches this machine. If it doesn't match,
 * the app shows a locked screen and won't start.
 *
 * The lock file is stored at ~/.ghostbar_license
 * It is NOT inside the .app bundle so it survives app updates.
 * ─────────────────────────────────────────────────────────────
 */

const { execSync } = require('child_process');
const crypto       = require('crypto');
const fs           = require('fs');
const os           = require('os');
const path         = require('path');

const LICENSE_FILE = path.join(os.homedir(), '.ghostbar_license');

// ── Get Mac hardware identifiers ──────────────────────────────
function getMachineId() {
  const parts = [];

  // 1. Mac serial number (most reliable)
  try {
    const serial = execSync(
      'ioreg -l -p IOService -k IOPlatformSerialNumber | grep IOPlatformSerialNumber',
      { encoding: 'utf8' }
    ).match(/"IOPlatformSerialNumber"\s*=\s*"([^"]+)"/)?.[1] || '';
    if (serial) parts.push('serial:' + serial);
  } catch {}

  // 2. Hardware UUID
  try {
    const uuid = execSync(
      'ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID',
      { encoding: 'utf8' }
    ).match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1] || '';
    if (uuid) parts.push('uuid:' + uuid);
  } catch {}

  // 3. Mac model identifier
  try {
    const model = execSync('sysctl -n hw.model', { encoding: 'utf8' }).trim();
    if (model) parts.push('model:' + model);
  } catch {}

  // 4. Hostname as secondary factor
  parts.push('host:' + os.hostname());

  if (parts.length < 2) return null; // Can't fingerprint
  return parts.join('|');
}

// ── Hash the machine ID ───────────────────────────────────────
function fingerprint(machineId) {
  return crypto.createHash('sha256').update('ghostbar-v1:' + machineId).digest('hex');
}

// ── Check / register license ──────────────────────────────────
function checkLicense() {
  const machineId = getMachineId();
  if (!machineId) {
    // Can't fingerprint — allow (edge case on very old macOS)
    return { ok: true, reason: 'no-fingerprint' };
  }

  const fp = fingerprint(machineId);

  if (!fs.existsSync(LICENSE_FILE)) {
    // First launch on this machine — register it
    try {
      fs.writeFileSync(LICENSE_FILE, JSON.stringify({
        fingerprint: fp,
        registered:  new Date().toISOString(),
        machine:     os.hostname()
      }, null, 2), { mode: 0o600 });
      console.log('✅ GhostBar: machine registered');
      return { ok: true, reason: 'registered' };
    } catch (e) {
      return { ok: false, reason: 'write-error', msg: e.message };
    }
  }

  // License file exists — verify fingerprint matches
  try {
    const saved = JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf8'));
    if (saved.fingerprint === fp) {
      return { ok: true, reason: 'verified' };
    } else {
      return {
        ok: false,
        reason: 'machine-mismatch',
        msg: 'This copy of GhostBar is licensed to a different Mac.\nPlease purchase your own copy.'
      };
    }
  } catch {
    // Corrupted license file — re-register
    try {
      fs.writeFileSync(LICENSE_FILE, JSON.stringify({
        fingerprint: fp,
        registered:  new Date().toISOString(),
        machine:     os.hostname()
      }, null, 2), { mode: 0o600 });
      return { ok: true, reason: 're-registered' };
    } catch (e) {
      return { ok: false, reason: 'write-error', msg: e.message };
    }
  }
}

// ── Reset license (for testing / support) ────────────────────
function resetLicense() {
  try { fs.unlinkSync(LICENSE_FILE); } catch {}
}

module.exports = { checkLicense, resetLicense };
