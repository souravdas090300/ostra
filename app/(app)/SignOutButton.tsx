"use client";

import { signOut } from "@/lib/client-auth";

export default function SignOutButton() {
  return (
    <button
      onClick={() => signOut()}
      className="text-sm text-gray-500 hover:text-gray-700"
    >
      Sign out
    </button>
  );
}
