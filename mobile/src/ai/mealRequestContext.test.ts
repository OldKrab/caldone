import assert from 'node:assert/strict';
import test from 'node:test';
import { mealRequestContext } from './mealRequestContext.ts';
import { buildMealClarificationContent } from './mealClarificationContent.ts';

test('the original search request survives clarification without promoting model claims to user evidence', () => {
  const context=mealRequestContext([
    {role:'chatUser',text:'Погугли, всю выпил'},
    {role:'assistant',content:[{type:'text',text:'Please clarify'}]},
    {role:'chatUser',text:'ВСЮ БУТЫЛКУ ВЫПИЛ, КАЛ ГУГЛИ'},
  ] as any, 'Confirmed online: 200 kcal');
  assert.equal(context.requireSearch,true);
  const content=buildMealClarificationContent({previousJson:'{}',question:'How much?',answer:context.userMessages.join('\n'),photos:[],assistantInterpretation:context.assistantInterpretation});
  const payload=JSON.parse((content[0] as {text:string}).text);
  assert.equal(payload.userAnswer,'Погугли, всю выпил\nВСЮ БУТЫЛКУ ВЫПИЛ, КАЛ ГУГЛИ');
  assert.equal(payload.assistantInterpretation,'Confirmed online: 200 kcal');
});

test('completed meal work bounds the next request and a search opt-out is respected', () => {
  const context=mealRequestContext([
    {role:'chatUser',text:'Google it'},
    {role:'toolResult',toolName:'answer_meal_question',isError:false},
    {role:'chatUser',text:"Don't search. Change the portion to half."},
  ] as any);
  assert.equal(context.requireSearch,false);
  assert.deepEqual(context.userMessages,["Don't search. Change the portion to half."]);
});

test('one user request remains available to every meal tool in the same turn', () => {
  const context=mealRequestContext([
    {role:'chatUser',text:'Google both drinks and update both meals'},
    {role:'toolResult',toolName:'reanalyze_meal',isError:false},
  ] as any);
  assert.deepEqual(context.userMessages,['Google both drinks and update both meals']);
  assert.equal(context.requireSearch,true);
});


test('a failed research attempt only constrains retries of the same meal in the same turn', () => {
  const messages: any[] = [
    {role: 'chatUser', text: 'Recalculate both meals'},
    {role: 'assistant', content: [{type: 'toolCall', id: 'attempt', name: 'reanalyze_meal', arguments: {mealId: 'rice', requireSearch: true}}]},
    {role: 'toolResult', toolCallId: 'attempt', toolName: 'reanalyze_meal', isError: true},
  ];
  assert.equal(mealRequestContext(messages, undefined, false, 'rice').requireSearch, true);
  assert.equal(mealRequestContext(messages, undefined, false, 'eggs').requireSearch, false);
  messages.push({role: 'chatUser', text: "Don't search. Just change the portion."});
  assert.equal(mealRequestContext(messages, undefined, false, 'rice').requireSearch, false);
});
