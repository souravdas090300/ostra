import { z } from "zod";
import { prisma } from "./db";
import {
  hashSource,
  metaTemplateLocale,
  TEMPLATE_CATEGORY,
  toMetaBody,
  validateTemplate,
  type MessageType,
} from "./templates";
import { whatsappMode } from "./whatsapp";

const SAMPLE: Record<string, string> = {
  guestName: "Anna",
  apartmentName: "Seaview Apartment",
  checkInDate: "10 January 2026",
  checkInTime: "14:00",
  checkOutTime: "11:00",
  reviewUrl: "https://example.com/review",
};

const graphTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  language: z.string(),
  category: z.string().optional(),
  rejected_reason: z.string().optional(),
}).passthrough();
const graphTemplatesPageSchema = z.object({
  data: z.array(graphTemplateSchema),
  paging: z.object({
    next: z.string().optional(),
    cursors: z.object({ after: z.string().optional() }).optional(),
  }).optional(),
});

type GraphTemplate = z.infer<typeof graphTemplateSchema>;
type GraphConfig = { apiVersion: string; accessToken: string; wabaId: string };

export class TemplateApprovalError extends Error {}

function graphConfig(): GraphConfig {
  const { META_API_VERSION: apiVersion, META_ACCESS_TOKEN: accessToken, META_WABA_ID: wabaId } = process.env;
  if (!apiVersion || !/^v\d+\.\d+$/.test(apiVersion) || !accessToken || !wabaId) {
    throw new TemplateApprovalError(
      "Configure META_API_VERSION, META_ACCESS_TOKEN and META_WABA_ID before managing templates.",
    );
  }
  return { apiVersion, accessToken, wabaId };
}

function graphUrl(config: GraphConfig, path: string): string {
  return `https://graph.facebook.com/${config.apiVersion}/${path}`;
}

function graphHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
}

async function readGraphError(response: Response): Promise<{ code?: number; message?: string }> {
  const body = await response.json().catch(() => undefined) as
    | { error?: { code?: unknown; message?: unknown; error_user_msg?: unknown } }
    | undefined;
  const code = body?.error?.code;
  const message =
    typeof body?.error?.error_user_msg === "string"
      ? body.error.error_user_msg
      : typeof body?.error?.message === "string"
        ? body.error.message
        : undefined;
  return { code: typeof code === "number" ? code : undefined, message };
}

function languageNotSupported(error: { code?: number; message?: string }): boolean {
  return error.code === 100 && /language|locale/i.test(error.message ?? "");
}

