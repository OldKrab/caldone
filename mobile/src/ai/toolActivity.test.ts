import assert from 'node:assert/strict';
import test from 'node:test';

import { userFacingToolActivity } from './toolActivity.ts';

test('tool activity accepts one short plain-text action and rejects unsafe display text', () => {
  assert.equal(userFacingToolActivity('Проверяю размер порции'), 'Проверяю размер порции');
  assert.equal(userFacingToolActivity('  Открываю блюдо  '), 'Открываю блюдо');
  assert.equal(userFacingToolActivity('**Думаю**'), undefined);
  assert.equal(userFacingToolActivity('Строка один\nСтрока два'), undefined);
  assert.equal(userFacingToolActivity('x'.repeat(81)), undefined);
  assert.equal(userFacingToolActivity(42), undefined);
});
