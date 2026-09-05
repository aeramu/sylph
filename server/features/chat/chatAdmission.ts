import {
  cancelPendingUserMessage,
  registerPendingUserMessage,
} from "../../integrations/pi/runtime/pendingUserMessages.ts";

const admissionTails = new WeakMap<object, Promise<void>>();

/** Serialize the short prompt-admission phase without waiting for the agent run. */
export async function withSessionAdmission<T>(session: object, task: () => Promise<T>): Promise<T> {
  const previous = admissionTails.get(session) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  admissionTails.set(session, tail);

  await previous;
  try {
    return await task();
  } finally {
    release();
    if (admissionTails.get(session) === tail) admissionTails.delete(session);
  }
}

export interface PromptAdmissionOptions {
  images?: unknown[];
  clientMessageId?: string;
  displayText?: string;
}

/**
 * Queue steering immediately, or start an idle prompt and wait only until Pi's
 * synchronous preflight accepts it. The long-running agent promise is observed
 * in the background so HTTP does not remain open for the whole turn.
 */
export async function admitPrompt(session: any, text: string, options: PromptAdmissionOptions): Promise<boolean> {
  const steered = !!session.isStreaming;
  const token = registerPendingUserMessage(session, {
    clientMessageId: options.clientMessageId,
    displayText: options.displayText,
    images: options.images,
    steered,
  });

  if (steered) {
    try {
      await session.steer(text, options.images);
      return true;
    } catch (error) {
      cancelPendingUserMessage(session, token);
      throw error;
    }
  }

  let accepted = false;
  let resolveAccepted!: () => void;
  let rejectAccepted!: (error: unknown) => void;
  const acceptance = new Promise<void>((resolve, reject) => {
    resolveAccepted = resolve;
    rejectAccepted = reject;
  });

  let run: Promise<void>;
  try {
    run = session.prompt(text, {
      ...(options.images?.length ? { images: options.images } : {}),
      preflightResult: (ok: boolean) => {
        if (!ok) return; // prompt() rejects with the authoritative error next
        accepted = true;
        resolveAccepted();
      },
    });
  } catch (error) {
    cancelPendingUserMessage(session, token);
    throw error;
  }

  void Promise.resolve(run).then(
    () => {
      if (!accepted) resolveAccepted(); // compatibility with runtimes lacking the callback
    },
    (error) => {
      if (!accepted) rejectAccepted(error);
      else console.error("Prompt error:", error);
    },
  ).finally(() => cancelPendingUserMessage(session, token));

  await acceptance;
  // Let prompt() advance past its preflight callback. Extension commands can
  // report acceptance without starting an agent run; do not leave their token
  // queued for the next real user message to consume.
  await Promise.resolve();
  if (!session.isStreaming) cancelPendingUserMessage(session, token);
  return false;
}
