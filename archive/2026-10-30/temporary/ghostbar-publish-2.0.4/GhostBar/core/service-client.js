'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { socketPath, requestService } = require('./service-channel');

async function connectService({ directory, root, packaged, executable = process.execPath }) {
  const socket = socketPath(directory);
  try {
    await requestService(socket, 'status', [], 2000);
    return (method, ...args) => requestService(socket, method, args);
  } catch (error) {
    if (!['ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE'].includes(error.code)) throw error;
  }
  const errorFile = path.join(directory, 'service-startup-error.txt');
  fs.rmSync(errorFile, { force: true });
  const env = { ...process.env, GHOSTBAR_DATA_DIR: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, [...(packaged ? [] : [root]), '--ghostbar-service'], {
    cwd: directory, detached: true, stdio: 'ignore', env
  });
  let spawnError;
  child.once('error', error => { spawnError = error; });
  child.unref();
  for (let i = 0; i < 1200; i++) {
    if (spawnError) throw spawnError;
    try {
      await requestService(socket, 'status', [], 1000);
      return (method, ...args) => requestService(socket, method, args);
    } catch {}
    if (fs.existsSync(errorFile)) throw new Error(fs.readFileSync(errorFile, 'utf8'));
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('GhostBar’s background service could not start. Reopen the app to retry.');
}
module.exports = { connectService };
