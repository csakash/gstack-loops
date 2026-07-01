// gloop stop <slug> — kill the loop's tracked dev-server processes, free ports.
const { loadConfig } = require('../lib/config');
const registry = require('../lib/registry');
const { stopServer, isAlive } = require('../lib/proc');
const { c, die } = require('../lib/util');

module.exports = function stopCmd(slug) {
  if (!slug) die('Usage: gloop stop <slug>');
  const cfg = loadConfig();
  const loop = registry.getLoop(cfg, slug);
  if (!loop) die(`No loop "${slug}". See gloop ls.`);

  const servers = loop.servers || {};
  let killed = 0;
  for (const [name, rec] of Object.entries(servers)) {
    if (rec && rec.pid && isAlive(rec.pid)) {
      stopServer(rec.pid);
      console.log(`  ${c.yellow('■')} stopped ${name} (pid ${rec.pid}, port ${rec.port})`);
      killed += 1;
    }
  }
  registry.updateLoop(cfg, slug, (e) => { e.servers = {}; return e; });
  console.log(killed ? `${c.green('✓')} stopped ${killed} server(s) for "${slug}".` : `No running servers tracked for "${slug}".`);
};
