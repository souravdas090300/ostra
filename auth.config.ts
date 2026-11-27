import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "./lib/db";
import { isLockedOut, recordAttempt, clientIp } from "./lib/login-guard";
import bcrypt from "bcryptjs";
import { z } from "zod";

// Compared against when the email is unknown, so timing does not reveal which emails exist.
const DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEeO5f2hQK8m1k6uQe1gQ1qk2c5e1o9o9Xq"; // nosemgrep: generic.secrets.security.detected-bcrypt-hash.detected-bcrypt-hash

const credentialsSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

export const authConfig: NextAuthConfig = {
  providers: [
    Credentials({
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const email = parsed.data.email.trim().toLowerCase();
        const ip = clientIp(new Headers(request?.headers));
        if (await isLockedOut(email, ip)) return null;
        const owner = await prisma.owner.findUnique({ where: { email } });
        const ok = await bcrypt.compare(
          parsed.data.password,
          owner?.passwordHash ?? DUMMY_HASH,
        );
        await recordAttempt(email, ip, !!owner && ok);
        if (!owner || !ok) return null;
        return {
          id: owner.id,
          email: owner.email,
          hostLanguage: owner.hostLanguage,
          defaultGuestLanguage: owner.defaultGuestLanguage,
          pwdStamp: owner.passwordChangedAt?.toISOString() ?? null,
          sessionVersion: owner.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    authorized({ auth, request }) {
      const path = request.nextUrl.pathname;
      const PUBLIC = [
        /^\/login$/,
        /^\/privacy$/,
        /^\/api\/auth\//,
        /^\/api\/health/,
        /^\/api\/cron\//,
        /^\/api\/webhooks\//,
        /^\/api\/ical\//,
        /^\/monitoring/,
        /^\/_next\//,
        /^\/favicon/,
      ];
      if (PUBLIC.some((re) => re.test(path))) return true;
      return !!auth?.user;
    },
    jwt({ token, user }) {
      if (user) {
        token.ownerId = user.id;
        token.pwdStamp = user.pwdStamp ?? null;
        token.sv = user.sessionVersion ?? 0;
      }
      return token;
    },
    session({ session, token }) {
      if (token.ownerId) session.user.id = token.ownerId as string;
      session.user.pwdStamp = token.pwdStamp ?? null;
      session.user.sv = token.sv ?? 0;
      return session;
    },
  },
  session: { strategy: "jwt", maxAge: 14 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
};
