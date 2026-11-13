# SPEC: add-mit-license

`package.json` already declares `"license": "MIT"`, but the repo has no LICENSE file, so GitHub
reports no license and downstream projects (rloop) can't safely depend on it.

## Must
- Add `LICENSE` with the standard MIT text, copyright 2026 Akash Munshi.
- Add a License section to `README.md`.

## Must not
- Change any code or behavior.

## Done when
`npm test` passes and GitHub detects the license as MIT.
