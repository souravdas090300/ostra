import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "./lib/db";
import bcrypt from "bcryptjs";

export const authConfig: NextAuthConfig = {
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

        const owner = await prisma.owner.findUnique({
          where: { email },
        });

        // Always run bcrypt.compare against a dummy hash for timing consistency
        const dummyHash = "$2a$12$dummy.hash.for.timing.consistency";
        const isValid = owner
          ? await bcrypt.compare(password, owner.passwordHash)
          : await bcrypt.compare(password, dummyHash);

        if (!isValid || !owner) {
          return null;
        }

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
};
