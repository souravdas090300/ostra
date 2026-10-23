# Pilot Log

**Host:** [Host Name]
**Pilot Start Date:** [Date]
**Operator:** [Operator Name]
**Current Stage:** [Stage 0/1/2/3/4]

---

## Daily Log (Operator, 10 minutes daily during week 1)

### Day 1 ([Date])
**Status page check:**
- [ ] All jobs green
- [ ] No failed messages
- [ ] Usage within caps

**Guest conversations review:**
- [ ] Right language for all messages
- [ ] Right facts in all messages
- [ ] No odd tone
- [ ] No duplicate messages

**Escalations:**
- [ ] Answered quickly? (median under 30 minutes in daytime)
- [ ] Did the summary make sense to the host?

**Issues:**
- Anything the assistant said that you would not have said:
  - [Description]
  - Fix: [Information fix / Prompt fix / Code fix]

**Time spent:** ___ minutes

**One-line summary:** [Brief summary of the day]

---

### Day 2 ([Date])
**Status page check:**
- [ ] All jobs green
- [ ] No failed messages
- [ ] Usage within caps

**Guest conversations review:**
- [ ] Right language for all messages
- [ ] Right facts in all messages
- [ ] No odd tone
- [ ] No duplicate messages

**Escalations:**
- [ ] Answered quickly?
- [ ] Did the summary make sense to the host?

**Issues:**
- Anything the assistant said that you would not have said:
  - [Description]
  - Fix: [Information fix / Prompt fix / Code fix]

**Time spent:** ___ minutes

**One-line summary:** [Brief summary of the day]

---

### Day 3 ([Date])
[Repeat the same format for each day of week 1]

---

### Day 4 ([Date])
[Repeat the same format for each day of week 1]

---

### Day 5 ([Date])
[Repeat the same format for each day of week 1]

---

### Day 6 ([Date])
[Repeat the same format for each day of week 1]

---

### Day 7 ([Date])
**Day 7 Review Meeting** (see separate section below)

---

## Weekly Check-In (20 minutes with host)

