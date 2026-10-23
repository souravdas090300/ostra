import type { DefaultSession } from "next-auth";
import type { JWT } from "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      hostLanguage: string;
      defaultGuestLanguage: string;
      iat?: number;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    email: string;
    hostLanguage: string;
    defaultGuestLanguage: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    hostLanguage?: string;
    defaultGuestLanguage?: string;
    iat?: number;
  }
}

export type AuthSession = {
  user: {
    id: string;
    email: string;
    hostLanguage: string;
    defaultGuestLanguage: string;
    iat?: number;
  };
};
