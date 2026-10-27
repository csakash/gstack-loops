# Source this to point a shell at the e2e mock: mock gh + claude wrapper first on PATH,
# gloop from this checkout. Usage: E2E=<dir> . test/e2e/env.sh
E2E_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export E2E="${E2E:?set E2E to a scratch dir}"
export E2E_REAL_CLAUDE="${E2E_REAL_CLAUDE:-$(command -v claude)}"
export PATH="$E2E_HERE/bin:$E2E_HERE/../../bin:$PATH"
export E2E_GH_STATE="$E2E/gh-state.json" E2E_GH_LOG="$E2E/gh.log" E2E_CLAUDE_LOG="$E2E/claude.log"