export async function submitTranslation(translationId: string, ownerId: string): Promise<void> {
  if (whatsappMode() === "dry-run") {
    throw new TemplateApprovalError("Connect your WhatsApp sender first by selecting sandbox or production mode.");
  }

  const translation = await prisma.templateTranslation.findFirst({
    where: { id: translationId, template: { ownerId } },
    include: { template: true },
  });
  if (!translation) throw new TemplateApprovalError("Translation not found.");
  if (translation.metaTemplateName) {
    throw new TemplateApprovalError("This translation version has already been submitted to Meta.");
  }

  const type = translation.template.type as MessageType;
  const validationErrors = validateTemplate(type, translation.body);
  if (validationErrors.length) throw new TemplateApprovalError(validationErrors.join(" "));

  const config = graphConfig();
  const locale = metaTemplateLocale(translation.language);
  const category = TEMPLATE_CATEGORY[type];
  const nameParts = [
    "ostra",
    type.toLowerCase(),
    locale.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
    hashSource(`${ownerId}:${translation.templateId}:${translation.language}:${translation.body}:${translation.id}`).slice(0, 8),
  ];
  const name = nameParts.join("_");
  const { body, order: variableOrder } = toMetaBody(translation.body);
  const components = [{
    type: "BODY",
    text: body,
    ...(variableOrder.length
      ? { example: { body_text: [variableOrder.map((variable) => SAMPLE[variable] ?? "Example")] } }
      : {}),
  }];

  let response: Response;
  try {
    response = await fetch(graphUrl(config, `${config.wabaId}/message_templates`), {
      method: "POST",
      headers: graphHeaders(config.accessToken),
      body: JSON.stringify({ name, language: locale, category, components }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new TemplateApprovalError("Could not connect to Meta to submit the template. Try again.");
  }

  if (!response.ok) {
    const graphError = await readGraphError(response);
    if (languageNotSupported(graphError)) {
      const reason = "Meta does not support this template language.";
      await prisma.templateTranslation.update({
        where: { id: translation.id },
        data: { approval: "REJECTED", rejectionReason: reason },
      });
      throw new TemplateApprovalError(reason);
    }
    throw new TemplateApprovalError(`Meta rejected the template request (HTTP ${response.status}).`);
  }

  const result = z.object({ id: z.string(), category: z.string().optional() }).safeParse(await response.json());
  if (!result.success) throw new TemplateApprovalError("Meta returned an invalid template response.");
  await prisma.templateTranslation.update({
    where: { id: translation.id },
    data: {
      metaTemplateName: name,
      metaTemplateId: result.data.id,
      metaCategory: result.data.category ?? category,
      approval: "PENDING",
      rejectionReason: null,
    },
  });
}

async function listMetaTemplates(config: GraphConfig): Promise<GraphTemplate[]> {
  const templates: GraphTemplate[] = [];
  let after: string | undefined;
  let hasNext = true;
  while (hasNext) {
    const url = new URL(graphUrl(config, `${config.wabaId}/message_templates`));
    url.searchParams.set("fields", "name,status,language,category,id,rejected_reason");
    if (after) url.searchParams.set("after", after);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: graphHeaders(config.accessToken),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new TemplateApprovalError("Could not connect to Meta to refresh template status.");
    }
    if (!response.ok) {
      throw new TemplateApprovalError(`Meta template status refresh failed (HTTP ${response.status}).`);
    }

    const page = graphTemplatesPageSchema.safeParse(await response.json());
    if (!page.success) throw new TemplateApprovalError("Meta returned an invalid template status response.");
    templates.push(...page.data.data);
    hasNext = Boolean(page.data.paging?.next);
    after = page.data.paging?.cursors?.after;
    if (hasNext && !after) throw new TemplateApprovalError("Meta returned an invalid template pagination cursor.");
  }
  return templates;
}

function findMetaTemplate(
  translation: { metaTemplateId: string | null; metaTemplateName: string | null; language: string },
  metaTemplates: GraphTemplate[],
): GraphTemplate | undefined {
  if (translation.metaTemplateId) {
    const byId = metaTemplates.find((template) => template.id === translation.metaTemplateId);
    if (byId) return byId;
  }
  if (!translation.metaTemplateName) return undefined;
  const locale = metaTemplateLocale(translation.language);
  return metaTemplates.find(
    (template) =>
      template.name === translation.metaTemplateName &&
      template.language.toLowerCase() === locale.toLowerCase(),
  );
}

function approvalFromMeta(status: string): {
  approval: "APPROVED" | "REJECTED" | "PENDING" | "NONE";
  rejectionReason: string | null;
} {
  switch (status.toUpperCase()) {
    case "APPROVED":
      return { approval: "APPROVED", rejectionReason: null };
    case "REJECTED":
      return { approval: "REJECTED", rejectionReason: "Rejected by Meta" };
    case "PAUSED":
    case "DISABLED":
      return { approval: "NONE", rejectionReason: `Template is ${status.toLowerCase()} by Meta.` };
    default:
      return { approval: "PENDING", rejectionReason: null };
  }
}

export async function syncApprovals(ownerId?: string): Promise<{ updated: number }> {
  if (whatsappMode() === "dry-run") return { updated: 0 };

  const config = graphConfig();
  const where = {
    metaTemplateName: { not: null },
    ...(ownerId ? { template: { ownerId } } : {}),
  };
  const translations = await prisma.templateTranslation.findMany({
    where,
    select: {
      id: true,
      metaTemplateId: true,
      metaTemplateName: true,
      metaCategory: true,
      language: true,
      approval: true,
      rejectionReason: true,
    },
  });
  if (translations.length === 0) return { updated: 0 };

  const metaTemplates = await listMetaTemplates(config);
  let updated = 0;
  for (const translation of translations) {
    const meta = findMetaTemplate(translation, metaTemplates);
    if (!meta) continue;
    const next = approvalFromMeta(meta.status);
    const metaCategory = meta.category ?? translation.metaCategory;
    if (
      next.approval === translation.approval &&
      next.rejectionReason === translation.rejectionReason &&
      metaCategory === translation.metaCategory
    ) {
      continue;
    }
    await prisma.templateTranslation.update({
      where: { id: translation.id },
      data: {
        approval: next.approval,
        rejectionReason:
          meta.status.toUpperCase() === "REJECTED"
            ? meta.rejected_reason ?? next.rejectionReason
            : next.rejectionReason,
        metaCategory,
      },
    });
    updated++;
  }
  return { updated };
}

export async function updateTranslationText(
  translationId: string,
  ownerId: string,
  newBody: string,
): Promise<void> {
  const translation = await prisma.templateTranslation.findFirst({
    where: { id: translationId, template: { ownerId } },
    include: { template: true },
  });
  if (!translation) throw new TemplateApprovalError("Translation not found.");

  const errors = validateTemplate(translation.template.type as MessageType, newBody);
  if (errors.length) throw new TemplateApprovalError(errors.join(" "));
  await prisma.$transaction(async (tx) => {
    const latest = await tx.templateTranslation.findFirst({
      where: { templateId: translation.templateId, language: translation.language },
      orderBy: { revision: "desc" },
      select: { id: true, revision: true },
    });
    if (latest?.id !== translation.id) {
      throw new TemplateApprovalError("This translation version is no longer current.");
    }
    await tx.templateTranslation.create({
      data: {
        templateId: translation.templateId,
        language: translation.language,
        body: newBody,
        sourceHash: hashSource(translation.template.body),
        editedByHost: true,
        approval: "NONE",
        revision: translation.revision + 1,
      },
    });
  });
}
