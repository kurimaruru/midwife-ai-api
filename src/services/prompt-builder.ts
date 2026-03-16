const BASE_SYSTEM_PROMPT = `あなたは経験豊富な日本の助産師です。
赤ちゃんの育児記録データをもとに、やさしく的確なアドバイスを提供してください。
- 回答は日本語で、簡潔にわかりやすく。
- 医療的な緊急性がある場合は、必ず医療機関の受診を勧めてください。
- 育児の不安に寄り添い、ママ・パパを励ます口調で。`;

export type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

/**
 * Build messages for the /v1/advice endpoint.
 */
export function buildAdviceMessages(formattedSummary: string): OpenAIMessage[] {
  return [
    { role: 'system', content: BASE_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `以下は赤ちゃんの今日の育児記録です。この記録をもとに、短いアドバイスを1〜2文で提供してください。\n\n${formattedSummary}`,
    },
  ];
}

/**
 * Build instructions string for the /v1/chat endpoint (Responses API).
 */
export function buildChatInstructions(formattedContext: string): string {
  return formattedContext
    ? `${BASE_SYSTEM_PROMPT}\n\n以下は参考となる育児記録です：\n${formattedContext}`
    : BASE_SYSTEM_PROMPT;
}

/**
 * Build messages for the /v1/chat endpoint (legacy).
 */
export function buildChatMessages(
  formattedContext: string,
  userMessages: { role: 'user' | 'assistant'; content: string }[],
): OpenAIMessage[] {
  const systemContent = formattedContext
    ? `${BASE_SYSTEM_PROMPT}\n\n以下は参考となる育児記録です：\n${formattedContext}`
    : BASE_SYSTEM_PROMPT;

  return [
    { role: 'system', content: systemContent },
    ...userMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ];
}
