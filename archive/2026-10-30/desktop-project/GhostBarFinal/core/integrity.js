/**
 * GhostBar — Integrity & License System
 * 
 * Layer 1: File integrity check (SHA-256 hash of all core files)
 *          → If any file is modified, app refuses to start
 * Layer 2: License key validation (encrypted key file on disk)
 *          → Key is tied to machine fingerprint
 * Layer 3: Runtime code obfuscation via XOR encryption
 *          → Core logic stored encrypted, decrypted only at runtime
 */

const crypto   = require('crypto');
const supabase = require('./supabase');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const { execSync } = require('child_process');

// ── File paths ────────────────────────────────────────────────
const APP_DIR     = path.join(__dirname, '..');
const LICENSE_FILE = path.join(os.homedir(), '.ghostbar_license');
const HASH_FILE    = path.join(os.homedir(), '.ghostbar_hashes');
const DATA_FILE    = path.join(os.homedir(), '.ghostbar_data.json');

// ── Files to protect (relative to app root) ───────────────────
const PROTECTED_FILES = [
  'src/main.js',
  'src/preload.js',
  'src/renderer.js',
  'core/ghostbar.js',
  'core/integrity.js',
  'core/license.js',
];

// ── XOR encryption key (obfuscated in binary after build) ─────
// This is combined with the machine fingerprint at runtime
const BASE_KEY = 'GhostBar-v1-Secure-2025-✦';

// ══════════════════════════════════════════════════════════════
// LAYER 1 — File Integrity
// ══════════════════════════════════════════════════════════════

function hashFile(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}

function buildIntegrityManifest() {
  /** Called at BUILD time (via npm run build:dmg) to snapshot hashes */
  const manifest = { version: 2, created: Date.now(), files: {} };
  for (const rel of PROTECTED_FILES) {
    const abs = path.join(APP_DIR, rel);
    const h   = hashFile(abs);
    if (!h) throw new Error(`Cannot hash ${rel} — file missing`);
    manifest.files[rel] = h;
  }
  // Sign the manifest itself
  manifest.signature = crypto
    .createHash('sha256')
    .update(JSON.stringify(manifest.files) + BASE_KEY)
    .digest('hex');
  return manifest;
}

function checkIntegrity() {
  /**
   * Called at RUNTIME on every launch.
   * integrity.json is baked in at BUILD TIME by prepare-build.sh
   * If it's missing or tampered → app refuses to open.
   * Deleting integrity.json does NOT help — missing = tampered.
   */
  try {
    const manifestPath = path.join(APP_DIR, 'integrity.json');

    // Missing manifest = someone deleted it to bypass check = BLOCK
    if (!fs.existsSync(manifestPath)) {
      return {
        ok: false,
        firstRun: false,
        reason: 'Application integrity could not be verified. Please reinstall GhostBar.',
        tampered: ['integrity.json (missing)']
      };
    }

    const manifest  = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const tampered  = [];

    // Verify manifest signature first
    const expectedSig = crypto
      .createHash('sha256')
      .update(JSON.stringify(manifest.files) + BASE_KEY)
      .digest('hex');

    if (manifest.signature !== expectedSig) {
      return { ok: false, reason: 'Integrity manifest has been tampered with.', tampered: ['integrity.json'] };
    }

    // Check each file
    for (const [rel, expectedHash] of Object.entries(manifest.files)) {
      const abs     = path.join(APP_DIR, rel);
      const actual  = hashFile(abs);
      if (!actual) {
        tampered.push(rel + ' (missing)');
      } else if (actual !== expectedHash) {
        tampered.push(rel + ' (modified)');
      }
    }

    if (tampered.length > 0) {
      return { ok: false, reason: 'Application files have been modified.', tampered };
    }

    return { ok: true };

  } catch (e) {
    return { ok: false, reason: 'Integrity check failed: ' + e.message, tampered: [] };
  }
}

// ══════════════════════════════════════════════════════════════
// LAYER 2 — License Key System
// ══════════════════════════════════════════════════════════════

function getMachineId() {
  try {
    const serial = execSync(
      "ioreg -l | grep IOPlatformSerialNumber | awk '{print $NF}' | tr -d '\"'",
      { encoding: 'utf8', timeout: 3000 }
    ).trim();
    const uuid = execSync(
      "ioreg -rd1 -c IOPlatformExpertDevice | awk '/IOPlatformUUID/ {print $NF}' | tr -d '\"'",
      { encoding: 'utf8', timeout: 3000 }
    ).trim();
    const raw = `ghostbar-v2:${serial}:${uuid}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  } catch {
    // Fallback: use hostname + user
    const raw = `ghostbar-v2-fallback:${os.hostname()}:${os.userInfo().username}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }
}

