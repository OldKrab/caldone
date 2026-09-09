import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, meals } from '../test/mealAgentFixture.ts';
import { defaultNotificationPreferences } from '../domain/preferences.ts';

const { applyNotificationPreferences } = await import('./mealProcessor.ts');

test('restoring notifications and saving a meal respect a permission denial', async () => {
  let prompts = 0;
  fixture.notifications = {
    permission: { status: 'denied', granted: false, canAskAgain: true },
    request() { prompts++; return this.permission; },
  };
  await applyNotificationPreferences(defaultNotificationPreferences);
  await applyNotificationPreferences(defaultNotificationPreferences, true);
  assert.equal(prompts, 0);
});

test('an explicit notification opt-in can ask again after a denial', async () => {
  let prompts = 0;
  fixture.notifications = {
    permission: { status: 'denied', granted: false, canAskAgain: true },
    request() { prompts++; return this.permission; },
  };
  await applyNotificationPreferences(defaultNotificationPreferences, false, { requestPermission: true });
  await applyNotificationPreferences(defaultNotificationPreferences, true);
  assert.equal(prompts, 1);
});

for (const [name, permission, expectedPrompts] of [
  ['first request', { status: 'undetermined', granted: false, canAskAgain: true }, 1],
  ['already granted', { status: 'granted', granted: true, canAskAgain: true }, 0],
  ['blocked by Android', { status: 'denied', granted: false, canAskAgain: false }, 0],
] as const) {
  test(`explicit opt-in respects OS permission state: ${name}`, async () => {
    let prompts = 0;
    fixture.notifications = { permission, request() { prompts++; return this.permission; } };
    await applyNotificationPreferences(defaultNotificationPreferences, false, { requestPermission: true });
    assert.equal(prompts, expectedPrompts);
  });
}

test('saving a meal still moves an enabled reminder to tomorrow without prompting', async context => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 8, 9, 14).getTime() });
  const scheduled: Date[] = [];
  const cancelled: string[] = [];
  fixture.notifications = {
    permission: { status: 'denied', granted: false, canAskAgain: true },
    request() { assert.fail('Reminder maintenance must not request permission'); },
    schedule(request: { trigger: { date: Date } }) { scheduled.push(request.trigger.date); return `reminder-${scheduled.length}`; },
    cancel(id: string) { cancelled.push(id); },
  };
  const preferences = { ...defaultNotificationPreferences, reminder: true };
  await applyNotificationPreferences(preferences);
  await applyNotificationPreferences(preferences, true);
  assert.deepEqual(scheduled, [new Date(2026, 8, 9, 20), new Date(2026, 8, 10, 20)]);
  assert.deepEqual(cancelled, ['reminder-1']);
  assert.equal(await meals.getPreference('daily_reminder_notification_id'), 'reminder-2');
  await applyNotificationPreferences(defaultNotificationPreferences, true);
  assert.deepEqual(cancelled, ['reminder-1', 'reminder-2']);
  assert.equal(await meals.getPreference('daily_reminder_notification_id'), '');
});
