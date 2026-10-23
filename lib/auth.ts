import NextAuth from "next-auth";
import { authConfig } from "../auth.config";
import { redirect } from "next/navigation";

const { handlers, signIn, signOut, auth } = NextAuth(authConfig);

export { handlers, signIn, signOut, auth };

export type AuthSession = {
  user: {
    id: string;
    email: string;
    hostLanguage: string;
    defaultGuestLanguage: string;
    iat?: number;
  };
};

export async function requireOwner(): Promise<AuthSession> {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  return session as AuthSession;
}
