// The headless stage runner (v1.1). One loop run = ordered stages, each its own agent
// process with its own prompt. After every stage the runner checks a file contract and
// decides what runs next, so the rules — fresh-context review, convergence, proof,
// never ship red — are enforced in code rather than hoped for in a prompt.
// Agent-agnostic: prompts and process spawning live in lib/driver.js.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { run, readJSON, writeJSON } = require('./util');
const { repoByName } = require('./config');
const wt = require('./worktree');
const driver = require('./driver');
const review = require('./review');
const history = require('./history');
const risk = require('./risk');

class Blocked extends Error {
  constructor(gate, reason) { super(reason); this.gate = gate; }
}

function resolveFixCycles(cfg, opts) {
  const ok = (n) => Number.isInteger(n) && n >= 0;
  if (ok(opts.fixCycles)) return opts.fixCycles;
  if (cfg.review && ok(cfg.review.fixCycles)) return cfg.review.fixCycles;
  return 2;
}

// origin/<base> when the remote ref exists (what the branch was cut from), else local.
function baseRef(abs, base) {
  const remote = run('git', ['-C', abs, 'rev-parse', '--verify', '--quiet', `origin/${base}`], { allowFail: true, stdio: 'pipe' });
  return remote ? `origin/${base}` : base;
}

const head = (abs) => run('git', ['-C', abs, 'rev-parse', 'HEAD'], { allowFail: true, stdio: 'pipe' });
const porcelain = (abs) => run('git', ['-C', abs, 'status', '--porcelain'], { allowFail: true, stdio: 'pipe' });

function heads(ctx) {
  return Object.fromEntries(ctx.repos.map((r) => [r.name, head(r.abs)]));
}

// HEAD + working-tree state per repo: what the reviewer must leave exactly as found.
function snapshot(ctx) {
  return Object.fromEntries(ctx.repos.map((r) => [r.name, `${head(r.abs)}\n${porcelain(r.abs)}`]));
}

function moved(before, after) {
  return Object.keys(after).filter((n) => before[n] !== after[n]);
}

function touched(ctx) {
  return ctx.repos.filter((r) => (wt.aheadCount(r.abs, r.baseRef) || 0) > 0);
}

// Cycle 1 sees the whole branch; later cycles see only repos that moved since `from`.
function ranges(ctx, from) {
  if (!from) return ctx.repos.map((r) => ({ repo: r.name, range: `${r.baseRef}...HEAD` }));
  const now = heads(ctx);
  return ctx.repos.filter((r) => now[r.name] !== from[r.name]).map((r) => ({ repo: r.name, range: `${from[r.name]}..HEAD` }));
}

function makeCtx(cfg, loop, mode, opts = {}) {
  const slug = driver.loopSlug(loop);
  const repos = loop.repos.filter((n) => loop.worktrees[n]).map((name) => {
    const r = repoByName(cfg, name);
    const abs = path.join(cfg.root, loop.worktrees[name]);
    const base = (r && r.baseBranch) || 'main';
    return { name, abs, base, baseRef: baseRef(abs, base) };
  });
  const runId = opts.runId || new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(cfg.root, '.loops', 'runs', slug, runId);
  const qaUrls = repos.filter((r) => loop.ports && loop.ports[r.name])
    .map((r) => `${r.name}: http://localhost:${loop.ports[r.name]}`).join(', ');
  return {
    cfg, loop, mode, slug, runDir, repos, qaUrls,
    branch: loop.branch,
    featureDir: driver.featureDir(cfg, loop),
    fixCycles: resolveFixCycles(cfg, opts),
    log: opts.log || console.log,
    echo: opts.echo !== false,
    // One entry per reviewer: same contract and convergence rules, separate findings,
    // separate fix budget, separate evidence folder.
    kinds: {
      review: { kind: 'review', label: 'review', gate: 'review', dir: 'review', fixStage: 'fix', store: {}, cycles: 0, fixes: 0 },
      security: { kind: 'security', label: 'security review', gate: 'security', dir: 'security', fixStage: 'secfix', store: {}, cycles: 0, fixes: 0 },
    },
    securityOn: !(cfg.review && cfg.review.security === false),
    sensitivePaths: (cfg.review && cfg.review.sensitivePaths) || risk.DEFAULT_SENSITIVE,
    sensitive: [],
    guides: [],
    status: { slug, mode, runDir, startedAt: new Date().toISOString(), stages: [] },
  };
}

