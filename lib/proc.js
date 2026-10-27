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

// PIDs listening on a TCP port, with each one's working directory when knowable.
// Linux: /proc, no extra tools. Elsewhere: lsof if present (cwd unknown). [] when unknown.
function listeners(port) {
  const hex = `:${port.toString(16).toUpperCase().padStart(4, '0')}`;
  const inodes = new Set();
  for (const f of ['/proc/net/tcp', '/proc/net/tcp6']) {
    try {
      for (const line of fs.readFileSync(f, 'utf8').split('\n').slice(1)) {
        const col = line.trim().split(/\s+/);
        if (col[1] && col[1].endsWith(hex) && col[3] === '0A') inodes.add(col[9]); // 0A = LISTEN
      }
    } catch { /* not Linux */ }
  }
  if (inodes.size) {
    const out = [];
    for (const pid of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
      try {
        const owns = fs.readdirSync(`/proc/${pid}/fd`).some((fd) => {
          const m = fs.readlinkSync(`/proc/${pid}/fd/${fd}`).match(/^socket:\[(\d+)\]$/);
          return m && inodes.has(m[1]);
        });
        if (owns) out.push({ pid: Number(pid), cwd: fs.readlinkSync(`/proc/${pid}/cwd`) });
      } catch { /* process gone or not ours to read */ }
    }
    return out;
  }
  try {
    const out = require('child_process').execFileSync('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').filter(Boolean).map((pid) => ({ pid: Number(pid), cwd: null }));
  } catch {
    return [];
  }
}

// After a run: stop whatever still listens on the loop's ports *if it runs from inside the
// loop's folder* (e.g. a server an agent restarted during QA). Anything else is reported,
// never killed. -> { stopped: [{port,pid}], foreign: [{port,pid,cwd}] }
function freeLoopPorts(ports, featureDirAbs) {
  const stopped = [];
  const foreign = [];
  let base = featureDirAbs;
  try { base = fs.realpathSync(featureDirAbs); } catch { /* keep as given */ }
  for (const port of ports) {
    for (const l of listeners(port)) {
      if (l.cwd && (l.cwd === base || l.cwd.startsWith(base + path.sep))) {
        if (stopServer(l.pid)) stopped.push({ port, pid: l.pid });
      } else {
        foreign.push({ port, pid: l.pid, cwd: l.cwd });
      }
    }
  }
  return { stopped, foreign };
}

module.exports = { startServer, isAlive, stopServer, portInUse, listeners, freeLoopPorts };
