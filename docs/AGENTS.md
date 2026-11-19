# Ostra: rules for AI engineers

Product: guest messaging and booking overview for holiday-rental hosts in Malta. Node 22, Next.js App Router, TypeScript strict, Prisma and PostgreSQL, Auth.js, Meta WhatsApp Cloud API, Anthropic API. Specifications are in docs/spec/ (start with OSTRA_MASTER_GUIDE.md). Hosting is undecided; Railway references in specs are superseded by OSTRA_META_WHATSAPP_ADDENDUM.md and OSTRA_SCHEDULER_TICK.md where they differ.

## Commands
npm run dev | lint | typecheck | test | build | db:migrate | db:deploy | db:seed
Tests run with TZ=UTC. Database tests need DATABASE_URL pointing at a throwaway database.

## Non-negotiable rules
1. Every query that touches owner data is scoped by ownerId (through the apartment). Every server action and page starts with requireOwner(). Add an owner-scoping test for anything new.
2. Never log or report phone numbers, guest names, message text, calendar URLs or tokens. Use src/lib/log.ts (allow-list) and reportError(). No console.* in src (ESLint enforces it).
3. Dates are Malta calendar dates (YYYY-MM-DD strings); stays occupy nights [checkIn, checkOut). Use src/lib/dates.ts and src/lib/time.ts. Never do day arithmetic on Date objects.
4. The AI never decides availability, prices, money, access or exceptions. Code does, or the host does. AI output is checked by code before it is sent.
5. Private apartment information (codes, Wi-Fi password, address) goes into a prompt only inside the unlock window, and never into enquiry prompts.
6. WhatsApp uses the Meta Cloud API. Free-form messages only inside the 24-hour window; business-initiated messages only through approved templates and only to guests who opted in. WHATSAPP_MODE defaults to dry-run.
7. Anything sent to a guest must be idempotent (unique SIDs, atomic claims) and at-most-once.
8. Migrations: one per phase, named as in the phase document, never edited after merge, expand-then-contract.
9. Keep PRs to one phase. Do not add dependencies that are not named in the phase document without saying why in the PR.
10. UI is mobile first (390 px), no horizontal page scroll, text rendered with dir="auto" for guest content, colour never the only signal.
11. When a document and reality disagree, stop and report; do not guess silently.
12. Done means: a file path plus a passing test name (plus the manual check where a document requires one).