// Each repo's REVIEW.md for the reviewers: the worktree's copy, else the root checkout's
// (an uncommitted REVIEW.md never reaches a worktree), copied into the run dir so the
// read-only reviewer can reach it. materialize=false for --dry-run: paths only.
function reviewGuides(ctx, materialize) {
  const out = [];
  for (const r of ctx.repos) {
    const inTree = path.join(r.abs, 'REVIEW.md');
    if (fs.existsSync(inTree)) { out.push({ repo: r.name, file: inTree }); continue; }
    const cfgRepo = repoByName(ctx.cfg, r.name);
    const atRoot = cfgRepo && cfgRepo.abs ? path.join(cfgRepo.abs, 'REVIEW.md') : null;
    if (!atRoot || !fs.existsSync(atRoot)) continue;
    const copy = path.join(ctx.runDir, 'guides', `${r.name}.REVIEW.md`);
    if (materialize) {
      fs.mkdirSync(path.dirname(copy), { recursive: true });
      fs.copyFileSync(atRoot, copy);
    }
    out.push({ repo: r.name, file: copy });
  }
  return out;
}

function promptCtx(ctx) {
  return {
    slug: ctx.slug, branch: ctx.branch, runDir: ctx.runDir, fixCycles: ctx.fixCycles,
    qaUrls: ctx.qaUrls, repoNames: ctx.repos.map((r) => r.name),
  };
}

function mark(ctx, stage, status, note) {
  ctx.status.stages.push({ stage, status, note: note || null, at: new Date().toISOString() });
  ctx.status.stage = stage;
  try { writeJSON(path.join(ctx.runDir, 'status.json'), ctx.status); } catch { /* status is best-effort */ }
}

