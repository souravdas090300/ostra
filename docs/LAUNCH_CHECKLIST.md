# Launch-Day Checklist (Stage 1 Start)

This checklist is for the Operator to use on the day of Stage 1 launch (first real guest messages). **Do not start Stage 1 until every item in the Go/No-Go Gate is complete.**

---

## Go/No-Go Gate (Complete Before Launch)

### Product
- [ ] Phases 1-9 merged
- [ ] CI green (lint, typecheck, test, build all pass)
- [ ] Production deployed on Railway/Vercel
- [ ] `/api/health` monitored and returning 200
- [ ] Heartbeat monitors configured for every cron job:
  - [ ] sync-calendars
  - [ ] send-scheduled
  - [ ] retention
  - [ ] escalation-reminders
  - [ ] inbound-recovery
  - [ ] self-check
- [ ] Phase 9 restore rehearsal done and logged in `docs/RESTORE_LOG.md`
- [ ] Kill switches tested on production:
  - [ ] `ASSISTANT_ENABLED=false` - know where it is and how long to apply
  - [ ] `AUTOMATIC_MESSAGES_ENABLED=false` - know where it is and how long to apply
  - [ ] `WHATSAPP_MODE=dry-run` - know where it is and how long to apply
- [ ] Provider spend limits set:
  - [ ] AI provider (Anthropic) monthly budget set
  - [ ] AI template cap set for her account
  - [ ] Twilio spend limits set
- [ ] Alerts reach your phone:
  - [ ] Operator email configured for alerts
  - [ ] Uptime monitor app installed and tested
  - [ ] One alert tested (send a test alert and confirm receipt)

### WhatsApp
- [ ] Dedicated number registered
- [ ] Meta business verified
- [ ] Sender approved in Twilio
- [ ] Templates approved in her main guest languages:
  - [ ] English: [Template SIDs]
  - [ ] Language 2: [Template SIDs]
  - [ ] Language 3: [Template SIDs]
- [ ] Fallback language set
- [ ] Inbound webhook configured: `${APP_URL}/api/webhooks/twilio`
- [ ] Status callback configured: `${APP_URL}/api/webhooks/twilio-status`
- [ ] Real message round trip tested in sandbox on two phones:
  - [ ] Your phone: inbound and outbound tested
  - [ ] Her phone: inbound and outbound tested

### Legal and Admin
- [ ] Data processing agreement signed by her (see `docs/DPA_TEMPLATE.md`)
- [ ] DPA reviewed by a lawyer
- [ ] `/privacy` page live and accessible
- [ ] Guest notice text ready (see `docs/GUEST_NOTICE.md`)
- [ ] Guest notice translated for her main guest languages
- [ ] Pilot agreement signed (see `docs/PILOT_AGREEMENT_TEMPLATE.md`)
- [ ] Pilot agreement reviewed by a lawyer
- [ ] You are registered to trade as required in Malta
- [ ] You know your tax and VAT position
- [ ] You have checked whether you need professional indemnity insurance
- [ ] Accountant consulted before first invoice

### Content
- [ ] Her apartment information is complete for all 3 apartments:
  - [ ] Apartment 1: [Name] - info filled, 20-question test passed
  - [ ] Apartment 2: [Name] - info filled, 20-question test passed
  - [ ] Apartment 3: [Name] - info filled, 20-question test passed
- [ ] 20-question test passed for each apartment (see `docs/ONBOARDING_CHECKLIST.md`)
- [ ] Message templates reviewed and approved by her in her own words:
  - [ ] PRE_ARRIVAL: [Approved?]
  - [ ] CHECK_IN: [Approved?]
  - [ ] CHECK_OUT: [Approved?]
  - [ ] REVIEW_REQUEST: [Approved?]
- [ ] 20-question test results logged: `docs/20-QUESTION-TEST-[HOST-NAME].md`

**STOP:** If any item above is open, fix it first. A smaller launch on time is worse than a correct launch a week late.

---

## Pre-Launch Verification (Day of Launch)

### Confirm No Recent Deployments
- [ ] Nothing deployed in the last 24 hours except the launch release
- [ ] Git commit hash recorded: [Commit hash]

### Environment Variables
- [ ] `WHATSAPP_MODE=production` (NOT sandbox, NOT dry-run)
- [ ] `ASSISTANT_ENABLED=false` (Stage 1 starts with assistant off)
- [ ] `AUTOMATIC_MESSAGES_ENABLED=true`
- [ ] All other environment variables verified

### Deploy
- [ ] Deploy to production
- [ ] Verify deployment succeeded
- [ ] Check `/api/health` returns 200
- [ ] Check status page at `/settings/status` - all jobs green

---

## Stage 1 Launch

### Enable First Apartment Only
- [ ] Confirm only guests with phone number AND opt-in have scheduled messages
- [ ] Check booking pages for the first apartment
- [ ] Verify no guests without opt-in have scheduled messages
- [ ] Verify no other apartments have scheduled messages enabled

