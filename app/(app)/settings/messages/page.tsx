import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { whatsappMode } from "@/lib/whatsapp";
import { ensureDefaultTemplates } from "@/lib/schedule";
import { TEMPLATE_CATEGORY } from "@/lib/templates";
import { LANGUAGES } from "@/lib/languages";
import MessagesSettings from "@/components/MessagesSettings";

export default async function MessagesSettingsPage() {
  const session = await requireOwner();
  const ownerId = session.user.id;

  // Ensure default templates exist
  await ensureDefaultTemplates(ownerId, session.user.hostLanguage);

  const owner = await prisma.owner.findUnique({
    where: { id: ownerId },
    select: {
      fallbackLanguage: true,
      hostLanguage: true,
      templates: {
        include: {
          translations: true,
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

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-800">
          <strong>WhatsApp Mode:</strong> {mode}
          {mode === "dry-run" && (
            <span className="ml-2">
              Messages are recorded but not sent. Set WHATSAPP_MODE to sandbox or production to send real messages.
            </span>
          )}
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
