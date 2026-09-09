import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCameraLenses, chooseZoom, zoomStops } from './cameraZoom.ts';

test('0.6x selects the exposed ultrawide lens and 2x uses the main camera', () => {
  const lenses=parseCameraLenses([JSON.stringify({id:'main',scale:1,min:1,max:8,primary:true}),JSON.stringify({id:'ultra',scale:0.6,min:1,max:4,primary:false})]);
  assert.deepEqual(zoomStops(lenses),[0.6,1,2]);
  assert.equal(chooseZoom(lenses,0.6)?.id,'ultra');
  assert.equal(chooseZoom(lenses,2)?.id,'main');
  assert.equal(chooseZoom(lenses,2)?.zoom,0.25);
});

test('logical-camera zoom below 1x is supported without inventing an ultrawide lens',()=>{
  const lenses=parseCameraLenses([JSON.stringify({id:'main',scale:1,min:0.6,max:8,primary:true})]);
  assert.equal(chooseZoom(lenses,0.6)?.zoom,0.075);
  assert.deepEqual(zoomStops(parseCameraLenses(['invalid','builtInWideAngleCamera'])),[]);
  assert.deepEqual(zoomStops([{id:'main',scale:1,min:1,max:1,primary:true}]),[1]);
});
