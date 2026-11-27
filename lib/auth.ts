import NextAuth from "next-auth";
import { authConfig } from "../auth.config";
import { redirect } from "next/navigation";
import { prisma } from "./db";
import "./env";

const { handlers, signIn, signOut, auth } = NextAuth(authConfig);

export { handlers, signIn, signOut, auth };

export type SessionOwner = Omit<
  NonNullable<Awaited<ReturnType<typeof prisma.owner.findUnique>>>,
  "passwordHash"
>;

/** The logged-in owner, or a redirect to /login. Use in every page, server action and route that needs a session. */
export async function requireOwner(): Promise<SessionOwner> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) redirect("/login");
  const owner = await prisma.owner.findUnique({ where: { id } });
  if (!owner) redirect("/login");
  // Reject sessions issued before the last password change or sign-out.
  if (
    owner.passwordChangedAt &&
    (!session.user.pwdStamp ||
      new Date(session.user.pwdStamp).getTime() < owner.passwordChangedAt.getTime())
  ) {
    redirect("/login");
  }
  // In-flight session refreshes can mint a fresh JWT after sign-out; the
  // sessionVersion bump on sign-out makes those stale tokens fail here.
  if ((session.user.sv ?? 0) !== owner.sessionVersion) redirect("/login");
  const { passwordHash: _omit, ...safe } = owner;
  return safe;
}
