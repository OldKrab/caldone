import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Model,
} from '@earendil-works/pi-ai';
import { requestWithDeadline } from '../services/requestDeadline';

/** Bound each provider response, including a stalled body. Only this stream is
 * visible to the agent; a late native response can never supply executable
 * tools after timeout or Stop. Completed earlier tool calls remain durable. */
export function agentRequestStream(
  model: Model<string>,
  request: (signal: AbortSignal) => AssistantMessageEventStream,
  parent?: AbortSignal,
): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream();
  void requestWithDeadline(async (signal) => {
    const stream = request(signal);
    for await (const event of stream) {
      signal.throwIfAborted();
      output.push(event);
    }
    return stream.result();
  }, parent).then(
    (result) => output.end(result),
    (error) => {
      const stopReason = parent?.aborted ? 'aborted' : 'error';
      const message: AssistantMessage = {
        role: 'assistant',
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        timestamp: Date.now(),
        stopReason,
        errorMessage: error instanceof Error ? error.message : String(error),
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      };
      output.push({ type: 'error', reason: stopReason, error: message });
      output.end(message);
    },
  );
  return output;
}
