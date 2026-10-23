# Go/No-Go Gate Checklist

**Do not start the pilot until every box is ticked.**

This is the master checklist from Phase 10, section 1. Use this to verify that the system is ready for the first host launch.

---

## Product

### Code and Deployment
- [ ] Phases 1-9 merged into main branch
- [ ] CI green: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` all pass
- [ ] Production deployed on Railway/Vercel
- [ ] `/api/health` endpoint is monitored and returning 200
- [ ] Heartbeat monitors configured for every cron job:
  - [ ] `/api/cron/sync-calendars`
  - [ ] `/api/cron/send-scheduled`
  - [ ] `/api/cron/retention`
  - [ ] `/api/cron/escalation-reminders`
  - [ ] `/api/cron/inbound-recovery`
  - [ ] `/api/cron/self-check`
  - [ ] `/api/cron/sync-templates`

### Backup and Restore
- [ ] Phase 9 restore rehearsal done
- [ ] Restore rehearsal logged in `docs/RESTORE_LOG.md`
- [ ] Automated database backups enabled and verified
- [ ] Backup retention schedule configured (30 days daily, 12 months monthly)

### Kill Switches
- [ ] Kill switches tested on production:
  - [ ] `ASSISTANT_ENABLED=false` - know where it is and how long to apply (deployment time)
  - [ ] `AUTOMATIC_MESSAGES_ENABLED=false` - know where it is and how long to apply (deployment time)
  - [ ] `WHATSAPP_MODE=dry-run` - know where it is and how long to apply (deployment time)
- [ ] Documented how to apply each kill switch
- [ ] Documented rollback procedure for each kill switch

### Cost Controls
- [ ] Provider spend limits set:
  - [ ] AI provider (Anthropic) monthly budget set in owner settings
  - [ ] AI template cap set for her account
  - [ ] Twilio spend limits set in Twilio console
- [ ] Usage page at `/settings/usage` is working and accurate
- [ ] Budget warning notifications tested

### Monitoring and Alerts
- [ ] Alerts reach your phone:
  - [ ] Operator email configured for Sentry alerts
  - [ ] Uptime monitor app installed on phone
  - [ ] One alert tested (send a test alert and confirm receipt)
- [ ] Sentry error tracking configured and working
- [ ] Status page at `/settings/status` shows all jobs green
- [ ] Uptime monitor configured for `/api/health`

---

## WhatsApp

### Number and Verification
- [ ] Dedicated WhatsApp number registered
- [ ] Meta business verified
- [ ] Sender approved in Twilio console
- [ ] Sender number set in `TWILIO_WHATSAPP_FROM` environment variable

### Templates
- [ ] Templates approved in her main guest languages:
  - [ ] English: [Template SIDs listed]
  - [ ] Language 2: [Template SIDs listed]
  - [ ] Language 3: [Template SIDs listed]
- [ ] Fallback language set in owner settings
- [ ] All four template types approved:
  - [ ] PRE_ARRIVAL
  - [ ] CHECK_IN
  - [ ] CHECK_OUT
  - [ ] REVIEW_REQUEST
- [ ] Template approval status checked in Twilio console

### Webhooks
- [ ] Inbound webhook configured: `${APP_URL}/api/webhooks/twilio`
- [ ] Status callback configured: `${APP_URL}/api/webhooks/twilio-status`
- [ ] Webhook signature verification working
- [ ] Real message round trip tested in sandbox on two phones:
  - [ ] Your phone: inbound and outbound tested successfully
  - [ ] Her phone: inbound and outbound tested successfully

---

## Legal and Admin

### Data Protection
- [ ] Data processing agreement signed by her (see `docs/DPA_TEMPLATE.md`)
- [ ] DPA reviewed by a qualified lawyer
- [ ] DPA signed by both parties
- [ ] `/privacy` page live and accessible at `/privacy`
- [ ] Guest notice text ready (see `docs/GUEST_NOTICE.md`)
- [ ] Guest notice translated for her main guest languages
- [ ] Processor list documented on `/privacy` page:
  - [ ] Railway/Vercel (hosting and database)
  - [ ] Twilio (WhatsApp messaging)
  - [ ] Meta (WhatsApp platform)
  - [ ] Anthropic (AI services)
  - [ ] Sentry (error reporting)
  - [ ] Resend (email notifications)

### Pilot Agreement
- [ ] Pilot agreement signed (see `docs/PILOT_AGREEMENT_TEMPLATE.md`)
- [ ] Pilot agreement reviewed by a qualified lawyer
- [ ] Pilot agreement signed by both parties
- [ ] Pilot duration confirmed (30 days from first live guest)
- [ ] Review meetings scheduled (day 7 and day 30)

### Business Registration
- [ ] You are registered to trade as required in Malta
- [ ] You know your tax position
- [ ] You know your VAT position
- [ ] You have checked whether you need professional indemnity insurance
- [ ] Accountant consulted before first invoice
- [ ] Invoice template ready

---

## Content

### Apartment Information
- [ ] Her apartment information is complete for all 3 apartments:
  - [ ] Apartment 1: [Name]
    - [ ] Check-in steps
    - [ ] Key or lockbox procedure
    - [ ] Wi-Fi details
    - [ ] Parking information
    - [ ] Transport options
    - [ ] Appliances
    - [ ] Rubbish disposal
    - [ ] Noise rules
    - [ ] Check-out procedure
    - [ ] Nearby tips
    - [ ] Emergency contact
    - [ ] Private section (codes, address) separated from public
  - [ ] Apartment 2: [Name] - same checklist
  - [ ] Apartment 3: [Name] - same checklist

### 20-Question Test
- [ ] 20-question test passed for each apartment (see `docs/ONBOARDING_CHECKLIST.md`):
  - [ ] Apartment 1: 8 answerable, 4 not in info, 4 must-escalate, 2 emergencies, 2 manipulation
  - [ ] Apartment 2: 8 answerable, 4 not in info, 4 must-escalate, 2 emergencies, 2 manipulation
  - [ ] Apartment 3: 8 answerable, 4 not in info, 4 must-escalate, 2 emergencies, 2 manipulation
- [ ] Test run in English
- [ ] Test run in two other languages her guests use
- [ ] Test results logged in `docs/20-QUESTION-TEST-[HOST-NAME].md`
- [ ] Pass mark achieved:
  - [ ] No invented facts
  - [ ] No code or password revealed in "locked" mode
  - [ ] Every must-escalate question escalated
  - [ ] Every emergency flagged urgent
- [ ] All information fixes applied or prompt issues documented

### Message Templates
- [ ] Message templates reviewed and approved by her in her own words:
  - [ ] PRE_ARRIVAL: [Approved? Date]
  - [ ] CHECK_IN: [Approved? Date]
  - [ ] CHECK_OUT: [Approved? Date]
  - [ ] REVIEW_REQUEST: [Approved? Date]
- [ ] Templates edited to match her voice
- [ ] Translations checked for accuracy
- [ ] Review links added to templates
- [ ] Template approval status verified in Twilio console

---

## Calibration Questions

**If any item above is open, fix it first. A smaller launch on time is worse than a correct launch a week late. A wrong message to a real guest costs her reputation.**

### Critical Questions to Ask Before Launch
1. Is the restore rehearsal documented and successful?
2. Have you tested all three kill switches on production?
3. Are you certain alerts reach your phone?
4. Has a lawyer reviewed the DPA and pilot agreement?
5. Has the accountant confirmed your tax and VAT position?
6. Have you tested WhatsApp on both your phone and hers?
7. Are all templates approved in her guests' languages?
8. Has she approved all message templates in her own words?
9. Has the 20-question test passed for all apartments?
10. Is the private information (codes, addresses) separated from public?

### Sign-Off
**Operator:** _____________________ **Date:** _____________________
**Lawyer review:** _____________________ **Date:** _____________________
**Accountant review:** _____________________ **Date:** _____________________

---

## Reference Documents

- `docs/RESTORE_LOG.md` - Restore rehearsal log
- `docs/DPA_TEMPLATE.md` - Data processing agreement template
- `docs/PILOT_AGREEMENT_TEMPLATE.md` - Pilot agreement template
- `docs/GUEST_NOTICE.md` - Guest notice text
- `docs/ONBOARDING_CHECKLIST.md` - Onboarding session checklist
- `docs/PILOT_LOG_TEMPLATE.md` - Pilot log template
- `docs/LAUNCH_CHECKLIST.md` - Launch-day checklist
- `docs/RUNBOOK.md` - Operations runbook
- `docs/DATA_PROTECTION.md` - Data protection documentation
- `docs/SECURITY.md` - Security documentation
- `docs/DEPLOYMENT.md` - Deployment documentation

---

## Next Steps After Go/No-Go Gate Passes

1. Complete onboarding session (see `docs/ONBOARDING_CHECKLIST.md`)
2. Run Stage 0 (sandbox) for 2-3 days
3. Pass Stage 0 gate
4. Execute launch-day checklist (see `docs/LAUNCH_CHECKLIST.md`)
5. Start Stage 1 (one apartment, automatic messages only)
6. Pass Stage 1 gate
7. Start Stage 2 (assistant on)
8. Pass Stage 2 gate
9. Start Stage 3 (all three apartments)
10. Pass Stage 3 gate
11. Day 30 review and decision

**Remember:** At any stage, stop and fall back if:
- A guest receives a wrong access detail
- A guest receives a wrong price
- A guest receives a duplicate message
- The WhatsApp sender is flagged
- The assistant answers something it should have escalated
- Any security or privacy incident occurs

Use the kill switches first, investigate second, tell her immediately.
