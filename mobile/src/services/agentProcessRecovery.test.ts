import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

test('a fresh process recovers a committed meal tool without duplicate input or mutation',()=>{
  const database=join(mkdtempSync(join(tmpdir(),'caldone-recovery-')),'meal.sqlite');
  const script=fileURLToPath(new URL('../testing/agentCrashProcess.ts',import.meta.url));
  const crashed=spawnSync(process.execPath,[script,database,'crash'],{encoding:'utf8',timeout:15000});
  assert.equal(crashed.status,86,crashed.stderr);
  const resumed=spawnSync(process.execPath,[script,database,'resume'],{encoding:'utf8',timeout:15000});
  assert.equal(resumed.status,0,resumed.stderr);
  const result=JSON.parse(resumed.stdout.trim());
  assert.equal(result.calories,130);
  assert.equal(result.revision,2,'the committed estimate must not be saved a second time');
  assert.equal(result.users,1);
  assert.equal(result.actions,1);
  assert.equal(result.requests,1,'resume from the committed tool result, not the original user request');
  assert.match(result.restoredResult,/"success":true/);
});
