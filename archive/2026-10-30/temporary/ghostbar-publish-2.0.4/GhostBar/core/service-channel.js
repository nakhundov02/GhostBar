'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

// A Unix socket cannot be reached by browser pages. Keep its path short for macOS.
function socketPath(directory) {
  const base = path.join('/tmp', 'ghostbar-' + process.getuid());
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(base);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077)) {
    throw new Error('GhostBar’s local service directory is not private.');
  }
  return path.join(base, crypto.createHash('sha256').update(path.resolve(directory)).digest('hex').slice(0, 24) + '.sock');
}
function requestService(socket, method, args = [], timeout = 65_000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ method, args });
    const req = http.request({ socketPath: socket, path: '/', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        text += chunk;
        if (text.length > 1_000_000) req.destroy(new Error('Unexpected service response.'));
      });
      res.on('error', reject);
      res.on('end', () => {
        try {
          const result = JSON.parse(text);
          if (!result.ok) throw new Error(result.error || 'The background service could not complete this action.');
          resolve(result.value);
        } catch (error) { reject(error); }
      });
    });
    req.setTimeout(timeout, () => req.destroy(new Error('GhostBar’s background service did not respond.')));
    req.on('error', reject);
    req.end(body);
  });
}
async function serve(socket, actions) {
  // The caller holds the service's Electron single-instance lock.
  try { fs.unlinkSync(socket); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (req.method !== 'POST' || req.url !== '/') throw new Error('Unknown service request.');
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 32_768) throw new Error('Service request too large.');
      }
      const { method, args } = JSON.parse(body);
      if (!Object.hasOwn(actions, method) || !Array.isArray(args)) throw new Error('Unknown service action.');
      res.end(JSON.stringify({ ok: true, value: await actions[method](...args) }));
    } catch (error) { res.end(JSON.stringify({ ok: false, error: error.message })); }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socket, () => { fs.chmodSync(socket, 0o600); resolve(); });
  });
  return server;
}
module.exports = { socketPath, requestService, serve };
