# Phase 6 implementation audit

Date: 2026-11-03  
Branch: `develop`

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

- `npm test`: 736 passed, 49 skipped, 0 failed.
- `npm run typecheck`: passed.
- `npm run lint`: passed with 0 errors and 75 warnings.
- `npm run build`: passed.
- `prisma migrate status` against the disposable `ostra_test` database: up to date.
- GitHub Actions: both the push run and PR run passed setup, lint, typecheck, tests, and build, then failed at `npm audit --audit-level=moderate`.

## Dependency audit finding

The CI audit reports 18 moderate affected-package entries representing two advisories:

- CVE-2026-118773 (`GHSA-3g3m-2fjr-6pw4`): transitive `glob@13.0.6`; the advisory recommends `glob@14.0.2` or later.
- CVE-2026-118764 (`GHSA-g3hv-75wg-m249`): transitive `minimatch@10.2.6` and `minimatch@3.1.5`; the advisory recommends `minimatch@11.0.1` or later.

The suggested fixes cross major-version boundaries. A local override to patched `glob` and `minimatch` versions removed the audit findings, but `minimatch@11` is incompatible with the current ESLint 9 dependency stack (`@eslint/eslintrc` imports a default export that `minimatch@11` does not provide), causing lint to fail. The override was reverted; no dependency override or audit-scope change is included. A compatible lint/toolchain update or upstream-compatible patch is required before CI can be fully green.

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
