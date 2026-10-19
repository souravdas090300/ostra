import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "./db";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";

export const { handlers, signIn, signOut, auth } = NextAuth({
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

        const owner = await prisma.owner.findUnique({
          where: { email: credentials.email as string },
        });

        if (!owner) {
          return null;
        }

        const isValid = await bcrypt.compare(
          credentials.password as string,
          owner.passwordHash
        );

        if (!isValid) {
          return null;
        }

        return {
          id: owner.id,
          email: owner.email,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  trustHost: true,
});

export async function requireOwner() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  return session;
}
