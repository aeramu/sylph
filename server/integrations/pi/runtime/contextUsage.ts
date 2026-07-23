// Snapshot context-window usage for the composer's context indicator. The
// section breakdown uses chars/4 estimates; aggregate usage is SDK-reported.
export function getContextInfo(session: any) {
  try {
    const usage = session.getContextUsage?.();
    if (!usage) return undefined;
    const estimate = (text: string) => Math.ceil((text?.length || 0) / 4);
    let systemPromptTokens = 0;
    try { systemPromptTokens = estimate(session.systemPrompt); } catch { /* unavailable before initialization */ }
    let toolTokens = 0;
    try {
      for (const tool of session.getAllTools?.() || []) {
        toolTokens += estimate(`${tool.name} ${tool.description || ""}`) + estimate(JSON.stringify(tool.parameters || {}));
      }
    } catch { /* unavailable tool registry */ }
    const stats = session.getSessionStats?.();
    return {
      tokens: usage.tokens,
      contextWindow: usage.contextWindow,
      percent: usage.percent,
      systemPromptTokens,
      toolTokens,
      stats: stats ? {
        userMessages: stats.userMessages,
        assistantMessages: stats.assistantMessages,
        toolCalls: stats.toolCalls,
        totalMessages: stats.totalMessages,
        tokens: stats.tokens,
        cost: stats.cost,
      } : undefined,
    };
  } catch {
    return undefined;
  }
}
