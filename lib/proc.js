// Dev-server process management for a loop. Servers are spawned detached in
// their own process group so we can kill the whole tree (npm -> vite/tsx -> ...)
// by signalling the negative PID. PIDs are recorded in the registry by callers.
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');

// Start one dev server. Returns { pid, port, log }. Detached + own group.
function startServer({ cwd, command, args, env, port, logFile }) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const out = fs.openSync(logFile, 'a');
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  return { pid: child.pid, port, log: logFile };
}

function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// Kill a process group (negative pid). Falls back to the bare pid.
function stopServer(pid) {
  if (!pid) return false;
  try { process.kill(-pid, 'SIGTERM'); return true; }
  catch { try { process.kill(pid, 'SIGTERM'); return true; } catch { return false; } }
}

// Is something already listening on this port? Resolves true/false (never rejects).
function portInUse(port, host = '127.0.0.1', timeoutMs = 500) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (v) => { if (!done) { done = true; sock.destroy(); resolve(v); } };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, host);
  });
}

module.exports = { startServer, isAlive, stopServer, portInUse };