// The remote-tracking ref for the loop branch, per repo. A push to a named remote
// updates it, even when git's URL rewriting was sidestepped by an explicit pushurl.
function trackingRefs(ctx) {
  return Object.fromEntries(ctx.repos.map((r) => [r.name,
    run('git', ['-C', r.abs, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${ctx.branch}`], { allowFail: true, stdio: 'pipe' })]));
}

// stage: build | review | fix | security | secfix | qa | ship (what the driver keys on);
// label: what the console shows.
async function agent(ctx, role, stage, label, gate, prompt) {
  ctx.log(`\n▸ ${label} (${role === 'reviewer' ? 'fresh-context reviewer' : 'author'})`);
  const guard = role === 'author' && !driver.mayPush(ctx.mode, stage);
  const before = guard ? trackingRefs(ctx) : null;
  const res = await driver.runAgent({
    args: driver.agentArgs({ role, mode: ctx.mode, stage, prompt, runDir: ctx.runDir }),
    env: driver.agentEnv({ mode: ctx.mode, stage }),
    cwd: ctx.featureDir,
    capture: role === 'reviewer',
    echo: ctx.echo,
  });
  if (res.code === 127) throw new Blocked(gate, `could not launch ${driver.AGENT_BIN}: ${res.error || 'not found'}`);
  if (guard) {
    const pushed = moved(before, trackingRefs(ctx));
    if (pushed.length) throw new Blocked('push-guard', `${label} pushed ${ctx.branch} in ${pushed.join(', ')}, but only an autonomous ship may push`);
  }
  return res;
}

// Author stages end by writing stage-<name>.json. No report = not done.
function stageReport(ctx, stage, gate) {
  const file = path.join(ctx.runDir, `stage-${stage}.json`);
  let rep;
  try { rep = readJSON(file, null); } catch { throw new Blocked(gate, `stage ${stage} wrote invalid JSON: ${file}`); }
  if (!rep) throw new Blocked(gate, `stage ${stage} did not report (expected ${file})`);
  if (rep.status === 'blocked') throw new Blocked(gate, `${stage}: ${rep.reason || 'blocked (no reason given)'}`);
  if (rep.status !== 'ok') throw new Blocked(gate, `stage ${stage} reported unknown status "${rep.status}"`);
  return rep;
}

const proofFile = (ctx, rel) => path.join(ctx.runDir, 'proof', rel);

async function stageBuild(ctx) {
  const res = await agent(ctx, 'author', 'build', 'build', 'build', driver.prompts.build(promptCtx(ctx)));
  if (res.code !== 0) throw new Blocked('build', `build session exited ${res.code}`);
  stageReport(ctx, 'build', 'build');
  if (!review.nonEmptyFile(proofFile(ctx, 'tests.txt'))) {
    throw new Blocked('proof', 'no proof: proof/tests.txt missing or empty (tests were not run)');
  }
  if (touched(ctx).length === 0) throw new Blocked('build', 'build produced no commits on the branch');
  mark(ctx, 'build', 'ok');
}

async function stageReview(ctx, k, from) {
  const cycle = ++k.cycles;
  const dir = path.join(ctx.runDir, k.dir);
  fs.mkdirSync(dir, { recursive: true });
  const allFile = path.join(dir, 'all.json');
  // The driver computes each diff so the reviewer needs no shell, and the exact text
  // reviewed is kept as evidence.
  const rs = ranges(ctx, from).map((r) => {
    const diffFile = path.join(dir, `cycle-${cycle}.${r.repo}.diff`);
    const abs = ctx.repos.find((x) => x.name === r.repo).abs;
    fs.writeFileSync(diffFile, `${run('git', ['-C', abs, 'diff', r.range], { stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 })}\n`);
    return { ...r, diffFile };
  });
  if (cycle > 1) writeJSON(allFile, k.store);

  const before = snapshot(ctx);
  const prompt = driver.prompts[k.kind](promptCtx(ctx), { cycle, ranges: rs, previous: cycle > 1 ? allFile : null, guides: ctx.guides });
  const res = await agent(ctx, 'reviewer', k.kind, `${k.label} cycle ${cycle}`, k.gate, prompt);
  const raw = path.join(dir, `cycle-${cycle}.raw.txt`);
  fs.writeFileSync(raw, res.stdout || '');

  // Checked before anything else: a reviewer that edits code is not a reviewer.
  const changed = moved(before, snapshot(ctx));
  if (changed.length) throw new Blocked('reviewer-modified-tree', `${k.label} modified tree in ${changed.join(', ')}; nothing was pushed`);
  if (res.code !== 0) throw new Blocked(k.gate, `${k.label} exited ${res.code}; output: ${raw}`);

  const doc = review.extractJSON(res.stdout);
  const v = review.validateFindings(doc);
  if (!v.ok) throw new Blocked(k.gate, `${k.label} output invalid (${v.error}): ${raw}`);

  const h = heads(ctx);
  writeJSON(path.join(dir, `cycle-${cycle}.json`), { cycle, ranges: rs, heads: h, summary: doc.summary, findings: doc.findings });
  review.ingest(k.store, doc.findings, cycle);
  const open = review.openIds(k.store);
  mark(ctx, `${k.kind}:${cycle}`, open.length ? 'findings' : 'clean', doc.summary);
  ctx.log(`  ${k.label} cycle ${cycle}: ${doc.summary}${open.length ? ` (blocking: ${open.join(', ')})` : ''}`);
  return h;
}

// review -> fix -> diff-only re-review until nothing important is open or this
// reviewer's fix budget is spent. The budget persists across calls, so a post-QA pass
// cannot reset it. A fix that commits nothing is not re-reviewed: there is no new diff.
async function converge(ctx, k, from) {
  const dir = path.join(ctx.runDir, k.dir);
  const repoNames = ctx.repos.map((r) => r.name);
  let reviewed = await stageReview(ctx, k, from);
  let unresolved = [];
  while (review.openIds(k.store).length && k.fixes < ctx.fixCycles) {
    // Fix attempts are numbered on their own: a fix that commits nothing gets no
    // re-review, so two attempts can follow one review. Each writes its own file, so a
    // stale resolution from an earlier attempt can never be re-applied.
    const n = ++k.fixes;
    const open = review.openIds(k.store);
    const allFile = path.join(dir, 'all.json');
    const resolutionsFile = path.join(dir, `fix-${n}.resolutions.json`);
    writeJSON(allFile, k.store);

    const prompt = driver.prompts.fix(promptCtx(ctx), {
      cycle: n, open, allFile, resolutionsFile, kind: k.kind, findingsFile: path.join(dir, `cycle-${k.cycles}.json`),
    });
    const res = await agent(ctx, 'author', k.fixStage, `${k.fixStage} ${n}`, k.gate, prompt);
    if (res.code !== 0) throw new Blocked(k.gate, `${k.fixStage} session ${n} exited ${res.code}`);

    const movedRepos = moved(reviewed, heads(ctx));
    let resolutions = {};
    try { resolutions = readJSON(resolutionsFile, {}) || {}; } catch { resolutions = {}; }
    unresolved = review.applyResolutions(k.store, resolutions, { movedRepos, repoNames });
    mark(ctx, `${k.fixStage}:${n}`, unresolved.length ? 'partial' : 'ok',
      unresolved.length ? unresolved.map((u) => `${u.id}: ${u.why}`).join('; ') : null);

    if (movedRepos.length) reviewed = await stageReview(ctx, k, reviewed);
  }

  const open = review.openIds(k.store);
  if (open.length) {
    const detail = open.map((id) => {
      const u = unresolved.find((x) => x.id === id);
      if (u) return `${id} (${u.why})`;
      return k.store[id].reopened ? `${id} (reported again in cycle ${k.store[id].cycle})` : id;
    }).join(', ');
    throw new Blocked(k.gate, `${k.label} did not converge after ${ctx.fixCycles} cycles — re-evaluate the approach. Open: ${detail}`);
  }
}

async function securityPass(ctx, from) {
  if (!ctx.securityOn) {
    if (!ctx.status.stages.some((st) => st.stage === 'security')) mark(ctx, 'security', 'skipped', 'review.security is false in loops.json');
    return;
  }
  await converge(ctx, ctx.kinds.security, from);
}

async function stageQa(ctx) {
  const res = await agent(ctx, 'author', 'qa', 'qa', 'qa', driver.prompts.qa(promptCtx(ctx)));
  if (res.code !== 0) throw new Blocked('qa', `qa session exited ${res.code}`);
  stageReport(ctx, 'qa', 'qa');
  if (!review.nonEmptyFile(proofFile(ctx, 'qa.md'))) {
    throw new Blocked('proof', 'no proof: proof/qa.md missing or empty (QA result not recorded)');
  }
  mark(ctx, 'qa', 'ok');
}

// Run by the driver, not an agent: the build passes or it does not, and the output
// saved as proof is the real output.
function stageBuildgate(ctx) {
  for (const r of touched(ctx)) {
    const out = proofFile(ctx, `build-${r.name}.txt`);
    let pkg = null;
    try { pkg = readJSON(path.join(r.abs, 'package.json'), null); } catch { pkg = null; }
    if (!pkg || !pkg.scripts || !pkg.scripts.build) {
      fs.writeFileSync(out, 'skipped: no "build" script in package.json\n');
      continue;
    }
    ctx.log(`\n▸ buildgate: npm run build in ${r.name}`);
    const res = spawnSync('npm', ['run', 'build'], { cwd: r.abs, encoding: 'utf8', env: process.env });
    fs.writeFileSync(out, [
      `$ npm run build   (in ${r.name})`,
      res.stdout || '', res.stderr || '', res.error ? res.error.message : '',
      `exit: ${res.status}`, '',
    ].join('\n'));
    if (res.status !== 0) throw new Blocked('buildgate', `npm run build failed in ${r.name}: ${out}`);
  }
  mark(ctx, 'buildgate', 'ok');
}

// The tier comes from the change, not from who ran the loop: a sensitive file means a
// human looks before anything is pushed, whatever the mode.
function stageRisk(ctx) {
  ctx.sensitive = risk.touchedSensitive(ctx.repos, ctx.sensitivePaths);
  writeJSON(path.join(ctx.runDir, 'risk.json'), { patterns: ctx.sensitivePaths, touched: ctx.sensitive });
  mark(ctx, 'risk', ctx.sensitive.length ? 'sensitive' : 'ok', ctx.sensitive.length ? risk.describe(ctx.sensitive) : null);
  if (ctx.sensitive.length) ctx.log(`\n▸ risk: touches sensitive paths: ${risk.describe(ctx.sensitive)}`);
}

// PR body for a human-driven push: PROOF.md, plus the sensitive files when there are any.
function prBody(ctx) {
  const file = proofFile(ctx, 'PR_BODY.md');
  let body = fs.readFileSync(proofFile(ctx, 'PROOF.md'), 'utf8').replace(/\s*$/, '\n');
  if (ctx.sensitive.length) {
    body += `\n## Sensitive paths\nThis change touches files that always need a human reviewer:\n${ctx.sensitive.map((h) => `- ${h.repo}: \`${h.file}\``).join('\n')}\n`;
  }
  fs.writeFileSync(file, body);
  return file;
}

async function stageShip(ctx) {
  const t = touched(ctx);
  const sensitive = ctx.sensitive.length ? risk.describe(ctx.sensitive) : null;
  if (!driver.MODES[ctx.mode].autoPush || sensitive) {
    // Stop before push. The driver writes the commands so the PR body is the proof.
    const body = prBody(ctx);
    const commands = t.flatMap((r) => {
      const rel = path.relative(ctx.cfg.root, r.abs);
      return [
        `git -C ${rel} push -u origin ${ctx.branch}`,
        `(cd ${rel} && gh pr create --base ${r.base} --head ${ctx.branch} --title "${ctx.slug}" --body-file ${body})`,
      ];
    });
    let reason;
    if (driver.MODES[ctx.mode].autoPush) reason = `touched sensitive paths: ${sensitive}; a human must review before push`;
    else reason = `bypass mode: review the branch, then push${sensitive ? `. Touches sensitive paths: ${sensitive}` : ''}`;
    mark(ctx, 'ship', 'needs-human', reason);
    return { outcome: 'needs-human', reason, commands };
  }

  const prompt = driver.prompts.ship(promptCtx(ctx), { touched: t.map((r) => r.name) });
  const res = await agent(ctx, 'author', 'ship', 'ship', 'ship', prompt);
  if (res.code !== 0) throw new Blocked('ship', `ship session exited ${res.code}`);
  const rep = stageReport(ctx, 'ship', 'ship');
  const prs = rep.prs && typeof rep.prs === 'object' && !Array.isArray(rep.prs) ? rep.prs : {};
  if (Object.keys(prs).length === 0) throw new Blocked('ship', 'ship reported no PR URLs');
  mark(ctx, 'ship', 'ok');
  return { outcome: 'shipped', prs };
}

function linkLatest(ctx) {
  const latest = path.join(path.dirname(ctx.runDir), 'latest');
  try {
    fs.rmSync(latest, { force: true });
    fs.symlinkSync(path.basename(ctx.runDir), latest);
  } catch { /* convenience only */ }
}

function finish(ctx, result) {
  const finishedAt = new Date().toISOString();
  Object.assign(ctx.status, { finishedAt, outcome: result.outcome, blockedGate: result.gate || null, reason: result.reason || null });
  try { writeJSON(path.join(ctx.runDir, 'status.json'), ctx.status); } catch { /* best-effort */ }
  try {
    history.append(ctx.cfg, {
      slug: ctx.slug,
      mode: ctx.mode,
      repos: ctx.repos.map((r) => r.name),
      runDir: path.relative(ctx.cfg.root, ctx.runDir),
      startedAt: ctx.status.startedAt,
      finishedAt,
      outcome: result.outcome,
      blockedGate: result.gate || null,
      reason: result.reason || null,
      cycles: {
        review: ctx.kinds.review.cycles, fix: ctx.kinds.review.fixes,
        security: ctx.kinds.security.cycles, securityFix: ctx.kinds.security.fixes,
      },
      findings: review.counts(ctx.kinds.review.store),
      securityFindings: ctx.securityOn ? review.counts(ctx.kinds.security.store) : null,
      sensitive: ctx.sensitive.map((h) => `${h.repo}/${h.file}`),
      prs: result.prs || {},
      mergedAt: null,
      reverted: null,
    });
  } catch (e) {
    ctx.log(`! could not write .loops/history.json: ${e.message}`);
  }
}

// Drive one headless run. Never throws for a gate failure: returns
// { outcome: shipped | needs-human | blocked, gate?, reason?, prs?, commands?, runDir }.
async function runPipeline(cfg, loop, mode, opts = {}) {
  const ctx = makeCtx(cfg, loop, mode, opts);
  fs.mkdirSync(path.join(ctx.runDir, 'proof'), { recursive: true });
  fs.mkdirSync(path.join(ctx.runDir, 'review'), { recursive: true });
  linkLatest(ctx);
  ctx.guides = reviewGuides(ctx, true);
  ctx.log(`run dir: ${path.relative(cfg.root, ctx.runDir)}   fix budget: ${ctx.fixCycles} per reviewer   security review: ${ctx.securityOn ? 'on' : 'off'}`);

  let result;
  try {
    await stageBuild(ctx);
    await converge(ctx, ctx.kinds.review, null);
    await securityPass(ctx, null);
    const preQa = heads(ctx);
    await stageQa(ctx);
    if (moved(preQa, heads(ctx)).length) {
      ctx.log('  qa changed code: diff-only review and security review of those commits');
      await converge(ctx, ctx.kinds.review, preQa);
      await securityPass(ctx, preQa);
    }
    stageBuildgate(ctx);
    const problems = review.checkProof(ctx.runDir);
    if (problems.length) throw new Blocked('proof', `no proof: ${problems.join('; ')}`);
    mark(ctx, 'proof', 'ok');
    stageRisk(ctx);
    result = await stageShip(ctx);
  } catch (e) {
    const b = e instanceof Blocked ? e : new Blocked('driver', `driver error: ${e && e.message ? e.message : e}`);
    result = { outcome: 'blocked', gate: b.gate, reason: b.message };
    mark(ctx, b.gate, 'blocked', b.message);
  }
  result.runDir = ctx.runDir;
  finish(ctx, result);
  return result;
}

// What a run would do, stage by stage, without spawning anything (--dry-run).
function describeStages(cfg, loop, mode, opts = {}) {
  const ctx = makeCtx(cfg, loop, mode, opts);
  const p = promptCtx(ctx);
  const guides = reviewGuides(ctx, false);
  const plan = [{ name: 'build', who: 'author', prompt: driver.prompts.build(p) }];
  const reviewer = (k) => {
    const dir = path.join(ctx.runDir, k.dir);
    const withDiff = (cycle) => (r) => ({ ...r, diffFile: path.join(dir, `cycle-${cycle}.${r.repo}.diff`) });
    const later = ctx.repos.map((r) => ({ repo: r.name, range: '<last reviewed head>..HEAD' })).map(withDiff(2));
    plan.push(
      { name: k.kind, who: 'reviewer', note: 'cycle 1: the whole branch', prompt: driver.prompts[k.kind](p, { cycle: 1, ranges: ranges(ctx, null).map(withDiff(1)), guides }) },
      {
        name: k.fixStage, who: 'author', note: `only while important findings are open; at most ${ctx.fixCycles} times in the whole run`,
        prompt: driver.prompts.fix(p, {
          cycle: 1, open: ['<open ids>'], kind: k.kind, allFile: path.join(dir, 'all.json'),
          findingsFile: path.join(dir, 'cycle-1.json'), resolutionsFile: path.join(dir, 'fix-1.resolutions.json'),
        }),
      },
      { name: k.kind, who: 'reviewer', note: 'cycle 2+: only the commits since the last review', prompt: driver.prompts[k.kind](p, { cycle: 2, ranges: later, previous: path.join(dir, 'all.json'), guides }) },
    );
  };
  reviewer(ctx.kinds.review);
  if (ctx.securityOn) reviewer(ctx.kinds.security);
  else plan.push({ name: 'security', who: 'driver', note: 'skipped: review.security is false in loops.json' });
  plan.push(
    { name: 'qa', who: 'author', prompt: driver.prompts.qa(p) },
    { name: 'review', who: 'reviewer', note: `only if qa changed code: diff-only review${ctx.securityOn ? ' and security review' : ''} of those commits` },
    { name: 'buildgate', who: 'driver', note: 'npm run build in each touched repo; output saved as proof' },
    { name: 'proof', who: 'driver', note: 'requires proof/tests.txt, proof/qa.md, PROOF.md (Testing / Risk / How to revert)' },
    { name: 'risk', who: 'driver', note: `files matching review.sensitivePaths (${ctx.sensitivePaths.length} patterns) stop the loop before push in every mode` },
    driver.MODES[mode].autoPush
      ? { name: 'ship', who: 'author', note: 'only when no sensitive path was touched', prompt: driver.prompts.ship(p, { touched: ctx.repos.map((r) => r.name) }) }
      : { name: 'ship', who: 'driver', note: 'bypass: stop before push; print git push + gh pr create with PROOF.md as the body' },
  );
  return {
    runDir: ctx.runDir,
    fixCycles: ctx.fixCycles,
    guides,
    stages: plan.map((s) => (s.prompt
      ? { ...s, argv: [driver.AGENT_BIN, ...driver.agentArgs({ role: s.who, mode, stage: s.name, prompt: s.prompt, runDir: ctx.runDir })] }
      : s)),
  };
}

module.exports = { runPipeline, describeStages, resolveFixCycles, Blocked };