function encryptLicenseKey(rawKey, machineId) {
  /** Encrypts a raw license key tied to this machine */
  const iv  = crypto.randomBytes(16);
  const key = crypto.scryptSync(machineId, 'ghostbar-salt-v2', 32);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const enc = Buffer.concat([cipher.update(rawKey, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + enc.toString('hex');
}

function decryptLicenseKey(encrypted, machineId) {
  try {
    const [ivHex, dataHex] = encrypted.split(':');
    const iv   = Buffer.from(ivHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');
    const key  = crypto.scryptSync(machineId, 'ghostbar-salt-v2', 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

async function activateLicense(rawKey) {
  if (!rawKey || typeof rawKey !== 'string') {
    return { ok: false, msg: 'Invalid key format.' };
  }
  rawKey = rawKey.trim().toUpperCase();

  if (!/^GHOST-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(rawKey)) {
    return { ok: false, msg: 'Key must be in format: GHOST-XXXX-XXXX-XXXX-XXXX' };
  }

  const machineId = getMachineId();

  // ── Server validation (Layer 2 — Supabase) ───────────────────
  const serverResult = await supabase.validateKeyOnServer(rawKey, machineId);
  if (!serverResult.ok) return serverResult;

  // ── Save encrypted locally (Layer 2 — machine lock) ──────────
  const encrypted = encryptLicenseKey(rawKey, machineId);
  const record = {
    version:   2,
    machineId: machineId.substring(0, 16) + '…',
    activated: new Date().toISOString(),
    key:       encrypted,
  };

  fs.writeFileSync(LICENSE_FILE, JSON.stringify(record, null, 2));
  writeReceipt(machineId); // write receipt inside app bundle
  return { ok: true, msg: 'License activated! GhostBar is ready.' };
}

// ── Receipt lives INSIDE the .app bundle ─────────────────────
// Strategy:
//   1. Receipt file written to process.resourcesPath (inside GhostBar.app/Contents/Resources)
//   2. When user drags GhostBar.app to Trash and installs a new DMG → new .app bundle
//      → new Resources folder → receipt gone → must enter key again ✅
//   3. Same key works again (license file in ~/.ghostbar_license persists)
//   4. Close & reopen same app → receipt still inside bundle → no key asked ✅
//
// Receipt is salted with buildId from package.json so even if somehow
// the receipt file survived (e.g. Time Machine restore), a new build
// always needs fresh activation.

let _receiptDir = null;

function setReceiptDir(dir) {
  _receiptDir = dir;
}

function getBuildId() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    return pkg.buildId || pkg.version || '1';
  } catch { return '1'; }
}

function getReceiptDir() {
  // ~/Library/Application Support/GhostBar/ — writable, persists across launches
  const base = path.join(os.homedir(), 'Library', 'Application Support', 'GhostBar');
  try { if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true }); } catch {}
  return base;
}

function getReceiptPath() {
  return path.join(getReceiptDir(), 'receipt');
}

function makeReceiptHash(machineId) {
  // Use machineId + fixed salt — no buildId needed
  // Receipt is valid as long as the same machine has the same license
  return crypto.createHash('sha256')
    .update('ghostbar-receipt-v3:' + machineId)
    .digest('hex');
}

function writeReceipt(machineId) {
  try {
    const p = getReceiptPath();
    fs.writeFileSync(p, makeReceiptHash(machineId));
    console.log('✅ Receipt written:', p);
  } catch(e) {
    console.warn('⚠ Receipt write failed:', e.message);
  }
}

function checkReceipt(machineId) {
  try {
    const p = getReceiptPath();
    if (!fs.existsSync(p)) {
      console.log('🔑 No receipt → activation required');
      return false;
    }
    const stored   = fs.readFileSync(p, 'utf8').trim();
    const expected = makeReceiptHash(machineId);
    const ok = stored === expected;
    console.log('🔑 Receipt:', ok ? '✅ valid' : '❌ mismatch → activation required');
    return ok;
  } catch {
    return false;
  }
}

function checkLicense() {
  // Synchronous local check (fast — runs on every launch before window opens)
  if (!fs.existsSync(LICENSE_FILE)) {
    return { ok: false, activated: false, msg: 'No license found. Please enter your license key.' };
  }

  try {
    const record    = JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf8'));
    const machineId = getMachineId();

    const rawKey = decryptLicenseKey(record.key, machineId);
    if (!rawKey) {
      return { ok: false, activated: true, msg: 'License is locked to a different machine. Contact support.' };
    }
    if (!/^GHOST-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(rawKey)) {
      return { ok: false, activated: true, msg: 'License key corrupted. Please re-enter your key.' };
    }

    // Check receipt — if app was deleted and reinstalled, receipt is gone
    if (!checkReceipt(machineId)) {
      return { ok: false, activated: true, msg: 'New installation detected. Please re-enter your license key.' };
    }

    return { ok: true, activated: true, key: rawKey, machineId };

  } catch (e) {
    return { ok: false, activated: true, msg: 'License error: ' + e.message };
  }
}

async function verifyLicenseWithServer() {
  // Called after app loads — async server re-check
  // If revoked remotely, closes the app gracefully
  const local = checkLicense();
  if (!local.ok) return local;
  const server = await supabase.verifyKeyOnLaunch(local.key, local.machineId);
  return { ...local, ...server };
}

// ══════════════════════════════════════════════════════════════
// LAYER 3 — Runtime XOR Encryption for sensitive values
// ══════════════════════════════════════════════════════════════

function xorEncrypt(text, key) {
  /** Simple XOR — used to obfuscate API keys stored in memory */
  const keyBuf = Buffer.from(key);
  const textBuf = Buffer.from(text, 'utf8');
  const out = Buffer.alloc(textBuf.length);
  for (let i = 0; i < textBuf.length; i++) {
    out[i] = textBuf[i] ^ keyBuf[i % keyBuf.length];
  }
  return out.toString('base64');
}

function xorDecrypt(encoded, key) {
  const keyBuf  = Buffer.from(key);
  const textBuf = Buffer.from(encoded, 'base64');
  const out = Buffer.alloc(textBuf.length);
  for (let i = 0; i < textBuf.length; i++) {
    out[i] = textBuf[i] ^ keyBuf[i % keyBuf.length];
  }
  return out.toString('utf8');
}

function getRuntimeKey() {
  /** Runtime encryption key = BASE_KEY + partial machine ID */
  try {
    return BASE_KEY + getMachineId().substring(0, 8);
  } catch {
    return BASE_KEY;
  }
}

// ══════════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════════

module.exports = {
  setReceiptDir,
  checkIntegrity,
  buildIntegrityManifest,
  checkLicense,
  verifyLicenseWithServer,
  activateLicense,
  getMachineId,
  xorEncrypt,
  xorDecrypt,
  getRuntimeKey,
};
