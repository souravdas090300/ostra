"use client";

export function DeleteButton({ label }: { label: string }) {
  return (
    <button
      type="submit"
      onClick={(e) => {
        if (!confirm("Are you sure? This cannot be undone.")) {
          e.preventDefault();
        }
      }}
      className="text-sm text-red-600 underline"
    >
      {label}
    </button>
  );
}
