import type { BackgroundJobInfo, BackgroundJobStatus, ChatMessage, ToolCall } from '../types';
import { normalizeAssistantThinking } from './messageThinking';
import { createId } from './id';

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((part: any) => part?.type === 'text').map((part: any) => part.text || '').join('');
}

const BACKGROUND_JOB_STATUSES = new Set<BackgroundJobStatus>(['running', 'completed', 'failed', 'killed']);

function mapBackgroundJob(value: unknown): BackgroundJobInfo | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const job = value as Record<string, unknown>;
  const id = typeof job.id === 'string' ? job.id : '';
  const status = typeof job.status === 'string' && BACKGROUND_JOB_STATUSES.has(job.status as BackgroundJobStatus)
    ? job.status as BackgroundJobStatus
    : undefined;
  if (!id || !status) return undefined;
  const stringField = (key: string) => typeof job[key] === 'string' ? job[key] as string : undefined;
  const numberField = (key: string) => typeof job[key] === 'number' && Number.isFinite(job[key]) ? job[key] as number : undefined;
  return {
    id,
    name: stringField('name')?.trim() || id,
    status,
    sessionId: stringField('sessionId'),
    command: stringField('command'),
    cwd: stringField('cwd'),
    startedAt: stringField('startedAt'),
    endedAt: stringField('endedAt'),
    workerPid: numberField('workerPid'),
    childPid: numberField('childPid'),
    exitCode: job.exitCode === null ? null : numberField('exitCode'),
    signal: job.signal === null ? null : stringField('signal'),
    error: stringField('error'),
    timeoutSeconds: numberField('timeoutSeconds'),
    outputBytes: numberField('outputBytes'),
  };
}

function mappedBackgroundJobs(values: unknown[]): BackgroundJobInfo[] {
  const seen = new Set<string>();
  return values.map(mapBackgroundJob).filter((job): job is BackgroundJobInfo => {
    if (!job || seen.has(job.id)) return false;
    seen.add(job.id);
    return true;
  });
}

export function backgroundJobsFromToolDetails(details: unknown): BackgroundJobInfo[] {
  if (!details || typeof details !== 'object') return [];
  const record = details as Record<string, unknown>;
  return mappedBackgroundJobs([
    ...(Array.isArray(record.jobs) ? record.jobs : []),
    ...(record.job ? [record.job] : []),
  ]);
}

export function backgroundJobsFromCustomMessage(message: any): BackgroundJobInfo[] {
  if (message?.role !== 'custom' || message.display === false || message.customType !== 'sylph.background-jobs') return [];
  return backgroundJobsFromToolDetails(message.details);
}

/** Convert a displayable Pi custom message into a dedicated timeline row when supported. */
export function mapCustomMessage(message: any, selectedJobs?: BackgroundJobInfo[]): ChatMessage | undefined {
  if (message?.role !== 'custom' || message.display === false) return undefined;
  if (message.customType === 'sylph.background-jobs') {
    const jobs = selectedJobs ?? backgroundJobsFromCustomMessage(message);
    if (jobs.length === 0) return undefined;
    return {
      id: message.id || message.responseId || `background-jobs:${jobs.map((job) => job.id).join(':')}`,
      role: 'background-job',
      content: '',
      backgroundJobs: jobs,
    };
  }
  const content = contentText(message.content);
  if (!content.trim()) return undefined;
  return {
    id: message.id || message.responseId || createId(),
    role: 'notification',
    content,
    notifyType: 'info',
  };
}

// Whether a message has anything worth rendering. Aborted/steered turns can
// leave empty assistant messages in history; rendering them as blank bubbles
// injects phantom vertical gaps, so skip them (but always keep streaming ones
// so the live indicator still shows).
export function hasRenderableContent(m: ChatMessage): boolean {
  return (
    m.role === 'user' ||
    m.role === 'notification' ||
    (m.role === 'background-job' && (m.backgroundJobs?.length ?? 0) > 0) ||
    !!m.isStreaming ||
    !!m.isThinking ||
    !!m.content?.trim() ||
    !!m.thinking?.trim() ||
    !!m.errorMessage?.trim() ||
    (m.tools?.length ?? 0) > 0 ||
    (m.images?.length ?? 0) > 0
  );
}

function messageId(message: any): string {
  return message.clientMessageId || message.id || message.responseId || createId();
}

export function mapAgentUserMessage(message: any): ChatMessage {
  const images = Array.isArray(message.content)
    ? message.content
      .filter((part: any) => part?.type === 'image' && part.data && part.mimeType)
      .map((part: any) => ({ url: `data:${part.mimeType};base64,${part.data}`, mimeType: part.mimeType }))
    : [];
  return {
    id: messageId(message),
    role: 'user',
    content: typeof message.displayText === 'string' ? message.displayText : contentText(message.content),
    images: images.length ? images : undefined,
    ...(message.steered === true ? { steered: true } : {}),
  };
}

