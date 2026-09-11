import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
// Render the real screen JSX with native host views and local hooks substituted.
// Assertions inspect visible elements, not source strings or implementation helpers.
function screen(name: 'HomeScreen' | 'MealDetailScreen') {
  const cache = new Map<string, any>();
  const state: any[] = [];
  let cursor = 0;
  const jsx = (type: any, props: any, key: any) => ({ type, props, key });
  const react = {
    useState(initial: any) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], (next: any) => {
        state[index] = typeof next === 'function' ? next(state[index]) : next;
      }];
    },
    useEffect() {},
  };
  const hosts = (overrides: Record<string, any>) => new Proxy(overrides, {
    get: (target, key) => target[key as string] ?? key,
  });
  const native = hosts({
    StyleSheet: { create: (value: any) => value, hairlineWidth: 1 },
    Platform: { OS: 'android' },
    Easing: { out: (value: any) => value, cubic() {} },
    useWindowDimensions: () => ({ width: 360, height: 800, fontScale: 1 }),
  });
  const nativeRequire = createRequire(import.meta.url);
  const load = (path: string): any => {
    if (cache.has(path)) return cache.get(path);
    const exports: any = {};
    cache.set(path, exports);
    const js = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    runInNewContext(js, { exports, Date, Intl, Map, Set, JSON, console, require(specifier: string) {
      if (specifier === 'react') return react;
      if (specifier === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (specifier === 'react-native') return native;
      if (specifier.endsWith('/MealProgress')) {
        return { ...load(resolve(dirname(path), specifier + '.tsx')), MealProgress: 'MealProgress' };
      }
      if (specifier.includes('components/')) return hosts({ useAppDialog: () => ({ show() {} }) });
      if (specifier.startsWith('expo-')) return {};
      if (specifier === '@expo/vector-icons') return { Ionicons: 'Icon' };
      if (specifier === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
      if (specifier.startsWith('.')) {
        const file = resolve(dirname(path), specifier);
        return load(existsSync(file) ? file : file + '.ts');
      }
      return nativeRequire(specifier);
    } });
    return exports;
  };
  const path = resolve(import.meta.dirname, name === 'HomeScreen' ? '../home/HomeScreen.tsx' : 'MealDetailScreen.tsx');
  const component = load(path)[name];
  return (props: any) => { cursor = 0; return component(props); };
}

function nodes(tree: any, type: string): any[] {
  if (!tree || typeof tree !== 'object')
      return [];
  if (Array.isArray(tree))
      return tree.flatMap(value => nodes(value, type));
  if ([tree.props?.style].flat().some((style: any) => style?.display === 'none'))
      return [];
  return [...(tree.type === type ? [tree] : []), ...nodes(tree.props?.children, type)];
}
const meal: any = { id: 'meal', capturedAt: 1, note: 'Lasagna', status: 'needs_input', photos: [], analysis: { title: 'Meal', mealType: 'snack', items: [], totals: { calories: 100, protein: 1, carbs: 10, fat: 2 }, clarification: { questions: ['How much?'], impactCalories: 200 } } };
const props: any = { meal, units: { energy: 'kcal', weight: 'g' }, onBack() { }, onAnswer: async () => { }, onDelete() { }, onAskAssistant() { }, onSave: async () => { } };
test('meal question form disappears immediately after submitting and returns on failure', async () => {
  const render = screen('MealDetailScreen');
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((_, fail) => { reject = fail; });
  const input = { ...props, onAnswer: () => pending };
  const form = nodes(render(input), 'QuestionAnswers')[0];
  assert.ok(form);
  const submission = form.props.onSubmit('I do not know');
  assert.equal(nodes(render(input), 'QuestionAnswers').length, 0);
  reject(Error('offline'));
  await assert.rejects(submission, /offline/);
  assert.equal(nodes(render(input), 'QuestionAnswers').length, 1);
});
test('answering meal remains in the journal and opens the same record', () => {
  const render = screen('HomeScreen');
  let opened: any;
  const tree = render({ meals: [meal], activities: new Map(), answeringMealIds: new Set([meal.id]), goals: {}, units: props.units, day: 1, canGoNext: false, onOpen: (value: any) => { opened = value; } });
  const row = nodes(tree, 'Pressable').find(node => nodes(node, 'Text').some(text => text.props.children === 'Meal'));
  assert.ok(row, 'meal must remain visible while its answer is processing');
  row.props.onPress();
  assert.equal(opened, meal);
});
test('persisted processing hides stale questions and labels existing estimate unfinished', () => {
  const tree = screen('MealDetailScreen')({ ...props, meal: { ...meal, status: 'analyzing' } });
  assert.equal(nodes(tree, 'QuestionAnswers').length, 0);
  assert.equal(nodes(tree, 'MealProgress').length, 1);
  assert.equal(nodes(tree, 'MealProgress')[0].props.compact, true);
  assert.equal(nodes(tree, 'Text')[0].props.children, 'Meal');
  const buttons = nodes(tree, 'PrimaryButton');
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].props.label, 'Edit or discuss');
  assert.equal(Boolean(buttons[0].props.disabled), false, 'meal conversation remains available');
  assert.equal(buttons[1].props.label, 'Add food or drink');
  assert.equal(buttons[1].props.disabled, true, 'food cannot be appended during analysis');
});

test('meal footer exposes conversation and addition as matching buttons with distinct actions', () => {
  const opened: string[] = [];
  const tree = screen('MealDetailScreen')({ ...props,
    meal: { ...meal, status: 'complete', analysis: { ...meal.analysis, clarification: undefined } },
    onAskAssistant: () => opened.push('conversation'),
    onAddDish: () => opened.push('addition'),
  });
  const buttons = nodes(tree, 'PrimaryButton');
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].props.label, 'Edit or discuss');
  assert.equal(buttons[1].props.label, 'Add food or drink');
  assert.equal(buttons[1].props.variant, 'outlined');
  assert.equal(buttons[1].props.disabled, false);
  buttons[0].props.onPress();
  buttons[1].props.onPress();
  assert.deepEqual(opened, ['conversation', 'addition']);
});
