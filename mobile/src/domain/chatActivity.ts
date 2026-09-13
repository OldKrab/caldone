import type { AgentMessage } from '@earendil-works/pi-agent-core';

type RecordedProviderActivity = {
  id: string;
  name: 'web_search';
  status: 'active' | 'complete' | 'error' | 'cancelled';
  blockIndex: number;
};
export type ChatProviderActivity = RecordedProviderActivity & { messageIndex: number };
type AssistantWithActivity = Extract<AgentMessage, { role: 'assistant' }> & {
  /** App-owned lifecycle metadata only; never queries, pages or model reasoning. */
  caldoneProviderActivities?: RecordedProviderActivity[];
};

/** Anchor saved searches to their response, so navigation, backup and history
 * loading cannot move them underneath later messages or leave an old spinner. */
export function readProviderActivities(messages: AgentMessage[]): ChatProviderActivity[] {
  return messages.flatMap((message, messageIndex) => {
    if (message.role !== 'assistant') return [];
    const activities = (message as AssistantWithActivity).caldoneProviderActivities;
    if (!Array.isArray(activities)) return [];
    return activities.flatMap(activity => {
      if (!activity || activity.name !== 'web_search' || typeof activity.id !== 'string' || !activity.id
        || !Number.isInteger(activity.blockIndex) || activity.blockIndex < 0
        || !['active', 'complete', 'error', 'cancelled'].includes(activity.status)) return [];
      return [{ id: activity.id, name: activity.name, messageIndex, status: activity.status === 'active' ? 'cancelled' as const : activity.status,
        blockIndex: Math.min(activity.blockIndex, message.content.length) }];
    });
  });
}

export function retainProviderActivities(messages: AgentMessage[], activities: ChatProviderActivity[]): AgentMessage[] {
  return messages.map((message, messageIndex) => {
    if (message.role !== 'assistant') return message;
    const recorded = activities.filter(activity => activity.messageIndex === messageIndex)
      .map(({ messageIndex: _, ...activity }) => ({ ...activity, blockIndex: Math.min(activity.blockIndex, message.content.length) }));
    return recorded.length ? { ...message, caldoneProviderActivities: recorded } : message;
  });
}
