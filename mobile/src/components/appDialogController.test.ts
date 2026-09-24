import assert from 'node:assert/strict';
import test from 'node:test';

import { createAppDialogController } from './appDialogController.ts';

test('choosing an app-dialog action closes the dialog before running its callback', () => {
  const controller = createAppDialogController();
  const states: Array<string | undefined> = [];
  controller.subscribe((dialog) => states.push(dialog?.title));
  let openDuringCallback = true;

  controller.show({
    title: 'Meal actions',
    actions: [{
      label: 'Delete',
      onPress: () => { openDuringCallback = Boolean(controller.current()); },
    }],
  });
  controller.choose(0);

  assert.equal(openDuringCallback, false);
  assert.deepEqual(states, [undefined, 'Meal actions', undefined]);
});
