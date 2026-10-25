import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import ReviewDraftForm from "./ReviewDraftForm";

export default async function ReviewDraftPage() {
  const session = await requireOwner();
  const apartments = await prisma.apartment.findMany({
    where: { ownerId: session.id },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Review Reply Draft</h1>
        <p className="mt-2 text-sm text-gray-600">
          Paste a guest review to get a draft public reply. The draft is never stored or posted.
        </p>
      </div>

      <ReviewDraftForm apartments={apartments} />
    </div>
  );
}
