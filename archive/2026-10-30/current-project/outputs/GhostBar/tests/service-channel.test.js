'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { socketPath, requestService, serve } = require('../core/service-channel');

test('private service channel reconnects without resetting state and rejects unknown actions', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-service-'));
  const socket = socketPath(directory);
  let running = false;
  const server = await serve(socket, {
    status: () => ({ running }), start: () => { running = true; }, stop: () => { running = false; }
  });
  try {
    assert.equal(fs.statSync(socket).mode & 0o777, 0o600);
    assert.equal(socketPath(directory), socket);
    assert.equal(Buffer.byteLength(socket) < 104, true);
    await requestService(socket, 'start');
    assert.deepEqual(await requestService(socket, 'status'), { running: true });
    assert.deepEqual(await requestService(socket, 'status'), { running: true });
    await assert.rejects(requestService(socket, 'constructor'), /Unknown service action/);
    await requestService(socket, 'stop');
    assert.deepEqual(await requestService(socket, 'status'), { running: false });
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
