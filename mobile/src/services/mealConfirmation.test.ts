import assert from 'node:assert/strict';
import test from 'node:test';
import { mealConfirmation, confirmationForTurn } from './mealConfirmation.ts';

const meal:any={analysis:{title:'Spritz',items:[{name:'Spritz',quantity:'500 ml'}],totals:{calories:200,protein:0,carbs:50,fat:0}}};
test('confirmation uses the observed outcome and never converts no search to no online match',()=>{
  const text=mealConfirmation(meal,'en');
  assert.match(text,/200 kcal/);
  assert.match(text,/50 g/);
  assert.match(text,/not searched/i);
  assert.doesNotMatch(text,/not found/i);
  meal.analysis.research={status:'unavailable',sources:[]};
  assert.match(mealConfirmation(meal,'ru'),/недоступен/);
  meal.analysis.research={status:'completed',sources:[{url:'https://example.org/drink',title:'Product'}]};
  assert.match(mealConfirmation(meal,'en'),/https:\/\/example.org\/drink/);
  assert.match(mealConfirmation(meal,'en'),/estimate/i);
});
test('only app-owned successful analysis receipts can supply the final confirmation for this turn',()=>{
  const messages:any[]=[{role:'chatUser',text:'All of it'}, {role:'toolResult',toolName:'answer_meal_question',isError:false,details:{value:{confirmation:'Recorded estimate'}}}];
  assert.equal(confirmationForTurn(messages),'Recorded estimate');
  messages.push({role:'chatUser',text:'Why?'});
  assert.equal(confirmationForTurn(messages),undefined);
});
