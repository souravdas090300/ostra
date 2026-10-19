import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      hostLanguage: string;
      defaultGuestLanguage: string;
    } & DefaultSession["user"];
    expires: string;
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
  }
}
