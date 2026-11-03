import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { cleanupDatabase } from "./test-helpers";

vi.mock("@/lib/auth", () => ({
  requireOwner: vi.fn(),
}));
vi.mock("@/lib/translate", () => ({
  translateTemplate: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { requireOwner } from "@/lib/auth";
import { translateTemplate } from "@/lib/translate";
import {
  addTranslationAction,
  editTranslationAction,
  refreshApprovalsAction,
  regenerateTranslationAction,
  removeTranslationAction,
  saveTemplateAction,
  submitForApprovalAction,
  setEnquiriesEnabledAction,
  updateFallbackLanguageAction,
} from "@/app/(app)/settings/messages/actions";

describe("message settings server actions with PostgreSQL", () => {
  let ownerId: string;
  let templateId: string;
  let hostTranslationId: string;
  let germanTranslationId: string;
  const fetchMock = vi.fn();

  const form = (values: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(values)) data.set(key, value);
    return data;
  };

  beforeEach(async () => {
    await cleanupDatabase();
    vi.clearAllMocks();
    vi.stubEnv("WHATSAPP_MODE", "production");
    vi.stubEnv("META_API_VERSION", "v22.0");
    vi.stubEnv("META_ACCESS_TOKEN", "test-access-token");
    vi.stubEnv("META_WABA_ID", "waba-test");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    vi.mocked(translateTemplate).mockResolvedValue(
      "Hallo {{guestName}}, willkommen in {{apartmentName}}.",
    );

    const owner = await prisma.owner.create({
      data: { email: "settings-actions@example.com", passwordHash: "test-hash" },
    });
    ownerId = owner.id;
    vi.mocked(requireOwner).mockResolvedValue({
      id: owner.id,
      hostLanguage: owner.hostLanguage,
    } as Awaited<ReturnType<typeof requireOwner>>);

    const template = await prisma.messageTemplate.create({
      data: {
        ownerId,
        type: "PRE_ARRIVAL",
        body: "Hello {{guestName}}, welcome to {{apartmentName}}.",
      },
    });
    templateId = template.id;
    const hostTranslation = await prisma.templateTranslation.create({
      data: {
        templateId,
        language: "en",
        body: template.body,
        sourceHash: "host-source",
      },
    });
    hostTranslationId = hostTranslation.id;
    const germanTranslation = await prisma.templateTranslation.create({
      data: {
        templateId,
        language: "de",
        body: "Hallo {{guestName}}, willkommen in {{apartmentName}}.",
        sourceHash: "host-source",
      },
    });
    germanTranslationId = germanTranslation.id;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("saves the host template text and enabled toggle", async () => {
    const result = await saveTemplateAction(
      undefined,
      form({
        templateId,
        body: "Welcome {{guestName}} to {{apartmentName}}.",
        enabled: "false",
      }),
    );

    expect(result).toEqual({ ok: true });
    const template = await prisma.messageTemplate.findUniqueOrThrow({ where: { id: templateId } });
    expect(template.body).toBe("Welcome {{guestName}} to {{apartmentName}}.");
    expect(template.enabled).toBe(false);
    const latestHost = await prisma.templateTranslation.findFirstOrThrow({
      where: { templateId, language: "en" },
      orderBy: { revision: "desc" },
    });
    expect(latestHost.body).toBe(template.body);
    expect(latestHost.approval).toBe("NONE");
  });

  it("validates and scopes the host template save to the signed-in owner", async () => {
    const otherOwner = await prisma.owner.create({
      data: { email: "other-settings@example.com", passwordHash: "test-hash" },
    });
    vi.mocked(requireOwner).mockResolvedValue({
      id: otherOwner.id,
      hostLanguage: otherOwner.hostLanguage,
    } as Awaited<ReturnType<typeof requireOwner>>);

    const result = await saveTemplateAction(
      undefined,
      form({ templateId, body: "Hello {{unknown}}", enabled: "true" }),
    );

    expect(result?.error).toBe("Template not found.");
    const template = await prisma.messageTemplate.findUniqueOrThrow({ where: { id: templateId } });
    expect(template.body).toBe("Hello {{guestName}}, welcome to {{apartmentName}}.");
  });

  it("adds a translated language", async () => {
    const result = await addTranslationAction(
      undefined,
      form({ templateId, language: "fr" }),
    );

    expect(result).toEqual({ ok: true });
    const translation = await prisma.templateTranslation.findFirstOrThrow({
      where: { templateId, language: "fr" },
    });
    expect(translation.editedByHost).toBe(false);
    expect(translateTemplate).toHaveBeenCalledOnce();
  });

  it("edits a translation by creating a host-edited version", async () => {
    const result = await editTranslationAction(
      undefined,
      form({ translationId: germanTranslationId, body: "Guten Tag {{guestName}}." }),
    );

    expect(result).toEqual({ ok: true });
    const latest = await prisma.templateTranslation.findFirstOrThrow({
      where: { templateId, language: "de" },
      orderBy: { revision: "desc" },
    });
    expect(latest).toMatchObject({
      body: "Guten Tag {{guestName}}.",
      editedByHost: true,
      approval: "NONE",
    });
  });

  it("regenerates an unedited translation", async () => {
    const result = await regenerateTranslationAction(
      undefined,
      form({ templateId, language: "de" }),
    );

    expect(result).toEqual({ ok: true });
    const latest = await prisma.templateTranslation.findFirstOrThrow({
      where: { templateId, language: "de" },
      orderBy: { revision: "desc" },
    });
    expect(latest.body).toBe("Hallo {{guestName}}, willkommen in {{apartmentName}}.");
  });

  it("submits a translation for Meta approval", async () => {
    fetchMock.mockResolvedValue(Response.json({ id: "meta-template", category: "UTILITY" }));

    const result = await submitForApprovalAction(
      undefined,
      form({ translationId: germanTranslationId }),
    );

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    const saved = await prisma.templateTranslation.findUniqueOrThrow({
      where: { id: germanTranslationId },
    });
    expect(saved.approval).toBe("PENDING");
  });

  it("refreshes this owner's Meta approval status", async () => {
    const otherOwner = await prisma.owner.create({
      data: { email: "other-refresh@example.com", passwordHash: "test-hash" },
    });
    const otherTemplate = await prisma.messageTemplate.create({
      data: {
        ownerId: otherOwner.id,
        type: "PRE_ARRIVAL",
        body: "Hello {{guestName}}.",
      },
    });
    const otherTranslation = await prisma.templateTranslation.create({
      data: {
        templateId: otherTemplate.id,
        language: "de",
        body: "Hallo {{guestName}}.",
        sourceHash: "other-source",
        metaTemplateId: "meta-template-other",
        metaTemplateName: "ostra_other_de_12345678",
        approval: "PENDING",
      },
    });
    await prisma.templateTranslation.update({
      where: { id: germanTranslationId },
      data: {
        metaTemplateId: "meta-template-de",
        metaTemplateName: "ostra_pre_arrival_de_12345678",
        approval: "PENDING",
      },
    });
    fetchMock.mockResolvedValue(Response.json({
      data: [{
        id: "meta-template-de",
        name: "ostra_pre_arrival_de_12345678",
        status: "APPROVED",
        language: "de",
        category: "UTILITY",
      }, {
        id: "meta-template-other",
        name: "ostra_other_de_12345678",
        status: "APPROVED",
        language: "de",
        category: "UTILITY",
      }],
    }));

    const result = await refreshApprovalsAction(undefined, new FormData());

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    const updated = await prisma.templateTranslation.findUniqueOrThrow({
      where: { id: germanTranslationId },
    });
    expect(updated.approval).toBe("APPROVED");
    const foreign = await prisma.templateTranslation.findUniqueOrThrow({
      where: { id: otherTranslation.id },
    });
    expect(foreign.approval).toBe("PENDING");
  });

  it("removes a non-host translation", async () => {
    const result = await removeTranslationAction(
      undefined,
      form({ translationId: germanTranslationId }),
    );

    expect(result).toEqual({ ok: true });
    expect(
      await prisma.templateTranslation.findUnique({ where: { id: germanTranslationId } }),
    ).toBeNull();
    expect(
      await prisma.templateTranslation.findUnique({ where: { id: hostTranslationId } }),
    ).not.toBeNull();
  });

  it("updates the fallback language", async () => {
    const result = await updateFallbackLanguageAction(
      undefined,
      form({ fallbackLanguage: "pt" }),
    );

    expect(result).toEqual({ ok: true });
    const owner = await prisma.owner.findUniqueOrThrow({ where: { id: ownerId } });
    expect(owner.fallbackLanguage).toBe("pt");
  });

  it("toggles enquiries for the signed-in owner", async () => {
    const otherOwner = await prisma.owner.create({
      data: { email: "other-enquiries@example.com", passwordHash: "test-hash" },
    });
    vi.mocked(requireOwner).mockResolvedValue({
      id: otherOwner.id,
      hostLanguage: otherOwner.hostLanguage,
    } as Awaited<ReturnType<typeof requireOwner>>);

    const result = await setEnquiriesEnabledAction(undefined, form({ enabled: "true" }));

    expect(result).toEqual({ ok: true });
    const owner = await prisma.owner.findUniqueOrThrow({ where: { id: ownerId } });
    const signedInOwner = await prisma.owner.findUniqueOrThrow({ where: { id: otherOwner.id } });
    expect(owner.enquiriesEnabled).toBe(false);
    expect(signedInOwner.enquiriesEnabled).toBe(true);
  });
});
