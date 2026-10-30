/**
 * guardian.js — Silent anti-tamper protection
 * 
 * TWO layers:
 * 1. DECOY check — obvious, easy to find and remove
 * 2. HIDDEN check — buried, activates silently after 10 min
 *    Makes app progressively buggy. Cracker thinks it worked.
 *    Everyone they share with gets a broken app.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const crypto = require('crypto');

// ── Decoy check (obvious — they will find and remove this) ────
// This is intentionally readable so they focus on removing it
function decoyCheck() {
  const licenseFile = path.join(os.homedir(), '.ghostbar_license');
  if (!fs.existsSync(licenseFile)) return false;
  return true;
}

// ── Hidden check — DO NOT make this readable ──────────────────
// Checks if integrity.json was deleted or main.js was modified
// Uses indirect file checks so it's hard to identify what this does
function _h() {
  try {
    const _d = path.join(path.dirname(path.dirname(__filename)));
    const _p = [
      path.join(_d, ['inte','grity','.json'].join('')),
      path.join(_d, 'src', ['ma','in','.js'].join(''))
    ];
    // Check 1: integrity manifest must exist
    if (!fs.existsSync(_p[0])) return true; // tampered
    // Check 2: main.js must be over a certain size (removing license check shrinks it)
    const _s = fs.statSync(_p[1]).size;
    if (_s < 4000) return true; // tampered — too small
    // Check 3: main.js must contain specific byte pattern
    const _b = fs.readFileSync(_p[1], 'utf8');
    const _k = ['checkL','icense'].join('');
    if (_b.indexOf(_k) === -1) return true; // license check was removed
    // Check 4: guardian.js itself must not be modified
    const _g = fs.readFileSync(__filename, 'utf8');
    if (_g.length < 2000) return true; // file was truncated
    return false;
  } catch { return false; }
}

// ── Progressive corruption after 10 minutes ───────────────────
// Does NOT crash or show errors — just makes things subtly wrong
// Cracker thinks it's working, shares it, users get broken app
let _activated = false;
let _bugLevel  = 0;

function _startCorruption() {
  if (_activated) return;
  _activated = true;

  // After 10 min: start being subtly wrong
  setTimeout(() => {
    _bugLevel = 1;
    // Monkey-patch fetch to randomly delay responses
    const _origFetch = global.fetch;
    if (_origFetch) {
      global.fetch = function(...args) {
        return new Promise((resolve, reject) => {
          // Random 8-15 second delay on ALL requests
          setTimeout(() => {
            _origFetch(...args).then(resolve).catch(reject);
          }, 8000 + Math.random() * 7000);
        });
      };
    }
  }, 10 * 60 * 1000);

  // After 20 min: make it worse
  setTimeout(() => {
    _bugLevel = 2;
    // Override fetch to fail randomly 60% of the time
    const _origFetch = global.fetch;
    if (_origFetch) {
      global.fetch = function(...args) {
        if (Math.random() < 0.6) {
          return Promise.reject(new Error('Network request failed'));
        }
        return _origFetch(...args);
      };
    }
  }, 20 * 60 * 1000);

  // After 30 min: app becomes completely unusable
  setTimeout(() => {
    _bugLevel = 3;
    global.fetch = function() {
      return Promise.reject(new Error('Network request failed'));
    };
  }, 30 * 60 * 1000);
}

// ── Self-delete if obvious tampering detected ──────────────────
// If integrity.json is missing = they deleted it = delete app data
function _selfClean() {
  try {
    // Wipe all local data so the cracked copy is useless
    const toWipe = [
      path.join(os.homedir(), '.ghostbar_license'),
      path.join(os.homedir(), '.ghostbar_data.json'),
      path.join(os.homedir(), '.ghostbar_proxy_backup.json'),
      path.join(os.homedir(), 'Library', 'Application Support', 'GhostBar', 'receipt')
    ];
    toWipe.forEach(f => { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {} });
  } catch {}
}

// ── Main guardian function — call this from main.js ───────────
function startGuardian() {
  // Run hidden check
  const tampered = _h();

  if (tampered) {
    // Don't show any error — silently wipe data and start corruption
    _selfClean();
    _startCorruption();
    // Also schedule a quiet exit after 30 minutes
    setTimeout(() => {
      try { process.exit(0); } catch {}
    }, 30 * 60 * 1000);
  }

  // Also run hidden check every 5 minutes in background
  // In case they patch it AFTER launch
  setInterval(() => {
    if (_h()) {
      _selfClean();
      _startCorruption();
    }
  }, 5 * 60 * 1000);
}

module.exports = { startGuardian };
