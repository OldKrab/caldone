import assert from 'node:assert/strict';
import test from 'node:test';
import { submitMealAnswer, subscribeMealAnswers } from './mealAnswerSubmission.ts';
import { buildActivityFeed } from '../features/chat/activityFeed.ts';

const messages:any[]=[{role:'mealQuestion',mealId:'meal',questions:['How much?','Which sauce?'],timestamp:1},{role:'chatUser',text:'All of it',attachments:[],timestamp:2}];
test('submission retains both question and answer during work and on failure', async () => {
  let submitting:ReadonlySet<string>=new Set();
  const unsubscribe=subscribeMealAnswers(value=>{submitting=value});
  const render=()=>buildActivityFeed({messages,actions:[],busy:true,pendingMealQuestions:{meal:['How much?','Which sauce?']},answeringMealIds:submitting});
  let fail!:(error:Error)=>void;
  const work=new Promise<void>((_,reject)=>{fail=reject});
  const submitted=submitMealAnswer('meal',()=>work);
  assert.equal(render().length,2);
  assert.equal(submitting.has('meal'),true);
  assert.equal((render()[1] as any).message.text,'All of it');
  fail(Error('offline'));
  await assert.rejects(submitted,/offline/);
  assert.equal(render().length,2);
  unsubscribe();
});

test('after submission succeeds answered questions remain in the transcript', async () => {
  let submitting:ReadonlySet<string>=new Set();
  const unsubscribe=subscribeMealAnswers(value=>{submitting=value});
  let pending=['How much?','Which sauce?'];
  await submitMealAnswer('meal',async()=>{pending=['Which sauce?']});
  const rendered=buildActivityFeed({messages,actions:[],busy:false,pendingMealQuestions:{meal:pending},answeringMealIds:submitting});
  assert.deepEqual((rendered[0] as any).message.questions,['How much?','Which sauce?']);
  assert.equal(submitting.size,0);
  assert.equal(messages[0].questions.length,2,'durable history stays intact');
  unsubscribe();
});
