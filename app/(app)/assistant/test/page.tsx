import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AssistantTester } from "./AssistantTester";

export default async function TestAssistantPage() {
  const owner = await requireOwner();
  const apartments = await prisma.apartment.findMany({
    where: { ownerId: owner.id },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return <AssistantTester apartments={apartments} />;
}
