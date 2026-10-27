// Risk tiers: which files a change touches that always need a human. The tier comes from
// the change, never from who ran the loop. Zero-dep glob matcher: `**` spans directories,
// `*` and `?` stay within one path segment, anything else is literal.
const { run } = require('./util');

// The default when loops.json sets no review.sensitivePaths. [] opts out.
const DEFAULT_SENSITIVE = [
  '.github/workflows/**', '.gitlab-ci.yml', '.circleci/**', 'Jenkinsfile',
  'CODEOWNERS', '.github/CODEOWNERS',
  '**/auth/**', '**/billing/**', '**/payments/**',
  '**/migrations/**',
  'setup', '**/install*',
];

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      // "**/" matches zero or more whole directories; a trailing "**" matches the rest.
      if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
    } else if (ch === '*') {
      re += '[^/]*';
    } else if (ch === '?') {
      re += '[^/]';
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

function matchesAny(file, patterns) {
  const f = String(file).replace(/^\.\//, '');
  return patterns.some((p) => globToRegExp(p).test(f));
}

// Files changed in `range` (both sides of a rename) that match a sensitive pattern.
function sensitiveFiles(repoAbs, range, patterns) {
  if (!patterns || patterns.length === 0) return [];
  const out = run('git', ['-C', repoAbs, 'diff', '--name-only', '--no-renames', range], { allowFail: true, stdio: 'pipe' });
  if (!out) return [];
  return out.split('\n').filter(Boolean).filter((f) => matchesAny(f, patterns));
}

// For each repo { name, abs, baseRef }: sensitive files on the branch. -> [{ repo, file }]
function touchedSensitive(repos, patterns) {
  return repos.flatMap((r) => sensitiveFiles(r.abs, `${r.baseRef}...HEAD`, patterns).map((file) => ({ repo: r.name, file })));
}

// One readable line, capped, for statuses and PR bodies.
function describe(hits, max = 3) {
  const names = hits.map((h) => `${h.repo}/${h.file}`);
  return names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}

module.exports = { DEFAULT_SENSITIVE, globToRegExp, matchesAny, sensitiveFiles, touchedSensitive, describe };
