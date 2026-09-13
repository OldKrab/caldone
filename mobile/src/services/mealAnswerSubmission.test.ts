import assert from 'node:assert/strict';
import test from 'node:test';
import { submitMealAnswer, subscribeMealAnswers } from './mealAnswerSubmission.ts';
import { buildActivityFeed } from '../features/chat/activityFeed.ts';

const messages:any[]=[{role:'mealQuestion',mealId:'meal',questions:['How much?','Which sauce?'],timestamp:1},{role:'chatUser',text:'All of it',attachments:[],timestamp:2}];
test('submission hides the question immediately, retains the answer and restores questions on failure', async () => {
  let submitting:ReadonlySet<string>=new Set();
  const unsubscribe=subscribeMealAnswers(value=>{submitting=value});
  const render=()=>buildActivityFeed({messages,actions:[],busy:submitting.size>0,pendingMealQuestions:{meal:['How much?','Which sauce?']},answeringMealIds:submitting});
  let fail!:(error:Error)=>void;
  const work=new Promise<void>((_,reject)=>{fail=reject});
  const submitted=submitMealAnswer('meal',()=>work);
  try {
    assert.deepEqual(render().map(item=>item.kind),['message','message','progress']);
    assert.equal((render()[1] as any).message.text,'All of it');
    assert.deepEqual((render()[0] as any).activeQuestions,[]);
    fail(Error('offline'));
    await assert.rejects(submitted,/offline/);
    assert.equal(render().length,2);
  } finally { fail(Error('offline')); await submitted.catch(()=>undefined); unsubscribe(); }
});

test('after submission succeeds only remaining questions return', async () => {
  let submitting:ReadonlySet<string>=new Set();
  const unsubscribe=subscribeMealAnswers(value=>{submitting=value});
  let pending=['How much?','Which sauce?'];
  await submitMealAnswer('meal',async()=>{pending=['Which sauce?']});
  const rendered=buildActivityFeed({messages,actions:[],busy:false,pendingMealQuestions:{meal:pending},answeringMealIds:submitting});
  assert.deepEqual((rendered[0] as any).activeQuestions,['Which sauce?']);
  assert.equal(messages[0].questions.length,2,'durable history stays intact');
  unsubscribe();
});
