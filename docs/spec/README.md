# Ostra specifications

Read `OSTRA_MASTER_GUIDE.md` first. It lists the build order and the prompt for each phase.

## Rules when documents disagree
1. `OSTRA_META_WHATSAPP_ADDENDUM.md` wins over every Twilio statement in other documents. WhatsApp uses the Meta Cloud API.
2. `OSTRA_SCHEDULER_TICK.md` replaces the per-job cron service tables. One `/api/cron/tick` runs whatever is due.
3. Hosting is undecided (Railway is not available; a VPS or Render is being chosen). Ignore every hosting statement for now.
4. Phase numbers: 1-13, plus E1-E3 (also called Phases 14-16). Build E1-E3 before Phase 12.
5. The folder `_not-used/` holds older or alternative drafts. Do not follow them.

## Audit rule
Done means: a file path plus a passing test name (plus the manual check where a document requires one).
