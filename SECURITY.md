# Security

## Reporting a vulnerability

Report vulnerabilities privately through GitHub: in the repository, open the **Security and
quality** tab and choose **Report a vulnerability**, or use the
[reporting form](https://github.com/Fibrous-Finance/fiberscope/security/advisories/new). The
report stays between you and the maintainers until an advisory is published.

Do not open a public issue, pull request or discussion about a vulnerability.

Include what is affected, the steps to reproduce it, and the impact you expect.

## Scope

In scope:

- The code in this repository: the site (`apps/web`), the indexer (`apps/indexer`),
  `packages/core` and the GitHub workflows.
- The live site at [fiberscope.org](https://fiberscope.org), its `workers.dev` address (which
  redirects there) and its pull-request previews.
- Leaks of the deployment's credentials: the Cloudflare API token the workflows use and the R2 key
  the indexer uploads with.

Out of scope:

- Services Fiberscope reads or runs on: CoW Protocol's contracts, API and solver registry, Base,
  Chainlink, Cloudflare, AWS and GitHub. Report vulnerabilities in these services to their owners.
- A figure you believe is wrong. That is a bug, not a vulnerability: open an issue.

The site has no user accounts and no forms; the appearance choice stays in the browser's local
storage.
