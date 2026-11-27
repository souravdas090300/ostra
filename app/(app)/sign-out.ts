"use server";

import { signOut } from "@/lib/auth";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function signOutAction() {
  const owner = await requireOwner();
  // Bump before signing out so JWTs re-minted by in-flight requests that
  // still carry the old cookie are rejected by requireOwner.
  await prisma.owner.update({
    where: { id: owner.id },
    data: { sessionVersion: { increment: 1 } },
  });
  await signOut({ redirectTo: "/login" });
}
