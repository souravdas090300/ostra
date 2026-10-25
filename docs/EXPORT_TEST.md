# Calendar Export Loop Test

This test verifies that a platform does not re-export imported calendars as reservation-like events, which would create a feedback loop.

## Purpose

Some platforms may import an iCal feed and then re-export it, potentially creating a loop where:
1. Ostra exports bookings to Airbnb/Booking.com
2. The platform imports them and treats them as new events
3. Ostra imports those new events back
4. The cycle repeats, creating duplicate bookings or blocks

This test must pass before enabling the export link for each platform.

## Test Procedure

Run this test per platform (Airbnb, then Booking.com) in staging or on a quiet future date range.

### Step 1: Create a test booking

1. Pick one apartment and a date range far in the future (at least 3 months out) that is free on all platforms.
2. In Ostra, create a direct booking for those dates:
   - Guest name: "TEST"
   - No phone number
   - Source: DIRECT
   - Status: CONFIRMED

### Step 2: Enable and add the export link

1. In Ostra, enable only the target platform's export link (e.g., Airbnb).
2. Copy the export link from Ostra.
3. In the platform (e.g., Airbnb calendar settings), add the link as an imported calendar.
4. Name it "Ostra test" or similar.

### Step 3: Wait for platform to read the link

Wait until the platform shows the dates as blocked/unavailable. This can take hours. Record:
- Date and time when the link was added
- Date and time when the platform first showed the dates blocked
- Refresh time observed (how long it took)

### Step 4: Verify no loop

After the platform has blocked the dates:

1. Trigger Ostra's next sync for that platform (or wait for the cron job).
2. Check in Ostra:
   - The dates should arrive as a **block** (e.g., Airbnb's "Not available" wording), not a new booking.
   - No new booking should appear.
   - No double-booking alert should appear.
3. Open the Ostra export link directly in a browser and count the events:
   - The number of events should be the same as before the sync.
   - No new events should have been added.

If the platform re-exports imports as reservation-like events, the export content will grow and bookings will be created instead of blocks. In this case, **do not enable the link** for that platform.

### Step 5: Cancel the test booking

1. In Ostra, cancel the test booking.
2. Wait for the platform's next sync (or trigger it manually).
3. Verify:
   - The platform removes the block (this may take hours; record the time).
   - Ostra's next sync cancels the block.
4. Open the Ostra export link and verify the event is gone.

### Step 6: Repeat for the other platform

Repeat steps 1-5 for Booking.com, with one additional check at step 3:

**For Booking.com only:** After Booking.com has imported the link, check Booking.com's own calendar export feed (the one Ostra reads from). It must not contain events for the test dates that did not exist before. If Booking.com re-exports imports, do not enable the Booking.com link.

## Test Log

Record each test run here:

| Date | Apartment | Platform | Result | Refresh Time Observed | Notes |
|------|-----------|----------|--------|----------------------|-------|
| | | | | | |
| | | | | | |
| | | | | | |

## Decision Criteria

- **Pass:** The platform imports the dates as blocks only, does not re-export them, and the export content remains stable. Enable the link for production.
- **Fail:** The platform re-exports imports as reservation-like events, creating new bookings in Ostra. Do not enable the link; keep blocking dates by hand or use a channel manager.

## Post-Test Actions

If the test passes:

1. Enable the link for the test apartment in production.
2. Monitor for one week for any unexpected behavior.
3. If no issues, enable the link for the remaining apartments one at a time, waiting a few days between each.

If the test fails:

1. Do not enable the export link for that platform.
2. Continue blocking dates manually on that platform.
3. Consider using a channel manager that handles cross-platform synchronization.

## Reference

- See Phase 11 of OSTRA_PLAN.md for implementation details.
- See docs/RUNBOOK.md for operational procedures.