### Week 1 Check-In ([Date])
**What saved time:**
- [Host's feedback]

**What annoyed the host:**
- [Host's feedback]

**What guests said:**
- [Host's feedback]

**What the host wishes it did:**
- [Host's feedback]

**Decisions made:**
- [Any changes agreed upon]

**Operator time spent this week:** ___ hours

---

### Week 2 Check-In ([Date])
[Repeat the same format for each week]

---

### Week 3 Check-In ([Date])
[Repeat the same format for each week]

---

### Week 4 Check-In ([Date])
[Repeat the same format for each week]

---

## Day 7 Review Meeting Agenda

**Date:** [Date]
**Duration:** 20 minutes

### Metrics (from Phase 10, section 6)
- [ ] Her time saved (estimate minutes per day before vs after)
- [ ] Messages answered without her (assistant replies not escalated / total guest messages)
- [ ] Wrong or risky answers (0 involving money/access/safety; <2 per week otherwise)
- [ ] Escalation response time (median under 30 minutes in daytime)
- [ ] Delivery (over 95% delivered; every failure explained)
- [ ] Guest reaction (no complaints about messages)
- [ ] Cost per month (known and under target price)
- [ ] Your support time (should be falling)
- [ ] Incidents (none above "minor" in last 7 days)

### Every wrong or awkward answer
- [List each wrong answer and the fix applied]

### Templates the host rewrote
- [List templates edited]

### Stage gate decision
- [ ] Stay in Stage 1 (automatic messages only)
- [ ] Move to Stage 2 (assistant on)
- [ ] Fall back to Stage 0 (sandbox)
- [ ] Stop pilot

### Cost so far
- AI usage: [€X.XX]
- WhatsApp messages: [X messages, €X.XX]
- Total: [€X.XX]

---

## Day 30 Review Meeting Agenda

**Date:** [Date]
**Duration:** 30 minutes

### Metrics (same as Day 7)
- [ ] Her time saved
- [ ] Messages answered without her
- [ ] Wrong or risky answers
- [ ] Escalation response time
- [ ] Delivery
- [ ] Guest reaction
- [ ] Cost per month
- [ ] Your support time
- [ ] Incidents

### Issues since Day 7
- [List any new issues and resolutions]

### Templates edited since Day 7
- [List templates]

### Pricing evidence (from Phase 10, section 7)
**Your cost per host per month:**
- Railway/Vercel share: [€X.XX]
- WhatsApp: [€X.XX]
- AI usage: [€X.XX]
- Backup storage: [€X.XX]
- Your monitoring and support time: [X hours × €XX/hour = €X.XX]
- **Total cost:** [€X.XX]

**Value to her:**
- Hours saved per week: [X hours]
- Her hourly value: [€XX/hour]
- Value per month: [X × 4.3 × €XX = €X.XX]
- Proposed price: [€X.XX per month] (20-30% of value)

### Decision
- [ ] Sign paid terms
- [ ] Extend pilot (reason: ___________)
- [ ] Stop pilot (reason: ___________)

### Testimonial request
- [ ] Host agrees to provide testimonial
- [ ] Host agrees to anonymised case study
- [ ] Host name included in case study: [Yes/No]

---

## Stage Gates

### Stage 0: Sandbox (2-3 days)
**What is live:** Everything in sandbox with you and her as the "guests"; production data entered but no real guest messaged

**Gate to continue:**
- [ ] 10 scripted conversations pass
- [ ] She understands the inbox
- [ ] No surprises in the status page

**Completed:** [Date]

---

### Stage 1: One apartment, automatic messages only
**What is live:** Production sender, one apartment, only guests who agreed, assistant off

**Duration:** Until 3 real guests have received all four message types

**Gate to continue:**
- [ ] Zero duplicates
- [ ] Zero wrong dates or names
- [ ] Delivery status: delivered
- [ ] No complaints

**Completed:** [Date]

---

### Stage 2: Assistant on, same apartment
**What is live:** Assistant answers in-house and arriving guests

**Duration:** At least 10 real guest conversations or 7 days

**Gate to continue:**
- [ ] Zero wrong facts about money or access
- [ ] Every escalation reached her
- [ ] Her reaction: "I would send this myself" for 90% of replies

**Completed:** [Date]

---

### Stage 3: All three apartments
**What is live:** All apartments and channels

**Duration:** Rest of the 30 days

**Gate to continue:**
- [ ] No incident above "minor" for 7 days

**Completed:** [Date]

---

### Stage 4: Enquiries (when built)
**What is live:** Availability and price answers for strangers

**Duration:** After day 14, only if her enquiry volume justifies it

**Gate to continue:**
- [ ] Same rule as Stage 2

**Completed:** [Date]

---

## Incident Log

### Incident #1
**Date:** [Date]
**Severity:** [Minor/Major/Critical]
**Description:** [What happened]
**Impact:** [How it affected the host or guests]
**Root cause:** [Why it happened]
**Resolution:** [How it was fixed]
**Time to resolve:** [X hours]
**Kill switch used:** [Yes/No - which one]
**Host notified:** [Yes/No - when]
**Follow-up actions:** [What to prevent recurrence]

---

## Wrong Answers Log (from Phase 10a feedback feature)

### Week 1
- [ ] Wrong answer count: ___
- [ ] List: [Link to status page or details]
- [ ] Fixes applied: [Information/Prompt/Code]

### Week 2
- [ ] Wrong answer count: ___
- [ ] List: [Link to status page or details]
- [ ] Fixes applied: [Information/Prompt/Code]

### Week 3
- [ ] Wrong answer count: ___
- [ ] List: [Link to status page or details]
- [ ] Fixes applied: [Information/Prompt/Code]

### Week 4
- [ ] Wrong answer count: ___
- [ ] List: [Link to status page or details]
- [ ] Fixes applied: [Information/Prompt/Code]

---

## Summary

**Total operator time spent:** ___ hours
**Total cost to operator:** €___
**Total host time saved:** ___ hours
**Total messages handled by AI:** ___
**Total escalations:** ___
**Wrong answers:** ___
**Incidents:** ___

**Conclusion:**
- [ ] Pilot successful - proceed to paid terms
- [ ] Pilot needs extension - reason: ___________
- [ ] Pilot unsuccessful - reason: ___________

**Lessons learned:**
[Any lessons for future pilots]

**Improvements needed:**
[Any code, process, or documentation improvements]
