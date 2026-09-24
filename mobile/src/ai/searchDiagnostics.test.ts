import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchActivityObserver } from './searchDiagnostics.ts';
import { providerActivityFromEvent } from './providerActivityEvent.ts';

test('records actual hosted searches once per state without recording queries or page content', () => {
  const records: unknown[] = [];
  const observe = searchActivityObserver(record => records.push(record));
  const started = providerActivityFromEvent({type:'response.output_item.added',item:{id:'search-1',type:'web_search_call',action:{query:'private meal description'}}})!;
  observe(started); observe(started);
  observe(providerActivityFromEvent({type:'response.web_search_call.completed',item_id:'search-1'})!);
  assert.deepEqual(records, [
    {activityId:'web-search-search-1',status:'active'},
    {activityId:'web-search-search-1',status:'complete'},
  ]);
});
