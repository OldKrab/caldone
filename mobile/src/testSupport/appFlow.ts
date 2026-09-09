import { readFileSync, existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import type { Meal } from '../domain/meal';

/** Native/storage adapters and screen boundaries for testing the real App composition.
 * React owns state/effects; App owns navigation, draft timestamps and save arguments.
 * Screen props are the interaction boundary. This does not test native rendering.
 */
export function appFlow() {
  const state = { meals: [] as Meal[], onUrl: undefined as undefined | ((event: { url: string }) => void) };
  (globalThis as any).__mealDateFlow = state;
  const appUrl = new URL('../../App.tsx', import.meta.url).href;
  const asyncNoop = 'async () => undefined';
  const subscription = '() => ({ remove() {} })';
  const overrides: Record<string, string> = {
    useAppDialog: '() => ({ alert() {}, confirm: async () => true })',
    useSafeAreaInsets: '() => ({ top: 0, bottom: 0, left: 0, right: 0 })',
    StyleSheet: '{ create: value => value, hairlineWidth: 1 }',
    Pressable: 'props => typeof props.children === "function" ? props.children({ pressed: false }) : props.children',
    Platform: '{ OS: "android", select: values => values.android ?? values.default }',
    Easing: '{ bezier: () => value => value, out: fn => fn, cubic: value => value }',
    AppState: `{ currentState: 'active', addEventListener: ${subscription} }`,
    BackHandler: `{ addEventListener: ${subscription} }`,
    Linking: `{ getInitialURL: async () => null, addEventListener: (_, callback) => {
      globalThis.__mealDateFlow.onUrl = callback; return { remove() {} };
    } }`,
    getLastNotificationResponseAsync: 'async () => null',
    addNotificationResponseReceivedListener: subscription,
    getItemAsync: 'async () => "true"',
    isSignedIn: 'async () => true',
    subscribeMealActivity: '() => () => undefined',
    subscribeMealAnswers: '() => () => undefined',
    initializeMeals: asyncNoop, initializeChat: asyncNoop,
    finalizeExpiredClarifications: asyncNoop,
    getDailyGoals: 'async () => ({})', getGoalProfile: asyncNoop, getPreference: asyncNoop,
    listMeals: 'async () => [...globalThis.__mealDateFlow.meals]',
    saveMealRecord: 'async meal => { globalThis.__mealDateFlow.meals.push(meal); }',
    createMeal: `async input => {
      const meal = { ...input, revision: 1, status: 'queued' };
      globalThis.__mealDateFlow.meals.push(meal); return meal;
    }`,
    latestChatThread: 'async () => ({ id: "thread" })', listChatThreads: 'async () => []',
    applyNotificationPreferences: asyncNoop, registerMealBackgroundTask: asyncNoop,
    processPendingMeals: asyncNoop, processMeal: asyncNoop,
    Directory: 'class { create() {} }',
    File: 'class { uri = "file:///saved-photo.jpg"; exists = true; copy() {} delete() {} }',
    Paths: '{ document: "file:///documents", cache: "file:///cache" }',
  };
  const screen = (name: string) => JSON.stringify(name);
  const source = readFileSync(fileURLToPath(appUrl), 'utf8');
  const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const modules = new Map<string, string>();
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (specifier === 'react' || specifier.endsWith('.json') || /src\/(domain|design|navigation)\//.test(specifier) || specifier.endsWith('/i18n') || specifier.endsWith('/mealInput')) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    let names: string[];
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      names = specifier === 'expo-notifications'
        ? ['getLastNotificationResponseAsync', 'clearLastNotificationResponseAsync', 'addNotificationResponseReceivedListener']
        : specifier === 'expo-secure-store' ? ['getItemAsync', 'setItemAsync'] : ['shareAsync'];
    } else {
      names = clause.namedBindings && ts.isNamedImports(clause.namedBindings)
        ? clause.namedBindings.elements.filter(item => !item.isTypeOnly).map(item => (item.propertyName ?? item.name).text) : [];
    }
    if (specifier === 'react-native') names.push('Easing');
    modules.set(specifier, (modules.get(specifier) ?? '') + '\n' + names.map(name => {
      const value = overrides[name] ?? (/Screen$|Provider$|^(View|Text|Pressable|ActivityIndicator|StatusBar|Ionicons)$/.test(name)
        ? screen(name) : `() => { throw new Error('Unexpected adapter call: ${name}'); }`);
      return `export const ${name} = ${value};`;
    }).join('\n'));
  }
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if ((context.parentURL === appUrl || specifier === 'react-native') && modules.has(specifier)) {
        return { url: 'data:text/javascript,' + encodeURIComponent(modules.get(specifier)!), shortCircuit: true };
      }
      if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
        const url = new URL(specifier, context.parentURL);
        for (const suffix of ['.ts', '.tsx']) {
          if (existsSync(fileURLToPath(url) + suffix)) return next(url.href + suffix, context);
        }
      }
      return next(specifier, context);
    },
    load(url, context, next) {
      if (url === appUrl) return {
        format: 'module', shortCircuit: true,
        source: ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext } }).outputText,
      };
      // App's JSON import is supported by Metro without import attributes.
      if (url.endsWith('/app.json')) return { format: 'module', shortCircuit: true, source: `export default ${readFileSync(fileURLToPath(url), 'utf8')}` };
      return next(url, context);
    },
  });
  return { state, close() { hooks.deregister(); delete (globalThis as any).__mealDateFlow; } };
}
