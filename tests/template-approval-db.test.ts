import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { handleMetaPayload } from "@/lib/meta-webhook";
import { pickTranslation } from "@/lib/message-render";
import { sendDueMessages } from "@/lib/send-scheduled";
import { submitTranslation, syncApprovals, updateTranslationText } from "@/lib/template-approval";
import { hashSource } from "@/lib/templates";
import { cleanupDatabase } from "./test-helpers";

vi.mock("@/lib/inbound", () => ({
  processInbound: vi.fn(),
}));

describe("Meta template approval with PostgreSQL", () => {
  let ownerId: string;
  let templateId: string;
  let translationId: string;
  const fetchMock = vi.fn();

  beforeEach(async () => {
    await cleanupDatabase();
    vi.stubEnv("WHATSAPP_MODE", "production");
    vi.stubEnv("META_API_VERSION", "v22.0");
    vi.stubEnv("META_ACCESS_TOKEN", "test-access-token");
    vi.stubEnv("META_WABA_ID", "waba-test");
    vi.stubEnv("META_PHONE_NUMBER_ID", "phone-number-test");
    vi.stubEnv("META_SANDBOX_ALLOWED_NUMBERS", "+35679123456");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();

    const owner = await prisma.owner.create({
      data: { email: "template-test@example.com", passwordHash: "test-hash" },
    });
    ownerId = owner.id;
    const template = await prisma.messageTemplate.create({
      data: {
        ownerId,
        type: "PRE_ARRIVAL",
        body: "Hello {{guestName}}, welcome to {{apartmentName}}.",
      },
    });
    templateId = template.id;
    const translation = await prisma.templateTranslation.create({
      data: {
        templateId,
        language: "de",
        body: "Hallo {{guestName}}, willkommen in {{apartmentName}}.",
        sourceHash: "source-hash",
      },
    });
    translationId = translation.id;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("submits a versioned Meta template with locale, category, numbered body and examples", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ id: "meta-template-1", category: "UTILITY" }),
    );

    await submitTranslation(translationId, ownerId);

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v22.0/waba-test/message_templates");
    expect(request.method).toBe("POST");
    const payload = JSON.parse(String(request.body));
    expect(payload).toMatchObject({
      language: "de",
      category: "UTILITY",
      components: [
        {
          type: "BODY",
          text: "Hallo {{1}}, willkommen in {{2}}.",
          example: { body_text: [["Anna", "Seaview Apartment"]] },
        },
      ],
    });
    expect(payload.name).toMatch(/^ostra_pre_arrival_de_[a-f0-9]{8}$/);
    expect(request.headers).toMatchObject({
      Authorization: "Bearer test-access-token",
    });

    const saved = await prisma.templateTranslation.findUniqueOrThrow({
      where: { id: translationId },
    });
    expect(saved).toMatchObject({
      metaTemplateId: "meta-template-1",
      metaTemplateName: payload.name,
      metaCategory: "UTILITY",
      approval: "PENDING",
    });
  });

  it("maps Portuguese to Meta's pt_PT locale", async () => {
    const portuguese = await prisma.templateTranslation.create({
      data: {
        templateId,
        language: "pt",
        body: "Olá {{guestName}}, bem-vindo.",
        sourceHash: "source-hash",
      },
    });
    fetchMock.mockResolvedValue(Response.json({ id: "meta-template-pt", category: "UTILITY" }));

    await submitTranslation(portuguese.id, ownerId);

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      language: "pt_PT",
    });
  });

  it("does not submit a translation belonging to another owner", async () => {
    const otherOwner = await prisma.owner.create({
      data: { email: "other-template-test@example.com", passwordHash: "test-hash" },
    });

    await expect(submitTranslation(translationId, otherOwner.id)).rejects.toThrow(
      "Translation not found",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("applies template approval webhook status and Meta-assigned category", async () => {
    await prisma.templateTranslation.update({
      where: { id: translationId },
      data: { metaTemplateId: "meta-template-1", metaTemplateName: "ostra_template_de_12345678", approval: "PENDING" },
    });

    await handleMetaPayload({
      entry: [
        {
          changes: [
            {
              field: "message_template_status_update",
              value: {
                message_template_id: "meta-template-1",
                message_template_name: "ostra_template_de_12345678",
                message_template_language: "de",
                event_type: "APPROVED",
                status: "APPROVED",
                category: "MARKETING",
              },
            },
          ],
        },
      ],
    });

    const saved = await prisma.templateTranslation.findUniqueOrThrow({
      where: { id: translationId },
    });
    expect(saved.approval).toBe("APPROVED");
    expect(saved.metaCategory).toBe("MARKETING");
  });

  it("reconciles missed approvals and treats paused templates as not approved", async () => {
    await prisma.templateTranslation.update({
      where: { id: translationId },
      data: {
        metaTemplateId: "meta-template-1",
        metaTemplateName: "ostra_template_de_12345678",
        approval: "PENDING",
      },
    });
    fetchMock.mockResolvedValue(
      Response.json({
        data: [
          {
            id: "meta-template-1",
            name: "ostra_template_de_12345678",
            status: "PAUSED",
            language: "de",
            category: "MARKETING",
          },
        ],
      }),
    );

    await syncApprovals(ownerId);

    const saved = await prisma.templateTranslation.findUniqueOrThrow({
      where: { id: translationId },
    });
    expect(saved.approval).toBe("NONE");
    expect(saved.metaCategory).toBe("MARKETING");
  });

  it("preserves the approved Meta version when a host edits a translation", async () => {
    const approved = await prisma.templateTranslation.update({
      where: { id: translationId },
      data: {
        metaTemplateId: "meta-template-old",
        metaTemplateName: "ostra_pre_arrival_de_oldhash",
        metaCategory: "UTILITY",
        approval: "APPROVED",
      },
    });

    fetchMock.mockResolvedValue(
      Response.json({ id: "meta-template-new", category: "UTILITY" }),
    );
    await updateTranslationText(
      translationId,
      ownerId,
      "Guten Tag {{guestName}}, willkommen.",
    );

    let versions = await prisma.templateTranslation.findMany({
      where: { templateId, language: "de" },
      orderBy: { revision: "desc" },
    });
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({
      body: "Guten Tag {{guestName}}, willkommen.",
      sourceHash: hashSource("Hello {{guestName}}, welcome to {{apartmentName}}."),
      editedByHost: true,
      approval: "NONE",
      metaTemplateName: null,
    });
    await submitTranslation(versions[0].id, ownerId);
    versions = await prisma.templateTranslation.findMany({
      where: { templateId, language: "de" },
      orderBy: { revision: "desc" },
    });
    expect(versions[1]).toMatchObject({
      id: approved.id,
      approval: "APPROVED",
      metaTemplateName: "ostra_pre_arrival_de_oldhash",
    });
    expect(versions[0].metaTemplateName).not.toBe(versions[1].metaTemplateName);
    expect(pickTranslation(versions, "de", "en", "production")?.translation.body).toBe(approved.body);
  });

  it("does not send a Meta template after the status has been paused", async () => {
    const apartment = await prisma.apartment.create({
      data: {
        ownerId,
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
        checkIn: new Date("2026-03-12T12:00:00.000Z"),
        checkOut: new Date("2026-03-15T09:00:00.000Z"),
        guestPhone: "+35679123456",
        optedInAt: new Date("2026-03-01T10:00:00.000Z"),
      },
    });
    await prisma.templateTranslation.update({
      where: { id: translationId },
      data: {
        approval: "NONE",
        metaTemplateName: "ostra_pre_arrival_de_paused",
        metaCategory: "UTILITY",
      },
    });
    await prisma.scheduledMessage.create({
      data: {
        bookingId: booking.id,
        type: "PRE_ARRIVAL",
        sendAt: new Date("2026-03-10T10:00:00.000Z"),
        status: "PENDING",
      },
    });
    vi.stubEnv("WHATSAPP_MODE", "production");

    await sendDueMessages(new Date("2026-03-10T10:00:00.000Z"));

    expect(fetchMock).not.toHaveBeenCalled();
    const scheduled = await prisma.scheduledMessage.findFirstOrThrow({
      where: { bookingId: booking.id, type: "PRE_ARRIVAL" },
    });
    expect(scheduled.status).toBe("SKIPPED");
    expect(scheduled.skipReason).toContain("No approved template");
  });
});
