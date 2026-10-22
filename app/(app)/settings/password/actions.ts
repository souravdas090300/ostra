"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import bcrypt from "bcryptjs";
import { signOut } from "@/lib/auth";

// Common passwords list (simplified - in production use a comprehensive list)
const COMMON_PASSWORDS = new Set([
  "password",
  "123456",
  "12345678",
  "qwerty",
  "abc123",
  "monkey",
  "master",
  "dragon",
  "111111",
  "baseball",
  "iloveyou",
  "trustno1",
  "sunshine",
  "princess",
  "admin",
  "welcome",
  "shadow",
  "ashley",
  "football",
  "jesus",
  "michael",
  "ninja",
  "mustang",
  "password1",
]);

export async function changePassword(formData: FormData): Promise<{ error?: string }> {
  const owner = await requireOwner();
  const currentPassword = formData.get("currentPassword") as string;
  const newPassword = formData.get("newPassword") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if (!currentPassword || !newPassword || !confirmPassword) {
    return { error: "All fields are required." };
  }

  if (newPassword !== confirmPassword) {
    return { error: "Passwords do not match." };
  }

  if (newPassword.length < 12) {
    return { error: "Password must be at least 12 characters." };
  }

  // Check not equal to email
  const emailLocal = owner.email.split("@")[0].toLowerCase();
  if (newPassword.toLowerCase().includes(emailLocal) || newPassword.toLowerCase() === owner.email.toLowerCase()) {
    return { error: "Password cannot contain your email." };
  }

  // Check common passwords
  if (COMMON_PASSWORDS.has(newPassword.toLowerCase())) {
    return { error: "Please choose a stronger password." };
  }

  // Verify current password
  const currentOwner = await prisma.owner.findUnique({
    where: { id: owner.id },
    select: { passwordHash: true },
  });

  if (!currentOwner) {
    return { error: "User not found." };
  }

  const isValid = await bcrypt.compare(currentPassword, currentOwner.passwordHash);
  if (!isValid) {
    return { error: "Current password is incorrect." };
  }

  // Update password
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.owner.update({
    where: { id: owner.id },
    data: {
      passwordHash,
      passwordChangedAt: new Date(),
    },
  });

  // Write audit log
  await prisma.auditLog.create({
    data: {
      ownerId: owner.id,
      action: "PASSWORD_CHANGED",
      targetType: "owner",
      targetId: owner.id,
    },
  });

  // Sign out all sessions
  await signOut({ redirectTo: "/login" });

  return {};
}
