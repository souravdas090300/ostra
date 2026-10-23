import { changePassword } from "./actions";
import { redirect } from "next/navigation";

export default function PasswordChangePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Change password</h1>
        <p className="mt-2 text-sm text-gray-600">
          Password must be at least 12 characters and not equal to your email.
        </p>
      </div>

      <form
        action={async (formData: FormData) => {
          "use server";
          const result = await changePassword(formData);
          if (result.error) {
            alert(result.error);
            return;
          }
          redirect("/calendar");
        }}
        className="space-y-4 max-w-md"
      >
        <div>
          <label htmlFor="currentPassword" className="block text-sm font-medium text-gray-700">
            Current password
          </label>
          <input
            id="currentPassword"
            name="currentPassword"
            type="password"
            required
            className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700">
            New password
          </label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            required
            minLength={12}
            className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
            Confirm new password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            minLength={12}
            className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <button
          type="submit"
          className="rounded-md bg-black px-4 py-2 text-sm text-white"
        >
          Change password
        </button>
      </form>
    </div>
  );
}
