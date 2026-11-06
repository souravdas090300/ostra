import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { whatsappMode } from "@/lib/whatsapp";
import { ensureDefaultTemplates } from "@/lib/schedule";
import { TEMPLATE_CATEGORY } from "@/lib/templates";
import { LANGUAGES } from "@/lib/languages";
import MessagesSettings from "@/components/MessagesSettings";

export default async function MessagesSettingsPage() {
  const session = await requireOwner();
  const ownerId = session.id;

  // Ensure default templates exist
  await ensureDefaultTemplates(ownerId, session.hostLanguage);

  const owner = await prisma.owner.findUnique({
    where: { id: ownerId },
    select: {
      fallbackLanguage: true,
      hostLanguage: true,
      enquiriesEnabled: true,
      templates: {
        include: {
          translations: { orderBy: { revision: "desc" } },
        },
      },
    },
  });

  if (!owner) {
    throw new Error("Owner not found");
  }

  const mode = whatsappMode();

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Message Templates</h1>

      <div
        role="status"
        className={`rounded-lg border p-4 ${
          mode === "production"
            ? "border-red-200 bg-red-50"
            : mode === "sandbox"
              ? "border-amber-200 bg-amber-50"
              : "border-blue-200 bg-blue-50"
        }`}
      >
        <p className="text-sm">
          <strong>WhatsApp Mode:</strong> {mode}
          {mode === "dry-run" && (
            <span className="ml-2">
              Messages are recorded but not sent.
            </span>
          )}
          {mode === "sandbox" && <span className="ml-2">Only configured test recipients can be messaged.</span>}
          {mode === "production" && <span className="ml-2">Live guest messaging is enabled.</span>}
        </p>
      </div>

      <MessagesSettings
        owner={owner}
        languages={LANGUAGES}
        templateCategory={TEMPLATE_CATEGORY}
      />
    </div>
  );
}