### Watch First Scheduled Message
- [ ] Identify the first scheduled message (PRE_ARRIVAL, CHECK_IN, etc.)
- [ ] Wait for the cron to pick it up (every 10 minutes)
- [ ] Watch the status page for the send
- [ ] Verify message type, language, and text are correct
- [ ] Verify delivery status: `delivered`
- [ ] Ask the guest or host to confirm they received it
- [ ] Log the first message details:
  - Message ID: [Message ID]
  - Guest: [Guest name]
  - Type: [PRE_ARRIVAL/CHECK_IN/CHECK_OUT/REVIEW_REQUEST]
  - Sent at: [Timestamp]
  - Delivered at: [Timestamp]
  - Confirmation: [Guest/Host confirmed at X time]

### Communication with Host
- [ ] Tell her exactly how to reach you for the next 48 hours:
  - Phone: [Number]
  - WhatsApp: [Number]
  - Email: [Email]
  - Response time: [Within X hours]
- [ ] Confirm she knows the kill switch she can request

---

## Day 1 Morning Routine (Next Day)

### Before the Host Checks
Run the daily routine (see Phase 10, section 5) before she does:

**Status page:**
- [ ] All jobs green
- [ ] No failed messages
- [ ] Usage within caps

**Guest conversations from yesterday:**
- [ ] Read every conversation in full
- [ ] Right language for all messages
- [ ] Right facts in all messages
- [ ] No odd tone
- [ ] No duplicate messages

**Escalations:**
- [ ] Answered quickly?
- [ ] Did the summary make sense to her?

**Issues:**
- [ ] Anything the assistant said that you would not have said?
- [ ] Fix applied: [Information/Prompt/Code]

**One line in pilot log:**
- Date: [Date]
- Messages in/out: [X in, X out]
- Escalations: [X]
- Mistakes: [X]
- Fixes: [Brief description]
- Time spent: [X minutes]

---

## Stage 1 Gate Criteria

### Continue to Stage 2 Only When:
- [ ] 3 real guests have received all four message types (PRE_ARRIVAL, CHECK_IN, CHECK_OUT, REVIEW_REQUEST)
- [ ] Zero duplicates
- [ ] Zero wrong dates or names
- [ ] Delivery status: delivered for all messages
- [ ] No complaints from guests

### If Any Gate Item Fails:
- [ ] Stop and fall back to Stage 0 (sandbox)
- [ ] Use kill switches first
- [ ] Investigate second
- [ ] Tell her immediately

**Stop conditions (immediate fallback):**
- Guest receives wrong access detail
- Guest receives wrong price
- Guest receives duplicate message
- WhatsApp sender is flagged
- Assistant answers something it should have escalated
- Security or privacy incident

---

## Stage 2: Assistant On (After Stage 1 Gate Passes)

### Before Enabling Assistant
- [ ] Stage 1 gate fully passed
- [ ] Day 7 review held (see pilot log)
- [ ] Host agrees to move to Stage 2

### Enable Assistant
- [ ] Set `ASSISTANT_ENABLED=true`
- [ ] Deploy
- [ ] Verify status page shows assistant enabled
- [ ] Test with a real guest question

### First-Day Attention (Repeat Day 1 Routine)
- [ ] Read every conversation
- [ ] Check for wrong facts about money or access
- [ ] Verify every escalation reached her
- [ ] Ask her: "Would you send this yourself?" for each AI reply

### Stage 2 Gate Criteria
- [ ] At least 10 real guest conversations OR 7 days
- [ ] Zero wrong facts about money or access
- [ ] Every escalation reached her
- [ ] Her reaction: "I would send this myself" for 90% of replies

---

## Stage 3: All Three Apartments (After Stage 2 Gate Passes)

### Before Enabling All Apartments
- [ ] Stage 2 gate fully passed
- [ ] All apartments have complete information
- [ ] All apartments passed 20-question test
- [ ] Host agrees to move to Stage 3

### Enable All Apartments
- [ ] Enable automatic messages for all apartments
- [ ] Ensure only guests with opt-in have scheduled messages
- [ ] Deploy
- [ ] Verify status page

### Stage 3 Gate Criteria
- [ ] Rest of the 30 days
- [ ] No incident above "minor" for 7 days

---

## Emergency Contacts

**Operator:**
- Phone: [Number]
- WhatsApp: [Number]
- Email: [Email]
- Available: [Hours, e.g., 08:00-21:00 Malta time]

**Host:**
- Phone: [Number]
- WhatsApp: [Number]
- Email: [Email]

**Kill Switches:**
- Railway/Vercel environment variables: [Link to dashboard]
- Apply time: [e.g., 2 minutes to deploy]

---

## Launch Log

**Launch date:** [Date]
**Launch time:** [Time]
**Stage:** [Stage 1 start]
**Operator:** [Name]
**Host:** [Name]

**Pre-launch checks completed at:** [Time]
**Deployment completed at:** [Time]
**First message sent at:** [Time]
**First message delivered at:** [Time]
**Host notified at:** [Time]

**Any issues:**
[Any issues encountered and resolutions]

**Notes:**
[Any additional notes]
