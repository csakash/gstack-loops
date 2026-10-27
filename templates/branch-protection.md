# Branch protection for repos that take loop PRs

gloop opens pull requests. It never merges them and never changes repository settings. These
settings make GitHub enforce the parts of the review layers that live after the PR. Apply them
per repo, on the default branch (Settings → Branches, or Settings → Rules → Rulesets).

## Pull request rules
- **Require a pull request before merging**, with at least 1 approval.
- **Dismiss stale pull request approvals when new commits are pushed.** An approval covers one
  commit; anything an agent pushes afterwards needs a fresh look.
- **Require approval of the most recent reviewable push**, so whoever pushed last cannot be the
  only approver.
- **Require review from Code Owners**, with the CODEOWNERS file below.
- **Require conversation resolution before merging**: every review finding is fixed or closed
  with a reason, as the loop already does locally.
- **Require status checks to pass** (your CI).

## Agents do not approve
- Turn off **Allow GitHub Actions to create and approve pull requests** (Settings → Actions →
  General), so an automated approval can never satisfy a required review.

## CODEOWNERS for gloop's default sensitive paths
Save as `.github/CODEOWNERS` and replace `@<owners>` with the people or team who must review
these paths. Mirror any changes you make to `review.sensitivePaths` in `loops.json`.

```
.github/workflows/   @<owners>
.gitlab-ci.yml       @<owners>
.circleci/           @<owners>
Jenkinsfile          @<owners>
CODEOWNERS           @<owners>
.github/CODEOWNERS   @<owners>
auth/                @<owners>
billing/             @<owners>
payments/            @<owners>
migrations/          @<owners>
/setup               @<owners>
install*             @<owners>
```
