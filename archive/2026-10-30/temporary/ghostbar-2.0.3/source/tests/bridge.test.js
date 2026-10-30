'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createBridge } = require('../core/bridge');
test('bridge rejects unauthenticated, cross-origin and stale-account requests', async () => {
  const ai = {
    data: { provider: 'chatgpt', activeId: 'registration' },
    status: () => ({ provider: 'chatgpt', connected: true, model: 'model', accessToken: 'NEVER-EXPOSE' }),
    models: async () => [{ id: 'model', name: 'Model' }], chat: async () => 'Answer'
  };
  const bridge = await createBridge({ ai, root: path.join(__dirname, '..') });
  const base = 'http://127.0.0.1:' + bridge.port;
  try {
    assert.equal((await fetch(base + '/api/status', { method: 'POST' })).status, 403);
    const headers = { Authorization: 'Bearer ' + bridge.secret };
    assert.equal((await fetch(base + '/api/status', { method: 'POST', headers })).status, 403);
    Object.assign(headers, { 'X-GhostBar-Origin': 'https://evil.example', 'X-GhostBar-Request': '1' });
    assert.equal((await fetch(base + '/api/status', { method: 'POST', headers })).status, 403);
    headers['X-GhostBar-Origin'] = 'https://ghostbar.test';
    const status = await (await fetch(base + '/api/status', { method: 'POST', headers })).json();
    assert.equal(status.connected, true); assert.equal(JSON.stringify(status).includes('NEVER-EXPOSE'), false);
    assert.equal((await fetch(base + '/api/chat', { method: 'POST', headers, body: JSON.stringify({ input: [], connectionId: status.connectionId }) })).status, 200);
    ai.data.activeId = 'different-account';
    assert.equal((await fetch(base + '/api/chat', { method: 'POST', headers, body: JSON.stringify({ input: [], connectionId: status.connectionId }) })).status, 409);
    assert.equal((await fetch(base + '/getkey', { headers })).status, 404);
  } finally { bridge.close(); }
});
