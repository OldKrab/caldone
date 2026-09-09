import type { ProviderToolActivity } from './providerActivityEvent.ts';

export type SearchActivityRecord = { activityId: string; status: ProviderToolActivity['status'] };

/** Per-response deduplication; no queries, tool arguments or retrieved pages are stored. */
export function searchActivityObserver(record: (event: SearchActivityRecord) => void) {
  const seen = new Set<string>();
  return (activity: ProviderToolActivity) => {
    const key = `${activity.id}:${activity.status}`;
    if (seen.has(key)) return;
    seen.add(key);
    record({ activityId: activity.id, status: activity.status });
  };
}
