# Phase 6 implementation audit

Date: 2026-11-03  
Branch: `audit/parent-dependency-updates`

This report records implementation evidence and validation. The specification files were not changed for this audit.

## Verification

| Area | Evidence | Result |
|---|---|---|
| Meta template request, versioned naming, examples, locale, and category | `lib/template-approval.ts`; PostgreSQL coverage in `tests/template-approval-db.test.ts` | Passed |
| Approval webhook, polling reconciliation, paused-template send prevention | `lib/meta-webhook.ts`, `lib/template-approval.ts`, `lib/send-scheduled.ts`; `tests/template-approval-db.test.ts` | Passed |
| Settings server actions and owner scoping | `app/(app)/settings/messages/actions.ts`; `tests/messages-settings-actions-db.test.ts` | Passed |
| Opt-out persists booking state and a phone hash | `lib/optout.ts`; `tests/phase6-safety-db.test.ts` | Passed against PostgreSQL |
| Stale `SENDING` row cleanup | `lib/send-scheduled.ts`; `tests/phase6-safety-db.test.ts` | Passed against PostgreSQL |
| Automatic-message kill switch is read at call time | `lib/flags.ts`, `lib/send-scheduled.ts`; `tests/phase6-safety-db.test.ts` | Passed against PostgreSQL |
| `JobLease` Prisma model and existing table migration | `prisma/schema.prisma`, `prisma/migrations/20261025_init/migration.sql`; `tests/phase6-safety-db.test.ts` | Passed against PostgreSQL |
| Previously skipped credential-auth test | `tests/phase1-auth-middleware.test.ts` | Unskipped; passed after calling the configured `options.authorize` callback rather than NextAuth's default provider stub |
| Inbox token-scan timeout guard | `lib/translate-reply.ts`, `tests/inbox.test.ts` | Replaced the nested token regex scan, which could rescan each long token, with a linear whitespace-token scan; 100,000-character regression test passes. The previously observed suite timeout did not reproduce in isolation; full suite now passes. |
| Live Meta sender and approval lifecycle | Requires a configured Meta app, WABA, test number, and credentials | Not verified locally |

## Local validation

- `npm test`: 736 passed, 49 skipped, 0 failed, after the E2.3 usage-accounting change.
- `npm run typecheck`: passed.
- `npm run lint`: passed with 0 errors and 72 warnings.
- `npm run build`: passed.
- `npm audit --omit=dev`: 5 moderate package entries, limited to the two documented exceptions; the CI audit policy accepts only these exact advisory IDs until the review date.
- The CI audit-check script passed against the full audit report and rejected a synthetic, unapproved moderate advisory.
- GitHub Actions has not run for this local feature branch; the earlier `develop` runs failed at raw `npm audit` before the scoped exception was added.

## Dependency audit finding

The production-only `npm audit --omit=dev` reports five affected package entries for two moderate advisories. The full audit reports 18 affected package entries for those same two advisories:

- CVE-2026-118773 (`GHSA-3g3m-2fjr-6pw4`): transitive `glob@13.0.6`; the advisory recommends `glob@14.0.2` or later.
- CVE-2026-118764 (`GHSA-g3hv-75wg-m249`): transitive `minimatch@10.2.6` in the production Sentry graph and `minimatch@3.1.5` in development tooling; the advisory recommends `minimatch@11.0.1` or later.

On the separate audit branch, the available parents were updated within their current majors: `@sentry/nextjs` 11.8.0 → 11.10.0 and `@typescript-eslint` 8.71.2 → 8.72.1. `eslint@9.39.5` and `eslint-config-next@15.5.28` are already the latest releases in their current majors. The latest Sentry bundler plugin still declares `glob@^13.0.6`; the latest TypeScript-ESLint parser still resolves `minimatch@^10.2.2`. The patched `glob`/`minimatch` releases require major-version changes in those dependency edges.

No `minimatch` override was retained. A temporary `minimatch@11` override removed the findings but broke ESLint 9 because `@eslint/eslintrc` imports a default export not provided by minimatch 11. The parent upgrades did not remove the advisories, so the CI audit now has a time-limited, exact-advisory exception:

| Advisory | Reason not applicable to production request paths | Review by |
|---|---|---|
| `GHSA-3g3m-2fjr-6pw4` / CVE-2026-118773 | The production dependency is in Sentry's bundler-plugin graph. The application has no direct glob API or user-controlled glob/abort-signal call path; guest input is not used as a glob pattern. | 2026-12-03 |
| `GHSA-g3hv-75wg-m249` / CVE-2026-118764 | The production occurrence is the same Sentry bundler-plugin graph; remaining occurrences are ESLint tooling. The application does not pass guest-controlled patterns to minimatch. | 2026-12-03 |

**Execution context:** `glob` and `minimatch` are not called by Ostra request/runtime code. They occur through Sentry's bundler plugin, which is build-tooling code. The app's `next.config.mjs` does not use `withSentryConfig`, so this plugin path is currently installed transitively but not invoked by this project's Next build. The separate ESLint minimatch copies are development-only.

