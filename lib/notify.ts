type Notice = { to: string; subject: string; text: string };

export async function sendEmail(n: Notice): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !process.env.NOTIFY_FROM) {
    console.log("notify (dry-run)", { subject: n.subject });
    return; // never log the body
  }
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.NOTIFY_FROM, to: n.to, subject: n.subject, text: n.text }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    console.error("notify failed");
  }
}

export const notifyHost = sendEmail;
