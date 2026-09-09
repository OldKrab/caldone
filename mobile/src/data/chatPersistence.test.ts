import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Run the actual repositories against SQLite; only the Expo native bridge is replaced.
function repositories() {
  const sqlite = new DatabaseSync(':memory:');
  const bridge = {
    async execAsync(sql: string) { sqlite.exec(sql); },
    async runAsync(sql: string, ...args: any[]) { return sqlite.prepare(sql).run(...args); },
    async getFirstAsync(sql: string, ...args: any[]) { return sqlite.prepare(sql).get(...args); },
    async getAllAsync(sql: string, ...args: any[]) { return sqlite.prepare(sql).all(...args); },
  };
  const cache = new Map<string, any>();
  const nativeRequire = createRequire(import.meta.url);
  function load(path: string): any {
    if (cache.has(path)) return cache.get(path);
    const exports = {};
    cache.set(path, exports);
    const js = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    runInNewContext(js, { exports, require(name: string) {
      if (name === 'expo-sqlite') return { openDatabaseSync: () => bridge };
      if (name === 'expo-file-system') return {};
      if (name.startsWith('.')) return load(resolve(dirname(path), name.endsWith('.ts') ? name : name + '.ts'));
      return nativeRequire(name);
    }, Date, Math, Set, Map, console });
    return exports;
  }
  return { chat: load(resolve(import.meta.dirname, 'chatRepository.ts')), sqlite, load };
}

test('meal choices and assistant question results survive database round trips alongside legacy questions', async () => {
  const { chat, sqlite, load } = repositories();
  try {
    const meals = load(resolve(import.meta.dirname, 'mealRepository.ts'));
    await meals.initializeMeals();
    await chat.initializeChat();
    const questions = [{ question: 'How much?', options: ['100 g', '200 g'] }];
    const analysis = { title: 'Rice', mealType: 'lunch', items: [], totals: { calories: 0, protein: 0, carbs: 0, fat: 0 }, clarification: { questions: ['How much?'], choices: questions, impactCalories: 150 } };
    await meals.saveMealRecord({ id: 'meal-choices', revision: 1, capturedAt: 1, status: 'needs_input', note: '', photos: [], analysis });
    assert.deepEqual(JSON.parse(JSON.stringify((await meals.getMeal('meal-choices')).analysis.clarification)), analysis.clarification);
    await meals.saveMealRecord({ id: 'legacy', revision: 1, capturedAt: 1, status: 'needs_input', note: '', photos: [], analysis: { ...analysis, clarification: { question: 'Which sauce?', impactCalories: 120 } } });
    assert.equal((await meals.getMeal('legacy')).analysis.clarification.questions[0], 'Which sauce?');
    const thread = await chat.createChatThread();
    await chat.saveChatMessages(thread.id, [{ role: 'toolResult', toolCallId: 'ask-1', toolName: 'ask_question', timestamp: 1, isError: false, content: [{ type: 'text', text: 'Questions displayed' }], details: { questions } }]);
    assert.deepEqual(JSON.parse(JSON.stringify((await chat.loadChatMessages(thread.id))[0].details.questions)), questions);
  } finally { sqlite.close(); }
});

test('saving chat and synchronizing a meal question concurrently preserves both', async () => {
  const { chat, sqlite } = repositories();
  try {
    await chat.initializeChat();
    const thread = await chat.createChatThread();
    const message = { role: 'chatUser', text: 'No food here', attachments: [], timestamp: 1 };
    await Promise.all([
      chat.saveChatMessages(thread.id, [message]),
      chat.syncMealQuestionsToThread(thread.id, 'meal-1', ['Is this food?'], 2),
    ]);
    const messages = await chat.loadChatMessages(thread.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[0].text, 'No food here');
    assert.equal(messages[1].questions[0], 'Is this food?');
  } finally { sqlite.close(); }
});

test('agent snapshots retain questions appended outside the active session', async () => {
  const { chat, sqlite } = repositories();
  try {
    await chat.initializeChat();
    const thread = await chat.createChatThread();
    const user = { role: 'chatUser', text: 'Check it', attachments: [], timestamp: 1 };
    await chat.saveChatMessages(thread.id, [user]);
    await chat.syncMealQuestionsToThread(thread.id, 'meal-1', ['How much?'], 2);
    const reply = { role: 'assistant', content: [{ type: 'text', text: 'Please clarify' }], timestamp: 3 };
    await chat.saveChatMessages(thread.id, [user, reply]);
    await chat.saveChatMessages(thread.id, [user]);
    const messages = await chat.loadChatMessages(thread.id);
    assert.equal(messages.length, 3);
    assert.equal(messages[1].questions[0], 'How much?');
    assert.equal(messages[2].content[0].text, 'Please clarify');
  } finally { sqlite.close(); }
});

test('simultaneous question syncs and an inline answer keep one question and the answer', async () => {
  const { chat, sqlite } = repositories();
  try {
    await chat.initializeChat();
    const thread = await chat.createChatThread();
    await Promise.all([
      chat.syncMealQuestionsToThread(thread.id, 'meal-1', ['How much?'], 1),
      chat.syncMealQuestionsToThread(thread.id, 'meal-1', ['How much?'], 1),
      chat.appendInlineMealAnswer(thread.id, '30 grams', 2),
    ]);
    const messages = await chat.loadChatMessages(thread.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[0].questions[0], 'How much?');
    assert.equal(messages[1].text, '30 grams');
  } finally { sqlite.close(); }
});

test('failed transaction rolls back its changes without swallowing another repository write', async () => {
  const { chat, sqlite, load } = repositories();
  try {
    const meals = load(resolve(import.meta.dirname, 'mealRepository.ts'));
    const { transaction } = load(resolve(import.meta.dirname, 'database.ts'));
    await meals.initializeMeals();
    await chat.initializeChat();
    const failure = transaction(async (database: any) => {
      await database.runAsync("INSERT INTO preferences (key, value) VALUES ('failed', 'temporary')");
      throw new Error('forced failure');
    });
    const independent = meals.savePreference('survives', 'saved');
    await assert.rejects(failure, /forced failure/);
    await independent;
    assert.equal(await meals.getPreference('failed'), undefined);
    assert.equal(await meals.getPreference('survives'), 'saved');
    const thread = await chat.createChatThread();
    await chat.appendInlineMealAnswer(thread.id, 'Still working');
    assert.equal((await chat.loadChatMessages(thread.id))[0].text, 'Still working');
  } finally { sqlite.close(); }
});
