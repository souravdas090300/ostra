import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/auth";

export default async function ApartmentsPage() {
  const session = await requireOwner();
  const apartments = await prisma.apartment.findMany({
    where: { ownerId: session.id },
    orderBy: { name: "asc" },
    include: { _count: { select: { feeds: true } } },
  });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Apartments</h1>
        <Link href="/apartments/new" className="rounded-md bg-black px-3 py-2 text-white">Add apartment</Link>
      </div>
      {apartments.length === 0 && <p className="text-gray-600">No apartments yet.</p>}
      <ul className="divide-y rounded-md border">
        {apartments.map((a) => (
          <li key={a.id}>
            <Link href={`/apartments/${a.id}`} className="flex justify-between p-4 hover:bg-gray-50">
              <span>
                <span className="font-medium">{a.name}</span>
                <span className="block text-sm text-gray-600">{a.address}</span>
              </span>
              <span className="text-sm text-gray-600">{a._count.feeds} calendar link(s)</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
