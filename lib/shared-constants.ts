export const HOUR = 3_600_000;
export const E164 = /^\+\d{8,15}$/;

export const STOP_CONFIRM: Record<string, string> = {
  en: "You will no longer receive messages from us.",
  it: "Non riceverai più messaggi da noi.",
  de: "Sie erhalten keine Nachrichten mehr von uns.",
  fr: "Vous ne recevrez plus de messages de notre part.",
  es: "Ya no recibirá mensajes nuestros.",
};

export const UNMATCHED_REPLY = "Thanks for your message. I have passed it to your host, who will get back to you shortly.";

export type InboundInput = {
  sid: string;
  from: string;
  to: string;
  body: string;
  numMedia: number;
};
