// Small shared helpers: colored output, JSON file IO, exec wrappers.
const { execFileSync } = require('child_process');
const fs = require('fs');

const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const c = {
  bold: paint('1'), dim: paint('2'), red: paint('31'), green: paint('32'),
  yellow: paint('33'), blue: paint('34'), cyan: paint('36'),
};

function die(msg, code = 1) {
  console.error(c.red('✗ ') + msg);
  process.exit(code);
}

// Run a command, return trimmed stdout. Throws on non-zero unless opts.allowFail.
function run(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', ...opts }).trim();
  } catch (e) {
    if (opts.allowFail) return null;
    throw e;
  }
}

function readJSON(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJSON(file, obj) {
  fs.mkdirSync(require('path').dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function slugOk(slug) {
  return typeof slug === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(slug);
}

module.exports = { c, die, run, readJSON, writeJSON, slugOk };
