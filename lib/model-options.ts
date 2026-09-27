/** Provider-specific generation settings; credentials never enter the body. */
export function usesCompactModelPrompt(endpoint: string, model: string) {
  return new URL(endpoint).hostname === "maas-api.cn-huabei-1.xf-yun.com" && model === "spark-x2.5-1.7b";
}
export function modelOutputOptions(endpoint: string, model: string, defaultMaxTokens: number) {
  if (usesCompactModelPrompt(endpoint, model)) {
    // Live verification: thinking consumed 999/1000 tokens with an empty answer.
    // This model supports disabling thinking for concise, evidence-based replies.
    return { max_tokens: 2000, enable_thinking: false };
  }
  if (model.startsWith("openai/gpt-oss-")) return { max_tokens: 2000, reasoning_effort: "low" };
  return { max_tokens: defaultMaxTokens };
}
