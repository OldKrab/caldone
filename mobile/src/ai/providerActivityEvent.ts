export type ProviderToolActivity = {
  id: string;
  name: 'web_search';
  status: 'active' | 'complete' | 'error';
};

export function providerActivityFromEvent(event: unknown): ProviderToolActivity | undefined {
  if (!event || typeof event !== 'object') return undefined;
  const value = event as Record<string, unknown>;
  const item = value.item && typeof value.item === 'object' ? value.item as Record<string, unknown> : undefined;
  const eventType = typeof value.type === 'string' ? value.type : '';
  const isWebSearch = item?.type === 'web_search_call' || eventType.includes('web_search_call');
  if (!isWebSearch) return undefined;

  const idValue = value.item_id ?? item?.id ?? value.output_index;
  const id = typeof idValue === 'string' || typeof idValue === 'number'
    ? `web-search-${idValue}`
    : 'web-search-current';
  const providerStatus = typeof item?.status === 'string' ? item.status : '';
  const status = eventType.includes('failed') || providerStatus === 'failed' || providerStatus === 'incomplete'
    ? 'error'
    : eventType.includes('completed') || eventType.endsWith('.done') || providerStatus === 'completed'
      ? 'complete'
      : 'active';
  return { id, name: 'web_search', status };
}
