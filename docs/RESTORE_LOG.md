# Database Restore Log

This document logs all database restore rehearsals and actual restores. This is a **critical** document for Phase 9 hardening and Phase 10 launch readiness.

## Restore Rehearsal Requirements (Phase 9)

Before launching the pilot (Phase 10), you must:
1. Perform a full restore rehearsal on a test environment
2. Document the steps, timing, and any issues encountered
3. Verify data integrity after restore
4. Log the results in this document

## Restore Rehearsal Log

### Rehearsal #1
**Date:** [To be filled during Phase 9]
**Performed by:** [Operator name]
**Environment:** [Test/Staging]

**Backup Source:**
- Backup ID: [ID]
- Backup Date: [Date]
- Backup Size: [Size]

**Restore Steps:**
1. [Step 1 - e.g., Stopped application]
2. [Step 2 - e.g., Downloaded backup file]
3. [Step 3 - e.g., Restored to test database]
4. [Step 4 - e.g., Ran migrations]
5. [Step 5 - e.g., Ran retention job]
6. [Step 6 - e.g., Restarted application]

**Timing:**
- Total time: [X minutes]
- Database restore: [X minutes]
- Migrations: [X minutes]
- Verification: [X minutes]

**Data Verification:**
- [ ] Owner accounts intact
- [ ] Apartments and feeds present
- [ ] Recent bookings (last 30 days) present
- [ ] Message history accessible
- [ ] Scheduled messages preserved
- [ ] Opt-out hashes intact
- [ ] Usage data accurate

**Issues Encountered:**
- [None / List any issues and resolutions]

**Post-Restore Testing:**
- [ ] Login successful
- [ ] Calendar view loads
- [ ] Test message sent
- [ ] No errors in Sentry

**Conclusion:**
- [ ] PASS - Ready for launch
- [ ] FAIL - Issues must be resolved before launch

**Notes:**
[Any additional notes, lessons learned, or improvements needed]

---

## Actual Restore Log (Production Incidents)

This section is for logging actual production restores (not rehearsals). Hopefully this section remains empty.

### Restore #1
**Date:** [To be filled if needed]
**Reason:** [e.g., Data corruption, migration failure, etc.]
**Backup Used:** [Backup ID and date]

**Steps Taken:**
[Detailed steps]

**Timing:** [Total time]

**Issues:** [Any issues]

**Verification:** [Results]

**Follow-up Actions:** [What was done to prevent recurrence]

---

## Backup Retention Schedule

- Daily backups: Retained for 30 days
- Weekly backups: Retained for 12 weeks
- Monthly backups: Retained for 12 months

**Note:** Automated backups are configured via the database provider (Neon/Railway). Verify this is active before launch.

---

## Quick Reference: Restore Procedure

For detailed steps, see `docs/RUNBOOK.md` > "Restore Procedure".

**Summary:**
1. Stop application
2. Restore database from backup
3. Run migrations: `npx prisma migrate deploy`
4. Run retention job: `POST /api/cron/retention?dryRun=0`
5. Verify data integrity
6. Restart application
7. Test critical flows
8. Monitor Sentry for errors

**Critical:** Always run the retention job after restore to delete data past the retention period. Do not skip this step.
