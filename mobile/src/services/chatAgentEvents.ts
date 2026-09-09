import type { Agent, AgentEvent } from '@earendil-works/pi-agent-core';

/** Connects session side effects to Pi's event stream. */
export function subscribeToChatAgent(
  agent: Agent,
  listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void,
  onError: (error: unknown) => void = () => undefined,
): () => void {
  return agent.subscribe((event, signal) => {
    void Promise.resolve(listener(event, signal)).catch(onError);
  });
}

const conversationOwners = new Map<string, Promise<void>>();

/** Prevents two mounted screens from saving competing snapshots of one conversation. */
export async function acquireChatSessionLease(threadId: string): Promise<() => void> {
  const previous = conversationOwners.get(threadId) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const current = previous.catch(() => undefined).then(() => gate);
  conversationOwners.set(threadId, current);
  await previous.catch(() => undefined);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseCurrent();
    if (conversationOwners.get(threadId) === current) conversationOwners.delete(threadId);
  };
}
