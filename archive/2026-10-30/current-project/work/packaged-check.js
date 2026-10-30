const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const root = path.resolve('outputs/GhostBar');
const { socketPath, requestService } = require(path.join(root, 'core/service-channel'));
const directory = fs.mkdtempSync('/private/tmp/ghostbar-packaged-profile-');
const socket = socketPath(directory);
const executable = process.argv[2] || path.join(root, 'dist/mac-arm64/GhostBar.app/Contents/MacOS/GhostBar');
const env = { ...process.env, GHOSTBAR_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  let child;
  try {
    child = spawn(executable, [], { env, detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let errors = '';
    child.stderr.on('data', chunk => { errors += chunk; });
    let status;
    for (let i = 0; i < 1500; i++) {
      try { status = await requestService(socket, 'status', [], 1000); break; } catch {}
      await wait(100);
    }
    assert.ok(status, 'Packaged service did not start: ' + errors);
    assert.notEqual(status.servicePid, child.pid);
    assert.equal(status.proxy.running, false);
    assert.equal(status.provider, 'chatgpt');
    await requestService(socket, 'provider', ['gemini']);
    assert.equal((await requestService(socket, 'status')).provider, 'gemini');
    // Let the control process finish its own connection before testing Quit.
    await wait(1500);
    child.kill('SIGTERM');
    for (let i = 0; i < 50 && child.exitCode === null; i++) await wait(100);
    assert.notEqual(child.exitCode, null, 'The UI process exits independently');
    await wait(300);
    await assert.rejects(requestService(socket, 'status', [], 1000));
    console.log('Packaged app starts a separate service from its ASAR bundle, supports commands, and quits cleanly when idle.');
  } finally {
    if (child?.exitCode === null) child.kill('SIGTERM');
    try { await requestService(socket, 'stop'); await requestService(socket, 'release'); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
