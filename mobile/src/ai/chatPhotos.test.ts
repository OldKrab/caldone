import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, client, meals, savedMeal } from '../testing/mealAgentTestContext.ts';
const { createChatAgent } = client;
const photo = btoa('saved meal photo');
fixture.photos.set('/meal-photo', photo);
let meal = await savedMeal('m');
await meals.replaceMeal({...meal,photos:[{id:'p',uri:'/meal-photo',mimeType:'image/jpeg',createdAt:1}]});
meal = (await meals.getMeal('m'))!;
const originalPhoto={type:'image',data:photo,mimeType:'image/jpeg'};
const photoReceipt:any={role:'toolResult',toolCallId:'photo',toolName:'view_meal_photos',isError:false,
  content:[{type:'text',text:'[Meal photo was shown to the assistant.]'}],details:{mealId:'m',photoIds:['p']},timestamp:1};
const imageBlocks=(payload:any):any[]=>{
  if(!payload||typeof payload!=='object')return [];
  return [...(payload.type==='input_image'?[payload]:[]),...Object.values(payload).flatMap(imageBlocks)];
};
async function askWithReceipt(receipt:any){
  const agent=await createChatAgent({systemPrompt:'Identify the saved photo',messages:[receipt],tools:[],sessionId:'photo-test'});
  await agent.prompt('Look at it again');
  assert.equal(agent.state.errorMessage,undefined);
  return fixture.requests.at(-1);
}
test('a follow-up request restores a previously viewed meal photo after chat history was sanitized',async()=>{
  const payload=await askWithReceipt(photoReceipt);
  assert.deepEqual(imageBlocks(payload).map(x=>x.image_url),['data:image/jpeg;base64,'+photo]);
  assert.deepEqual(photoReceipt.content,[{type:'text',text:'[Meal photo was shown to the assistant.]'}], 'request hydration must not put image bytes into saved history');
});

test('only the previously opened photo IDs are restored, not other photos on the meal',async()=>{
  await meals.replaceMeal({...meal,photos:[...meal.photos,{id:'other',uri:'/other',mimeType:'image/jpeg',createdAt:1}]});
  fixture.photos.set('/other',photo);
  const payload=await askWithReceipt(photoReceipt);
  assert.equal(imageBlocks(payload).length,1);
  await meals.replaceMeal(meal);
});

test('missing files and deleted meals produce an honest notice without aborting chat',async()=>{
  try {
    for(const missingMeal of [false,true]) {
      fixture.photos.delete('/meal-photo');
      if(missingMeal)await meals.deleteMeal(meal.id);
      const payload=await askWithReceipt(photoReceipt);
      assert.equal(imageBlocks(payload).length,0);
      assert.match(JSON.stringify(payload.input),/no longer available/);
      assert.doesNotMatch(JSON.stringify(payload.input),/Meal photo was shown/);
    }
  } finally {fixture.photos.set('/meal-photo',photo);await meals.saveMealRecord(meal);}
});

test('a fresh tool result keeps its image without adding a second copy',async()=>{
  const payload=await askWithReceipt({...photoReceipt,content:[originalPhoto]});
  assert.equal(imageBlocks(payload).length,1);
});
