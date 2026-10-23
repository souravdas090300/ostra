"use client";

import { WrongAnswer } from "@/lib/inbox-data";

export function WrongAnswersList({ wrongAnswers }: { wrongAnswers: WrongAnswer[] }) {
  const copyAsTestCase = (answer: WrongAnswer) => {
    const testCase = JSON.stringify(
      {
        question: answer.question,
        answer: answer.body,
        note: answer.feedbackNote,
      },
      null,
      2
    );
    navigator.clipboard.writeText(testCase);
    alert("Copied as test case");
  };

  if (wrongAnswers.length === 0) return null;

  return (
    <div className="rounded-lg border bg-white p-4">
      <h2 className="font-medium">Wrong answers (last 7 days)</h2>
      <div className="mt-3 space-y-3">
        {wrongAnswers.map((msg) => (
          <div key={msg.id} className="rounded border p-3 text-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium">{msg.apartmentName}</span>
              <span className="text-xs text-gray-500">
                {new Date(msg.feedbackAt!).toLocaleString()}
              </span>
            </div>
            <div className="space-y-1">
              <p className="text-gray-600">{msg.question}</p>
              <p className="font-medium">{msg.body}</p>
              {msg.feedbackNote && (
                <p className="text-red-600">Note: {msg.feedbackNote}</p>
              )}
            </div>
            <div className="mt-2">
              <a
                href={`/inbox/${msg.bookingId}`}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                View conversation
              </a>
              <button
                onClick={() => copyAsTestCase(msg)}
                className="ml-3 text-xs text-blue-600 hover:text-blue-800"
              >
                Copy as test case
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
