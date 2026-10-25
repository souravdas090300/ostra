export const assistantEnabled = () => process.env.ASSISTANT_ENABLED !== "false";
export const automaticMessagesEnabled = () => process.env.AUTOMATIC_MESSAGES_ENABLED !== "false";
export const getAnthropic = () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  return {
    apiKey: process.env.ANTHROPIC_API_KEY,
  };
};
