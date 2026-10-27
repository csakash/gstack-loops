// Resolve env-value templates against a loop's assigned ports.
//   {{port}}        -> this repo's port
//   {{port:NAME}}   -> repo NAME's port
//   {{url:NAME}}    -> http://localhost:<repo NAME's port>
//   {{host:NAME}}   -> localhost:<repo NAME's port>
// Unknown repo refs throw, so a typo in loops.json fails loudly instead of
// silently wiring a dead URL.

function resolveValue(template, { selfPort, portsByRepo }) {
  return String(template).replace(/\{\{\s*(port|url|host)(?::([a-zA-Z0-9._-]+))?\s*\}\}/g, (m, kind, name) => {
    let port;
    if (!name) {
      if (selfPort == null) throw new Error(`"{{${kind}}}" used but no self port available`);
      port = selfPort;
    } else {
      port = portsByRepo[name];
      if (port == null) throw new Error(`template "${m}" references unknown repo "${name}"`);
    }
    if (kind === 'port') return String(port);
    if (kind === 'host') return `localhost:${port}`;
    return `http://localhost:${port}`;
  });
}

// Resolve every value in a repo's env map. Returns { KEY: value }.
function resolveEnvMap(envMap, ctx) {
  const out = {};
  for (const [k, v] of Object.entries(envMap || {})) out[k] = resolveValue(v, ctx);
  return out;
}

// Given the text of a .env file, set/replace KEY=value lines (append if absent).
function applyEnv(existingText, kv) {
  let lines = existingText ? existingText.split('\n') : [];
  // Drop trailing blank lines first, or appended keys land after a gap.
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  for (const [key, value] of Object.entries(kv)) {
    const re = new RegExp(`^\\s*${key}\\s*=`);
    let found = false;
    lines = lines.map((l) => (re.test(l) ? ((found = true), `${key}=${value}`) : l));
    if (!found) lines.push(`${key}=${value}`);
  }
  return lines.join('\n').replace(/\n+$/, '') + '\n';
}

module.exports = { resolveValue, resolveEnvMap, applyEnv };
