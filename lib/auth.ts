import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "./db";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { isLockedOut, recordAttempt, clientIp } from "./login-guard";
import { headers } from "next/headers";

const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = credentials.email as string;
        const password = credentials.password as string;
        const headersList = await headers();
        const ip = clientIp(headersList);

        // Check if locked out
        if (await isLockedOut(email, ip)) {
          await recordAttempt(email, ip, false);
          throw new Error("Locked out");
        }

        const owner = await prisma.owner.findUnique({
          where: { email },
        });

        // Always run bcrypt.compare against a dummy hash for timing consistency
        const dummyHash = "$2a$12$dummy.hash.for.timing.consistency";
        const isValid = owner
          ? await bcrypt.compare(password, owner.passwordHash)
          : await bcrypt.compare(password, dummyHash);

        if (!isValid) {
          await recordAttempt(email, ip, false);
          throw new Error("Invalid credentials");
        }

        if (!owner) {
          return null;
        }

        // Check if session is invalidated by password change
        if (owner.passwordChangedAt) {
          const session = await auth();
          if (session?.user?.iat && session.user.iat * 1000 < owner.passwordChangedAt.getTime()) {
            await recordAttempt(email, ip, false);
            throw new Error("Session invalidated");
          }
        }

        await recordAttempt(email, ip, true);

        return {
          id: owner.id,
          email: owner.email,
          hostLanguage: owner.hostLanguage,
          defaultGuestLanguage: owner.defaultGuestLanguage,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.hostLanguage = user.hostLanguage;
        token.defaultGuestLanguage = user.defaultGuestLanguage;
        token.iat = Math.floor(Date.now() / 1000);
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.hostLanguage = token.hostLanguage as string;
        session.user.defaultGuestLanguage = token.defaultGuestLanguage as string;
        session.user.iat = token.iat as number;
      }
      return session;
    },
  },
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  trustHost: true,
});

export { handlers, signIn, signOut, auth };

export async function requireOwner() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  return session;
}
