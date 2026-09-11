import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createAppDialogController } from '../../components/appDialogController.ts';
import * as recovery from '../../services/connectionRecovery.ts';

// Exercise real controls, substituting only native hosts, clipboard, and context.
function render(language: string, error: string, disabled = false) {
  const dialog = createAppDialogController();
  const copied: string[] = [];
  let retries = 0;
  const jsx = (type: any, props: any) => ({ type, props });
  const exports: any = {};
  const js = ts.transpileModule(readFileSync(new URL('./AssistantError.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(js, { exports, require(name: string) {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react-native') return {
      Text: 'Text', View: 'View', Pressable: 'Pressable',
      StyleSheet: { create: (value: any) => value }, Clipboard: { setString: (value: string) => copied.push(value) },
    };
    if (name === '@expo/vector-icons') return { Ionicons: 'Icon' };
    if (name.endsWith('/AppDialog')) return { useAppDialog: () => dialog };
    if (name.endsWith('/connectionRecovery')) return recovery;
    if (name.endsWith('/i18n')) return { locale: language, t: () => language === 'ru' ? 'Закрыть' : 'Close' };
    if (name.endsWith('/tokens')) return { color: {}, space: { sm: 8 } };
    throw new Error(name);
  } });
  return { tree: exports.AssistantError({ error, retryDisabled: disabled, onRetry: () => retries++ }), dialog, copied, retries: () => retries };
}
function nodes(tree: any, type: string): any[] {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, type));
  return [...(tree.type === type ? [tree] : []), ...nodes(tree.props?.children, type)];
}

test('details open on demand, copy literal sanitized text, and leave retry independent', () => {
  for (const language of ['en', 'ru']) {
    const error = '<html>request req-test</html>\nAuthorization: Bearer secret';
    const view = render(language, error);
    assert.equal(view.dialog.current(), undefined);
    assert.doesNotMatch(JSON.stringify(view.tree), /<html>|req-test|secret/);
    const buttons = nodes(view.tree, 'Pressable');
    const details = buttons.find(button => nodes(button, 'Text').some(text => text.props.children === (language === 'ru' ? 'Подробнее' : 'Show details')));
    assert.ok(details);
    details.props.onPress();
    assert.equal(view.dialog.current()?.message, '<html>request req-test</html>\n[redacted]');
    assert.equal(view.dialog.current()?.actions[0].label, language === 'ru' ? 'Скопировать подробности' : 'Copy details');
    view.dialog.choose(0);
    assert.deepEqual(view.copied, ['<html>request req-test</html>\n[redacted]']);
    assert.equal(view.retries(), 0);
    buttons.find(button => button !== details).props.onPress();
    assert.equal(view.retries(), 1);
    const busy = render(language, error, true);
    assert.equal(nodes(busy.tree, 'Pressable').filter(button => button.props.disabled).length, 1);
  }
});
