import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { cleanupDatabase, createTestApartment, createTestBooking, createTestOwner } from "./test-helpers";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    void fn();
  },
}));
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsApp: vi.fn(async () => ({ sid: "SMtest" })),
  whatsappMode: vi.fn(() => "dry-run"),
  WhatsAppError: class extends Error {
    constructor(message: string, public code?: number) {
      super(message);
    }
  },
}));
vi.mock("@/lib/notify", () => ({
  notifyHost: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth", () => ({
  requireOwner: vi.fn(),
}));
vi.mock("@/lib/assistant", () => ({
  answerGuest: vi.fn(),
  buildHistory: vi.fn(() => []),
  fallbackOutput: vi.fn(),
  holdingText: vi.fn(() => "One moment please."),
}));

import { requireOwner } from "@/lib/auth";
import { answerGuest } from "@/lib/assistant";
import { appendToInfo } from "@/app/(app)/inbox/actions";
import { answerInbound } from "@/lib/inbound";
import { buildSystemPrompt } from "@/lib/assistant-prompt";

const HEADING = "FROM GUEST QUESTIONS";

describe("appendToInfo with PostgreSQL", () => {
  let owner: Awaited<ReturnType<typeof createTestOwner>>;
  let apartment: Awaited<ReturnType<typeof createTestApartment>>;

  beforeEach(async () => {
    await cleanupDatabase();
    vi.clearAllMocks();
    vi.stubEnv("INBOUND_DEBOUNCE_MS", "0");
    owner = await createTestOwner("append-info@example.com", {
      hostLanguage: "en",
      defaultGuestLanguage: "en",
    });
    apartment = await createTestApartment(owner.id, { info: "", publicInfo: "" });
    vi.mocked(requireOwner).mockResolvedValue(owner as never);
    vi.mocked(answerGuest).mockResolvedValue({
      language: "en",
      reply: "There is a cot available.",
      escalate: false,
      urgent: false,
      reason: "",
      hostSummary: "",
      optOut: false,
      usage: { input: 10, output: 10 },
    } as never);
  });

  it("appends under the heading once across two calls", async () => {
    const first = await appendToInfo(apartment.id, "info", "Q: cot?\nA: Yes, one cot.");
    expect(first).toEqual({ ok: true });
    const second = await appendToInfo(apartment.id, "info", "Q: parking?\nA: Street parking.");
    expect(second).toEqual({ ok: true });

    const saved = await prisma.apartment.findUniqueOrThrow({ where: { id: apartment.id } });
    expect(saved.info.match(new RegExp(HEADING, "g"))).toHaveLength(1);
    expect(saved.info).toContain("Q: cot?\nA: Yes, one cot.");
    expect(saved.info).toContain("Q: parking?\nA: Street parking.");
  });

  it("writes to publicInfo without touching private info", async () => {
    await appendToInfo(apartment.id, "info", "private note");
    const result = await appendToInfo(apartment.id, "publicInfo", "Q: wifi?\nA: Ask at check-in.");
    expect(result).toEqual({ ok: true });

    const saved = await prisma.apartment.findUniqueOrThrow({ where: { id: apartment.id } });
    expect(saved.publicInfo).toContain(HEADING);
    expect(saved.publicInfo).toContain("Q: wifi?");
    expect(saved.info).not.toContain("Q: wifi?");
    expect(saved.info).toContain("private note");
  });

  it("rejects empty text and text over 2000 characters", async () => {
    expect(await appendToInfo(apartment.id, "info", "   ")).toEqual({ error: "Nothing to save." });
    const long = "x".repeat(2001);
    expect(await appendToInfo(apartment.id, "info", long)).toEqual({
      error: "Keep it under 2000 characters.",
    });
    const saved = await prisma.apartment.findUniqueOrThrow({ where: { id: apartment.id } });
    expect(saved.info).toBe("");
  });

  it("enforces the 20000-character private info limit", async () => {
    const filler = "a".repeat(19990);
    await prisma.apartment.update({ where: { id: apartment.id }, data: { info: filler } });
    const result = await appendToInfo(apartment.id, "info", "Q: a?\nA: b");
    expect(result).toEqual({ error: "The information is full. Shorten it first." });
  });

  it("enforces the 10000-character public info limit", async () => {
    const filler = "b".repeat(9980);
    await prisma.apartment.update({ where: { id: apartment.id }, data: { publicInfo: filler } });
    const result = await appendToInfo(apartment.id, "publicInfo", "Q: a?\nA: b");
    expect(result).toEqual({ error: "The information is full. Shorten it first." });
  });

  it("returns notFound for another owner's apartment", async () => {
    const other = await createTestOwner("append-info-other@example.com");
    const otherApt = await createTestApartment(other.id);

    await expect(appendToInfo(otherApt.id, "info", "Q: x\nA: y")).rejects.toThrow("NEXT_NOT_FOUND");
    const unchanged = await prisma.apartment.findUniqueOrThrow({ where: { id: otherApt.id } });
    expect(unchanged.info).toBe("");
  });

  it("feeds the saved answer into the next answerInbound call's allowedText and prompt", async () => {
    await appendToInfo(apartment.id, "info", "Q: Is there a baby cot?\nA: Yes, one cot is available.");

    const booking = await createTestBooking(apartment.id, {
      guestPhone: "+35699111222",
      guestName: "Cot Guest",
      checkIn: new Date(Date.now() - 2 * 86_400_000),
      checkOut: new Date(Date.now() + 2 * 86_400_000),
    });
    const inbound = await prisma.message.create({
      data: {
        bookingId: booking.id,
        direction: "INBOUND",
        author: "GUEST",
        body: "Is there a baby cot for our stay?",
        hasMedia: false,
      },
    });
    const fresh = await prisma.apartment.findUniqueOrThrow({ where: { id: apartment.id } });
    const freshBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });

    await answerInbound({
      owner: {
        id: owner.id,
        email: owner.email,
        hostLanguage: owner.hostLanguage,
        defaultGuestLanguage: owner.defaultGuestLanguage,
      },
      booking: freshBooking,
      apartment: fresh,
      inbound,
      from: "+35699111222",
      now: new Date(),
    });

    expect(answerGuest).toHaveBeenCalledOnce();
    const input = vi.mocked(answerGuest).mock.calls[0][0];
    expect(input.allowedText).toContain("Q: Is there a baby cot?");
    expect(input.allowedText).toContain("Yes, one cot is available.");

    const prompt = buildSystemPrompt({
      hostLanguage: owner.hostLanguage,
      apartment: fresh,
      booking: freshBooking,
      unlocked: true,
      today: "2026-11-19",
      knownLanguage: "en",
    });
    expect(prompt).toContain("Q: Is there a baby cot?");
    expect(prompt).toContain("Yes, one cot is available.");
  });
});