export function mapAgentAssistantMessage(message: any): ChatMessage {
  let content = '';
  let structuredThinking = '';
  const tools: ToolCall[] = [];

  if (typeof message.content === 'string') {
    content = message.content;
  } else if (Array.isArray(message.content)) {
    message.content.forEach((part: any) => {
      if (part.type === 'text') {
        content += part.text || '';
      } else if (part.type === 'thinking') {
        structuredThinking += part.thinking || '';
      } else if (part.type === 'toolCall') {
        tools.push({ id: part.id, name: part.name, status: 'running', output: '', args: part.arguments });
      }
    });
  }

  const baseMessage: ChatMessage = {
    id: messageId(message),
    role: 'assistant',
    content,
    rawContent: content,
    structuredThinking: structuredThinking || undefined,
    tools,
  };
  const mapped: ChatMessage = { ...baseMessage, ...normalizeAssistantThinking(baseMessage) };
  if (message.stopReason === 'error' && message.errorMessage) mapped.errorMessage = message.errorMessage;
  return mapped;
}

export function mapSessionSnapshotMessages(snapshot: {
  messages?: any[];
  streamingMessage?: any;
  pendingUserMessages?: any[];
  activeToolCallIds?: string[];
}): ChatMessage[] {
  const rawMessages = snapshot.messages || [];
  // Pi exposes a message between message_start and message_end outside the
  // finalized transcript. Include user/tool-result/custom messages in the
  // normal fold so a reconnect in that narrow window cannot lose the row.
  const transientMessage = snapshot.streamingMessage?.role !== 'assistant'
    ? snapshot.streamingMessage
    : undefined;
  const mapped = mapHistoryToMessages(transientMessage ? [...rawMessages, transientMessage] : rawMessages);
  const activeToolCallIds = new Set(snapshot.activeToolCallIds || []);
  if (activeToolCallIds.size > 0) {
    for (const message of mapped) {
      message.tools?.forEach((tool) => {
        if (tool.id && activeToolCallIds.has(tool.id)) tool.status = 'running';
      });
    }
  }

  if (snapshot.streamingMessage?.role === 'assistant') {
    const streaming = mapAgentAssistantMessage(snapshot.streamingMessage);
    streaming.isStreaming = true;
    const content = Array.isArray(snapshot.streamingMessage.content) ? snapshot.streamingMessage.content : [];
    streaming.structuredThinkingActive = content.at(-1)?.type === 'thinking';
    Object.assign(streaming, normalizeAssistantThinking(streaming));
    const existing = mapped.findIndex((message) => message.id === streaming.id);
    if (existing >= 0) mapped[existing] = streaming;
    else mapped.push(streaming);
  }

  for (const pending of snapshot.pendingUserMessages || []) {
    const message = mapAgentUserMessage(pending);
    if (!mapped.some((existing) => existing.id === message.id)) mapped.push(message);
  }
  return mapped;
}

// Map the raw session history from /api/sessions/:sessionId into renderable ChatMessages:
// user/assistant turns become bubbles, and toolResult turns are folded into
// the tool call they answer on the preceding assistant message.
export function mapHistoryToMessages(rawMessages: any[]): ChatMessage[] {
  const mapped: ChatMessage[] = [];
  let currentAssistantMessage: ChatMessage | null = null;

  for (const m of rawMessages) {
    if (m.role === 'user') {
      mapped.push(mapAgentUserMessage(m));
      currentAssistantMessage = null;
    } else if (m.role === 'custom') {
      const jobs = backgroundJobsFromCustomMessage(m);
      const unlinked = jobs.filter((job) => {
        for (let index = mapped.length - 1; index >= 0; index--) {
          const tool = mapped[index].tools?.find((candidate) => candidate.name === 'bg_run' && candidate.backgroundJob?.id === job.id);
          if (tool) {
            tool.backgroundJob = job;
            return false;
          }
        }
        return true;
      });
      const custom = mapCustomMessage(m, jobs.length > 0 ? unlinked : undefined);
      if (custom) mapped.push(custom);
      currentAssistantMessage = null;
    } else if (m.role === 'assistant') {
      const msg = mapAgentAssistantMessage(m);
      mapped.push(msg);
      currentAssistantMessage = msg;
    } else if (m.role === 'toolResult' && currentAssistantMessage && currentAssistantMessage.tools) {
      const tool = currentAssistantMessage.tools.find(t => t.id === m.toolCallId);
      if (tool) {
        let resultStr = '';
        if (typeof m.content === 'string') {
          resultStr = m.content;
        } else if (Array.isArray(m.content)) {
          resultStr = m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text || '').join('');
          const resultImages = m.content
            .filter((c: any) => c.type === 'image' && c.data && c.mimeType)
            .map((c: any) => ({ url: `data:${c.mimeType};base64,${c.data}`, mimeType: c.mimeType }));
          if (resultImages.length) {
            currentAssistantMessage.images = [...(currentAssistantMessage.images ?? []), ...resultImages];
          }
        }
        tool.output = resultStr;
        tool.status = m.isError ? 'error' : 'success';
        const detailJobs = backgroundJobsFromToolDetails(m.details);
        if (tool.name === 'bg_run' && detailJobs[0]) tool.backgroundJob = detailJobs[0];
        for (const job of detailJobs) {
          for (let index = mapped.length - 1; index >= 0; index--) {
            const launch = mapped[index].tools?.find((candidate) => candidate.name === 'bg_run' && candidate.backgroundJob?.id === job.id);
            if (launch) {
              launch.backgroundJob = job;
              break;
            }
          }
        }
      }
    }
  }

  // Tools with no recorded result were interrupted; don't leave them
  // spinning as "running" forever.
  for (const m of mapped) {
    m.tools?.forEach(t => {
      if (t.status === 'running') t.status = 'error';
    });
  }

  return mapped;
}
