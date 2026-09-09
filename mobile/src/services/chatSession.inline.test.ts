import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setMealActivity } from './mealActivity.ts';

// Substitute native storage and provider boundaries, retaining the real session lifecycle.
const fixture = { messages: [{ role: 'chatUser', text: 'Everything shown', attachments: [], timestamp: 1 }] as any[], saved: [] as any[], prompts: 0, failPrompt: false, continued: [] as any[] };
(globalThis as any).__inlineFixture = fixture;
const sources: Record<string, string> = {
  './foregroundRecovery': 'export const waitForConnectionRecovery=async()=>{};',
  './foregroundWork': 'export const beginForegroundWork=async()=>async()=>{};',
  'react-native': 'export const AppState={currentState:"active"};',
  'expo-file-system': 'export class File {}',
  '../ai/piClient': `export async function createChatAgent({messages}) {
    return {state:{messages,isStreaming:false}, replaceMessages(messages){this.state.messages=messages},
      subscribe(listener){globalThis.__inlineFixture.listener=listener;return ()=>{}}, abort(){globalThis.__inlineFixture.aborts=(globalThis.__inlineFixture.aborts||0)+1}, async waitForIdle(){}, async prompt(message){
        const f=globalThis.__inlineFixture; f.prompts++;
        if(f.hold){this.state.messages.push(message);await f.hold;this.state.messages.push({role:'assistant',content:[{type:'text',text:'Updated to 350 g'}],stopReason:'stop'});return;}
        if(f.failPrompt){
          this.state.messages.push(message,{role:'toolResult',toolCallId:'already-saved',content:[]},
            {role:'assistant',stopReason:'error',errorMessage:'Software caused connection abort'});
          this.state.errorMessage='Software caused connection abort';
        }
      }, async continue(){globalThis.__inlineFixture.continued=[...this.state.messages]; this.state.errorMessage=undefined;}};
  } export const getThinkingLevel=async()=>null; export const getWebSearchEnabled=async()=>false;`,
  '../ai/chatTools': 'export const createCalDoneTools=()=>[];',
  '../ai/chatPrompt': 'export const buildChatPrompt=()=>""; export const CHAT_PROMPT_VERSION="test";',
  '../data/chatRepository': `export const loadChatMessages=async()=>[...globalThis.__inlineFixture.messages];
    export const listChatActions=async()=>[]; export const sanitizeChatMessage=x=>x;
    export const saveChatMessages=async(_id,messages)=>{globalThis.__inlineFixture.saved=messages};
    export const getChatAction=async()=>null; export const markChatActionUndone=async()=>{};
    export const renameChatThread=async()=>{};`,
  '../data/mealRepository': ['appendDiagnosticEvent','deleteMeal','getDailyGoals','getGoalProfile','getMeal','getPreference','removePreference','replaceMeal','saveDailyGoals','saveGoalProfile'].map(n=>`export const ${n}=async()=>null;`).join('\n'),
  '../i18n': 'export const locale="en";',
};
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (sources[specifier]) return {url:'data:text/javascript,'+encodeURIComponent(sources[specifier]),shortCircuit:true};
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const url=new URL(specifier+'.ts',context.parentURL);
    if (existsSync(fileURLToPath(url))) return next(url.href,context);
  }
  return next(specifier,context);
}});
const { openChatSession } = await import('./chatSession.ts');

test('opening chat during an inline answer shows meal work and reloads subsequent questions', async () => {
  setMealActivity('meal-inline', 'reviewing_meal');
  const snapshots: any[]=[];
  const session=await openChatSession({
    thread:{id:'thread-inline',mealId:'meal-inline',title:'Meal',purpose:'clarification',createdAt:1,updatedAt:1},
    selectedMealId:'meal-inline', onChanged:s=>snapshots.push(s), onDataChanged:async()=>{},
  });
  try {
    assert.equal(snapshots.at(-1).mealActivity, 'reviewing_meal');
    await session.send('Another answer', []);
    assert.equal(fixture.prompts, 0, 'do not start a competing chat turn during inline analysis');
    fixture.messages.push({role:'mealQuestion',questions:['How much sauce?'],timestamp:2});
    setMealActivity('meal-inline');
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(snapshots.at(-1).mealActivity, undefined);
    assert.equal(snapshots.at(-1).messages.at(-1).questions[0], 'How much sauce?');
  } finally {
    await session.close();
    setMealActivity('meal-inline');
    hooks.deregister();
  }
  assert.equal(fixture.saved.length, 0, 'an idle viewing session must not overwrite processor-owned messages');
});

