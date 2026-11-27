"use client";

import { signOutAction } from "./sign-out";

export default function SignOutButton() {
  return (
    <button
      onClick={() => signOutAction()}
      className="text-sm text-gray-500 hover:text-gray-700"
    >
      Sign out
    </button>
  );
}
