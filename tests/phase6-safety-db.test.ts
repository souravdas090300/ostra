import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { hashPhone } from "@/lib/hash";
import { optOutPhone, phoneIsOptedOut } from "@/lib/optout";
import { sendDueMessages } from "@/lib/send-scheduled";
import { cleanupDatabase } from "./test-helpers";

const SEND_NOW = new Date("2026-11-03T10:00:00.000Z");
const GUEST_PHONE = "+35679123456";

async function createEligibleBooking() {
  const owner = await prisma.owner.create({
    data: { email: "phase6-safety@example.com", passwordHash: "test-hash" },
  });
  const apartment = await prisma.apartment.create({
    data: {
      ownerId: owner.id,
      name: "Test apartment",
      address: "Test address",
      checkInTime: "14:00",
      checkOutTime: "11:00",
    },
  });
  const booking = await prisma.booking.create({
    data: {
      apartmentId: apartment.id,
      source: "DIRECT",
      status: "CONFIRMED",
      checkIn: new Date("2026-11-10T14:00:00.000Z"),
      checkOut: new Date("2026-11-14T11:00:00.000Z"),
      guestPhone: GUEST_PHONE,
      optedInAt: new Date("2026-11-01T10:00:00.000Z"),
    },
  });
  return { owner, apartment, booking };
}

describe("Phase 6 safety behavior with PostgreSQL", () => {
  beforeEach(async () => {
    await cleanupDatabase();
    vi.stubEnv("WHATSAPP_MODE", "dry-run");
    vi.stubEnv("AUTOMATIC_MESSAGES_ENABLED", "true");
    vi.stubEnv("MAX_TEMPLATE_SENDS_PER_DAY", "1000");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stores the booking opt-out and a hashed phone row", async () => {
    const { owner, booking } = await createEligibleBooking();

    await optOutPhone(owner.id, GUEST_PHONE);

    const updatedBooking = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
    });
    const phoneHash = hashPhone(GUEST_PHONE);
    const hashRow = await prisma.optOut.findUnique({
      where: { ownerId_phoneHash: { ownerId: owner.id, phoneHash } },
    });
    expect(updatedBooking.optedOutAt).toBeInstanceOf(Date);
    expect(hashRow).toMatchObject({ ownerId: owner.id, phoneHash });
    expect(await phoneIsOptedOut(owner.id, GUEST_PHONE)).toBe(true);
  });

  it("marks stale SENDING rows failed without retrying them", async () => {
    const { booking } = await createEligibleBooking();
    const scheduled = await prisma.scheduledMessage.create({
      data: {
        bookingId: booking.id,
        type: "PRE_ARRIVAL",
        sendAt: new Date("2026-11-03T09:00:00.000Z"),
        status: "SENDING",
        claimedAt: new Date(SEND_NOW.getTime() - 20 * 60_000),
      },
    });

    const summary = await sendDueMessages(SEND_NOW);

    const updated = await prisma.scheduledMessage.findUniqueOrThrow({
      where: { id: scheduled.id },
    });
    expect(summary).toEqual({ claimed: 0, sent: 0, skipped: 0, failed: 0, retried: 0 });
    expect(updated.status).toBe("FAILED");
    expect(updated.lastError).toContain("Unclear whether this was sent");
  });

  it("reads the automatic-messaging kill switch at each call", async () => {
    const { owner, booking } = await createEligibleBooking();
    const template = await prisma.messageTemplate.create({
      data: {
        ownerId: owner.id,
        type: "PRE_ARRIVAL",
        body: "Hello {{guestName}}.",
      },
    });
    await prisma.templateTranslation.create({
      data: {
        templateId: template.id,
        language: owner.defaultGuestLanguage,
        body: template.body,
        sourceHash: "test-source",
      },
    });
    const scheduled = await prisma.scheduledMessage.create({
      data: {
        bookingId: booking.id,
        type: "PRE_ARRIVAL",
        sendAt: new Date("2026-11-03T09:00:00.000Z"),
      },
    });

    vi.stubEnv("AUTOMATIC_MESSAGES_ENABLED", "false");
    const disabled = await sendDueMessages(SEND_NOW);
    expect(disabled.claimed).toBe(0);
    expect(
      (await prisma.scheduledMessage.findUniqueOrThrow({ where: { id: scheduled.id } })).status,
    ).toBe("PENDING");

    vi.stubEnv("AUTOMATIC_MESSAGES_ENABLED", "true");
    const enabled = await sendDueMessages(SEND_NOW);
    expect(enabled.sent).toBe(1);
    expect(
      (await prisma.scheduledMessage.findUniqueOrThrow({ where: { id: scheduled.id } })).status,
    ).toBe("SENT");
  });

  it("uses the migrated JobLease table through the Prisma model", async () => {
    const lease = await prisma.jobLease.create({
      data: { job: "integration-test-job", leasedUntil: SEND_NOW },
    });

    expect(await prisma.jobLease.findUnique({ where: { job: lease.job } })).toMatchObject({
      job: "integration-test-job",
      leasedUntil: SEND_NOW,
    });
  });
});