test('chat automatically resumes a failed response without resending the user or completed tools', async () => {
  fixture.messages=[];
  fixture.prompts=0;
  fixture.failPrompt=true;
  const snapshots:any[]=[];
  const session=await openChatSession({
    thread:{id:'thread-recovery',title:'Meal',purpose:'meal',createdAt:1,updatedAt:1},
    onChanged:s=>snapshots.push(s),onDataChanged:async()=>{},
  });
  try {
    await session.send('Update meal',[]);
    assert.equal(fixture.prompts,1);
    assert.deepEqual(fixture.continued.map(m=>m.role),['chatUser','toolResult']);
    assert.equal(fixture.continued.at(-1).toolCallId,'already-saved');
    assert.equal(snapshots.at(-1).busy,false);
    assert.equal(snapshots.at(-1).error,undefined);
  } finally {await session.close();}
});


test('execution events distinguish running, completed, and cancelled actions', async () => {
  fixture.messages=[];
  const snapshots:any[]=[];
  const session=await openChatSession({
    thread:{id:'thread-activity',title:'Meal',purpose:'meal',createdAt:1,updatedAt:1},
    onChanged:s=>snapshots.push(s),onDataChanged:async()=>{},
  });
  const event=(value:any)=>(fixture as any).listener(value);
  try {
    event({type:'tool_execution_start',toolCallId:'a',args:{statusText:'Read meal'}});
    assert.equal(snapshots.at(-1).toolExecutions.a.status,'running');
    event({type:'tool_execution_end',toolCallId:'a',isError:false});
    assert.equal(snapshots.at(-1).toolExecutions.a.status,'completed');
    event({type:'tool_execution_start',toolCallId:'b',args:{statusText:'Update meal'}});
    session.abort();
    event({type:'tool_execution_end',toolCallId:'b',isError:true});
    assert.equal(snapshots.at(-1).toolExecutions.b.status,'cancelled');
  } finally {await session.close();}
});

test('leaving and reopening chat retains the pending turn and its eventual answer', async () => {
  fixture.messages=[]; fixture.failPrompt=false; fixture.prompts=0;
  let finish!:()=>void;
  (fixture as any).hold=new Promise<void>(resolve=>{finish=resolve});
  const input={thread:{id:'thread-navigation',title:'Meal',purpose:'meal' as const,createdAt:1,updatedAt:1},onDataChanged:async()=>{}};
  const original=await openChatSession({...input,onChanged:()=>{}});
  const turn=original.send('Actually 350 g',[]);
  await new Promise(resolve=>setImmediate(resolve));
  const aborts=(fixture as any).aborts||0;
  await original.close();
  assert.equal((fixture as any).aborts||0,aborts,'leaving the screen must not cancel inference');
  const snapshots:any[]=[];
  const reopened=await openChatSession({...input,onChanged:s=>snapshots.push(s)});
  assert.equal(snapshots.at(-1).busy,true);
  finish(); await turn;
  assert.equal(fixture.prompts,1);
  assert.equal(snapshots.at(-1).messages.at(-1).content[0].text,'Updated to 350 g');
  assert.equal(snapshots.at(-1).busy,false);
  (fixture as any).hold=undefined;
  await reopened.close();
});

test('completed analysis replies use the app receipt before display and diagnostics', async () => {
  fixture.messages=[
    {role:'chatUser',text:'Google it',attachments:[],timestamp:1},
    {role:'toolResult',toolName:'answer_meal_question',toolCallId:'saved',isError:false,content:[],details:{value:{confirmation:'Recorded estimate. Web search was unavailable.'}}},
  ];
  const session=await openChatSession({thread:{id:'thread-confirmation',title:'Meal',createdAt:1,updatedAt:1},onChanged:()=>{},onDataChanged:async()=>{}});
  try {
    const message:any={role:'assistant',content:[{type:'text',text:'Exact nutrition was not found online.'}],stopReason:'stop',provider:'test',model:'test'};
    (fixture as any).listener({type:'message_end',message});
    assert.deepEqual(message.content,[{type:'text',text:'Recorded estimate. Web search was unavailable.'}]);
  } finally { await session.close(); }
});
