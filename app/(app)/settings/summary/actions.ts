"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/auth";

export async function toggleWeeklySummary(enabled: boolean): Promise<{ success: boolean; error?: string }> {
  const session = await requireOwner();

  try {
    await prisma.owner.update({
      where: { id: session.id },
      data: { weeklySummaryEnabled: enabled },
    });

    revalidatePath("/settings");
    return { success: true };
  } catch {
    return { success: false, error: "Failed to update setting" };
  }
}
