import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { SettingsForm } from "@/components/SettingsForm";
import { updateSettings } from "../apartments/actions";

export default async function SettingsPage() {
  const session = await requireOwner();
  const ownerData = await prisma.owner.findUnique({
    where: { id: session.user.id },
    select: { hostLanguage: true, defaultGuestLanguage: true },
  });
  if (!ownerData) {
    throw new Error("Owner not found");
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <SettingsForm
        action={updateSettings}
        initialValues={{
          hostLanguage: ownerData.hostLanguage,
          defaultGuestLanguage: ownerData.defaultGuestLanguage,
        }}
      />
    </div>
  );
}
