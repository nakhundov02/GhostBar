'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PANEL_ORIGIN = 'https://ghostbar.test';
async function readBody(req) {
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 13 * 1024 * 1024) throw new Error('Request too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function createBridge({ ai, root }) {
  const secret = crypto.randomBytes(32).toString('hex');
  const assets = { '/': ['panel.html', 'text/html'], '/panel.js': ['panel.js', 'text/javascript'], '/panel.css': ['panel.css', 'text/css'] };
  let busy = false;
  const connectionId = () => crypto.createHmac('sha256', secret).update(ai.data.provider + ':' + (ai.data.provider === 'chatgpt' ? ai.data.activeId || '' : ai.data.geminiKey || '')).digest('hex');
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'");
    const json = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value));
    };
    // Only the local proxy knows this secret. Browser pages never receive it.
    if (req.headers.authorization !== 'Bearer ' + secret) return json(403, { error: 'Forbidden' });
    try {
      const route = new URL(req.url, PANEL_ORIGIN).pathname;
      if (req.method === 'GET' && assets[route]) {
        const [file, type] = assets[route];
        res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' });
        return res.end(fs.readFileSync(path.join(root, 'src', file)));
      }
      if (req.headers['x-ghostbar-origin'] !== PANEL_ORIGIN || req.headers['x-ghostbar-request'] !== '1') {
        return json(403, { error: 'Open the GhostBar chat panel to use this endpoint.' });
      }
      if (req.method === 'POST' && route === '/api/status') {
        const status = ai.status();
        // Account email and registration identifiers are only shown in the native app.
        return json(200, { connectionId: connectionId(), provider: status.provider, connected: status.connected, hasGeminiKey: status.hasGeminiKey, model: status.model });
      }
      if (req.method === 'POST' && route === '/api/models') {
        return json(200, { models: ai.data.provider === 'chatgpt' ? await ai.models() : [{ id: ai.status().geminiModel, name: ai.status().geminiModel }] });
      }
      if (req.method === 'POST' && route === '/api/chat') {
        if (busy) return json(429, { error: 'Another GhostBar request is running. Try again when it finishes.' });
        busy = true;
        try {
          const { input, model, connectionId: requestedConnection } = await readBody(req);
          if (requestedConnection !== connectionId()) return json(409, { error: 'Your AI connection changed. Refresh this panel and start a new chat.' });
          const text = await ai.chat(input, model);
          return json(200, { text });
        } finally { busy = false; }
      }
      json(404, { error: 'Not found' });
    } catch (error) { json(400, { error: error.name === 'AbortError' ? 'Request cancelled.' : error.message }); }
  });
  server.requestTimeout = 200_000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { server, secret, port: server.address().port, close: () => { server.closeAllConnections(); server.close(); } };
}
module.exports = { createBridge, PANEL_ORIGIN };