**Review reminder: 2026-12-03.** Re-run `npm audit`, inspect whether upstream Sentry and TypeScript-ESLint parents have moved to patched dependency ranges, and remove or renew the exception with fresh evidence. The exception expires on this date; it is not an automatic renewal.

`scripts/check-npm-audit.mjs` accepts only these two GHSA IDs at `moderate` severity before the review date. CI still runs `npm audit --audit-level=moderate`; any other moderate-or-higher advisory, higher severity for an excepted advisory, invalid report, or expired exception fails. No audit threshold was lowered.

## Phase 9 CI and history checks

| Requested item | Repository status / evidence |
|---|---|
| Gitleaks in CI | Not present. CI still has the existing credential-pattern `git grep` step, not Gitleaks. |
| `prisma validate` in CI | Not present. |
| Migration drift check (`prisma migrate diff`) in CI | Not present; CI deploys migrations to its disposable PostgreSQL service. |
| `.github/dependabot.yml` | Not present. |
| Semgrep workflow | Not present; `.github/workflows/` contains only `ci.yml` (consistent with the prior request to remove Semgrep from the workflow). |
| Gitleaks full-history scan | Gitleaks 8.30.1 scanned full history across refs with `--log-opts=--all`; zero findings. |

## Enquiry assistant E2.3

In `lib/enquiry-assistant.ts`, `answerEnquiry` checks `assistantEnabled()` and `assertAiBudget()` before entering the model-call loop. Usage is now recorded for every successful `client.messages.create` response, including tool rounds, before tool handling or final-output validation. `tests/enquiry-assistant.test.ts` verifies the kill switch and budget prevent calls and that a two-round tool interaction records both usage values. This closes the previous gap where only the final `respond` round was recorded.

## Skipped tests

There were 50 skips before this audit. One auth test has now been enabled and passes; the 49 remaining skips are live LLM-evaluation cases in `tests/llm-eval.test.ts`. `describe.skipIf` disables them unless `RUN_LLM_EVALS=1`; each makes a real Anthropic API call. The test environment has no Anthropic API key, so these remain opt-in rather than being silently enabled or run with fake results.

| File | Test | Skip reason |
|---|---|---|
| `tests/phase1-auth-middleware.test.ts` | authorize function — returns owner with correct credentials | Formerly skipped because of an assumed Prisma-client issue; resolved by invoking the configured `options.authorize` callback instead of NextAuth's default stub; now enabled and passing |
| `tests/llm-eval.test.ts` | English — handles Wi-Fi | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | English — handles Door code | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | English — handles Not in information | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | English — handles Date change | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | English — handles Money | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | English — handles Emergency | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | English — handles Prompt injection | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | English — handles Opt-out | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | Italian — handles Wi-Fi | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | Italian — handles Door code | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | Italian — handles Not in information | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | Italian — handles Date change | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | Italian — handles Money | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | Italian — handles Emergency | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | Italian — handles Prompt injection | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | Italian — handles Opt-out | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | German — handles Wi-Fi | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | German — handles Door code | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | German — handles Not in information | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | German — handles Date change | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | German — handles Money | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | German — handles Emergency | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | German — handles Prompt injection | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | German — handles Opt-out | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | French — handles Wi-Fi | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | French — handles Door code | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | French — handles Not in information | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | French — handles Date change | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | French — handles Money | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | French — handles Emergency | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | French — handles Prompt injection | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | French — handles Opt-out | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | Spanish — handles Wi-Fi | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | Spanish — handles Door code | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | Spanish — handles Not in information | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | Spanish — handles Date change | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | Spanish — handles Money | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | Spanish — handles Emergency | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | Spanish — handles Prompt injection | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | Spanish — handles Opt-out | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | Arabic — handles Wi-Fi | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | Arabic — handles Door code | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | Arabic — handles Not in information | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | Arabic — handles Date change | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | Arabic — handles Money | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | Arabic — handles Emergency | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | Arabic — handles Prompt injection | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | Arabic — handles Opt-out | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |
| `tests/llm-eval.test.ts` | handles locked details | Live Anthropic evaluation; requires `RUN_LLM_EVALS=1` and a real API key |

The former auth skip (“returns owner with correct credentials”) is no longer skipped. It now invokes the configured Credentials provider callback, not the default `authorize` stub that always returns `null`, and passes.

## Lint configuration comparison

`eslint.config.js` is unchanged. `package.json`'s lint script is unchanged (`eslint .`); its only diff for this work removes the unused `twilio` dependency. Existing rule overrides in `eslint.config.js`:

- `no-console: off` for `lib/log.ts` and `scripts/**/*`, where logging is centralized or used by operator scripts.
- `no-console: off` for `tests/**/*` and `prisma/seed.ts`, for test diagnostics and seed output.
- `@typescript-eslint/no-explicit-any: off` for `tests/**/*`, where Prisma mocks and test fixtures use loose generated shapes.

No lint rule was added, disabled, or loosened by this change.
