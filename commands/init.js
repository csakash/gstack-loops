// gloop init — scaffold loops.json by detecting git repos in the workspace.
const fs = require('fs');
const path = require('path');
const { CONFIG_NAME } = require('../lib/config');
const { DEFAULT_SENSITIVE } = require('../lib/risk');
const { run, c, die, readJSON } = require('../lib/util');

const REVIEW_TEMPLATE = path.join(__dirname, '..', 'templates', 'REVIEW.md');

// One REVIEW.md per repo root, only where none exists: the file is the owner's to edit.
function writeReviewGuides(root, repos) {
  const created = [];
  for (const r of repos) {
    const dir = path.resolve(root, r.path || r.name);
    const file = path.join(dir, 'REVIEW.md');
    if (!fs.existsSync(dir) || fs.existsSync(file)) continue;
    fs.copyFileSync(REVIEW_TEMPLATE, file);
    created.push(path.relative(root, file) || 'REVIEW.md');
  }
  return created;
}

function reportGuides(created) {
  if (created.length) {
    console.log(`${c.green('✓')} wrote ${created.join(', ')} — tell the reviewer what matters in each repo, then commit it there`);
  } else {
    console.log(c.dim('  every repo already has a REVIEW.md — left as is.'));
  }
}

// The conventions block written into the workspace CLAUDE.md so every Claude Code
// session in this workspace follows the same loop + gstack best practices.
function conventionsSection(repoNames) {
  return `## gstack-loops (loop-engineering)

This workspace uses [gstack-loops](https://github.com/csakash/gstack-loops) on top of
[gstack](https://github.com/garrytan/gstack). Repos: ${repoNames.join(', ')}.

**Every feature is a loop. Never edit \`main\` or the root checkouts directly** — parallel
sessions share these repos; an isolated worktree per loop is what stops them clobbering each
other. Start each feature with \`gloop new <slug>\`, then work inside \`worktrees/<slug>/\`.

The loop: \`/gloop-spec\` (commit \`SPEC.md\`) → \`/gloop-build\` (build → \`/review\` + \`/qa\`
until green) → \`/gloop-ship\` (raise the PR). There's a \`/gloop-*\` shortcut for every step,
or just \`/gloop <what you want>\` to drive it conversationally. For headless runs use
\`gloop run <slug> --mode <interactive|bypass|autonomous>\`.

- Use \`/browse\` for all web browsing/QA — never \`mcp__claude-in-chrome__*\`.
- Definition of Done: behavior matches \`SPEC.md\`; \`npm run build\` clean per repo; \`/review\`
  + \`/qa\` pass; no \`.env\` committed; cross-repo PRs cross-linked.
- Landing several PRs at once: see [docs/PARALLEL_SHIPPING.md](docs/PARALLEL_SHIPPING.md)
  (shared-DB isolation via \`hooks.preLoop\`, merge order, rebase-before-ship).
- After a loop's PR merges: \`gloop reap\` (or \`gloop drop <slug> --delete-branch\`).
`;
}

function writeConventions(root, repoNames) {
  const file = path.join(root, 'CLAUDE.md');
  const marker = '## gstack-loops';
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (existing.includes(marker)) return 'present';
  const body = (existing ? existing.replace(/\n*$/, '\n\n') : '') + conventionsSection(repoNames);
  fs.writeFileSync(file, body);
  return existing ? 'appended' : 'created';
}

function isGitRepo(dir) {
  return run('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], { allowFail: true, stdio: 'pipe' }) === 'true'
    && run('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { allowFail: true, stdio: 'pipe' }) === path.resolve(dir);
}

function detectRepos(root) {
  // Single-repo workspace: cwd itself is a repo root.
  if (isGitRepo(root)) return [{ name: path.basename(root), path: '.' }];
  // Multi-repo: immediate subdirectories that are their own repo roots.
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
    .filter((d) => isGitRepo(path.join(root, d.name)))
    .map((d) => ({ name: d.name, path: d.name }));
}

module.exports = function initCmd() {
  const root = process.cwd();
  const target = path.join(root, CONFIG_NAME);

  // Safe to re-run: an existing workspace keeps its loops.json byte-for-byte and only gets
  // what is missing. This is how workspaces made before v1.1 adopt REVIEW.md.
  if (fs.existsSync(target)) {
    let existing;
    try { existing = readJSON(target, {}); } catch (e) { die(`${CONFIG_NAME} is not valid JSON: ${e.message}`); }
    const repos = Array.isArray(existing.repos) ? existing.repos : [];
    console.log(c.dim(`  ${CONFIG_NAME} already exists — left unchanged.`));
    reportGuides(writeReviewGuides(root, repos));
    const outcome = writeConventions(root, repos.map((r) => r.name));
    if (outcome !== 'present') console.log(`${c.green('✓')} ${outcome} gstack-loops conventions in CLAUDE.md`);
    if (!existing.review) console.log(c.dim('  no "review" block in loops.json: defaults apply (security review on, default sensitivePaths).'));
    return;
  }

  const found = detectRepos(root);
  if (found.length === 0) die('No git repos found here. Run this in a workspace containing one or more git repos.');

  const repos = found.map((r, i) => ({
    name: r.name,
    path: r.path,
    baseBranch: 'main',
    basePort: 4000 + i * 1000,
    dev: r.path === '.' ? ['npm', 'run', 'dev'] : ['npm', 'run', 'dev', '--prefix', r.path],
    env: {},
  }));

  const cfg = {
    worktreeDir: 'worktrees', branchPrefix: 'feat/', portStride: 100, repos,
    review: { fixCycles: 2, security: true, sensitivePaths: DEFAULT_SENSITIVE },
    hooks: { preLoop: null, postShip: null },
  };
  fs.writeFileSync(target, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`${c.green('✓')} wrote ${CONFIG_NAME} with ${repos.length} repo(s): ${repos.map((r) => r.name).join(', ')}`);

  // Codify the loop + gstack conventions into the workspace CLAUDE.md.
  const outcome = writeConventions(root, repos.map((r) => r.name));
  if (outcome === 'present') console.log(c.dim('  CLAUDE.md already has a gstack-loops section — left as is.'));
  else console.log(`${c.green('✓')} ${outcome} gstack-loops conventions in CLAUDE.md (loop rules + Definition of Done)`);

  reportGuides(writeReviewGuides(root, repos));

  console.log(c.dim('  Next: set each repo\'s dev command + env wiring (e.g. {{url:backend}}), then: gloop new <slug>'));
  console.log(c.dim('  Commit loops.json + CLAUDE.md (+ each repo\'s REVIEW.md) so teammates inherit the setup.'));
};
