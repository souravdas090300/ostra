import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { SettingsForm } from "@/components/SettingsForm";
import { updateSettings } from "../apartments/actions";
import Link from "next/link";

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
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>

      <div className="space-y-2">
        <Link href="/settings/messages" className="block text-blue-600 hover:text-blue-800">
          Message templates →
        </Link>
        <Link href="/settings/password" className="block text-blue-600 hover:text-blue-800">
          Change password →
        </Link>
        <Link href="/settings/usage" className="block text-blue-600 hover:text-blue-800">
          Usage and costs →
        </Link>
        <Link href="/settings/status" className="block text-blue-600 hover:text-blue-800">
          System status →
        </Link>
      </div>

      <div className="border-t pt-6">
        <SettingsForm
          action={updateSettings}
          initialValues={{
            hostLanguage: ownerData.hostLanguage,
            defaultGuestLanguage: ownerData.defaultGuestLanguage,
          }}
        />
      </div>
    </div>
  );
}
