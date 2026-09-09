import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Native UI regression check: open Assistant and focus its message field first.
// Use ANDROID_SERIAL to select a device and ADB/ANDROID_HOME to locate adb.
const adb = process.env.ADB ?? (process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, 'platform-tools/adb') : 'adb');
const output = resolve(process.argv[2] ?? '../artifacts/assistant-keyboard');
mkdirSync(output, { recursive: true });
const run = (...args) => execFileSync(adb, args, { maxBuffer: 8 * 1024 * 1024 });

run('shell', 'uiautomator', 'dump', '/sdcard/caldone-keyboard-check.xml');
const xml = run('exec-out', 'cat', '/sdcard/caldone-keyboard-check.xml').toString();
const window = run('shell', 'dumpsys', 'window').toString();
const ime = window.split('\n').find(line => /type=ime\b/.test(line) && /visible=true\b/.test(line));
assert.ok(ime, 'Open the keyboard before running this check');
const keyboardTop = Number(ime.match(/frame=\[\d+,(\d+)\]/)?.[1]);
assert.ok(Number.isFinite(keyboardTop), 'Android must report the keyboard frame');

const nodes = [...xml.matchAll(/<node\s+([^>]+)>/g)].map(([, attributes]) =>
  Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value])));
const controls = [
  ['Message field', nodes.find(node => node.class === 'android.widget.EditText')],
  ['Send', nodes.find(node => ['Send', 'Отправить'].includes(node['content-desc']))],
].map(([name, node]) => {
  assert.ok(node, `${name} must be visible in the Assistant screen`);
  const bounds = node.bounds.match(/\d+/g).map(Number);
  assert.equal(bounds.length, 4);
  assert.ok(bounds[2] > bounds[0] && bounds[3] > bounds[1], `${name} must have a touch target`);
  return { name, bounds, clearance: keyboardTop - bounds[3] };
});

writeFileSync(join(output, 'screen.png'), run('exec-out', 'screencap', '-p'));
writeFileSync(join(output, 'hierarchy.xml'), xml);
writeFileSync(join(output, 'keyboard-insets.txt'), ime.trim() + '\n');
writeFileSync(join(output, 'measurements.json'), JSON.stringify({ keyboardTop, controls }, null, 2) + '\n');
for (const control of controls) console.log(`${control.name}: ${control.clearance}px clear of the keyboard`);
assert.ok(controls.every(control => control.clearance >= 0), 'The keyboard covers part of an Assistant control');
