import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Open a short AppDialog first. Verify its expected message and action in Android's
// visible hierarchy; JS renderer tests cannot detect native scroll clipping.
const [message, action, directory = '../artifacts/app-dialog'] = process.argv.slice(2);
assert.ok(message && action, 'Usage: node scripts/check-app-dialog.mjs "message" "action" [output]');
const adb = process.env.ADB ?? (process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, 'platform-tools/adb') : 'adb');
const run = (...args) => execFileSync(adb, args, { maxBuffer: 8 * 1024 * 1024 });
const output = resolve(directory);
mkdirSync(output, { recursive: true });
run('shell', 'uiautomator', 'dump', '/sdcard/caldone-dialog-check.xml');
const xml = run('exec-out', 'cat', '/sdcard/caldone-dialog-check.xml').toString();
writeFileSync(join(output, 'hierarchy.xml'), xml);
writeFileSync(join(output, 'screen.png'), run('exec-out', 'screencap', '-p'));
const nodes = [...xml.matchAll(/<node\s+([^>]+)>/g)].map(([, attributes]) =>
  Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value])));
for (const text of [message, action]) {
  const node = nodes.find(node => node.text === text);
  assert.ok(node, `Dialog text must be visible: ${text}`);
  const [left, top, right, bottom] = node.bounds.match(/\d+/g).map(Number);
  assert.ok(right > left && bottom > top, `Dialog text must have visible bounds: ${text}`);
  console.log(`${text}: ${node.bounds}`);
}

// A short notice must fit without scrolling. Compare visible text bounds after
// a scroll gesture; merely finding the text also passes when it is clipped.
const scroll = nodes.find(node => node.class === 'android.widget.ScrollView');
assert.ok(scroll, 'The dialog scroll container must be visible');
const [left, top, right, bottom] = scroll.bounds.match(/\d+/g).map(Number);
run('shell', 'input', 'swipe', String(right - 5), String(bottom - 5), String(right - 5), String(top + 5), '300');
run('shell', 'uiautomator', 'dump', '/sdcard/caldone-dialog-check.xml');
const after = run('exec-out', 'cat', '/sdcard/caldone-dialog-check.xml').toString();
writeFileSync(join(output, 'after-scroll.xml'), after);
const beforeMessage = nodes.find(node => node.text === message);
const afterMessage = [...after.matchAll(/<node\s+([^>]+)>/g)]
  .map(([, attributes]) => Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value])))
  .find(node => node.text === message);
assert.equal(afterMessage?.bounds, beforeMessage.bounds, 'A short dialog message must fit without scrolling');
