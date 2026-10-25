"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/auth";

export async function toggleEnquiries(): Promise<void> {
  const session = await requireOwner();
  const owner = await prisma.owner.findUnique({
    where: { id: session.user.id },
    select: { enquiriesEnabled: true },
  });
  if (!owner) return;

  await prisma.owner.update({
    where: { id: session.user.id },
    data: { enquiriesEnabled: !owner.enquiriesEnabled },
  });
  revalidatePath("/settings/enquiries");
}
