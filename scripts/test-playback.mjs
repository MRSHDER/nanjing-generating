import assert from 'node:assert/strict';
import { playbackProfile, AudioFramePacer } from '../src/engine/playback.ts';
const tablet = playbackProfile({quality:'auto',mobile:true,viewportWidth:1366,explicitScale:null});
const phone = playbackProfile({quality:'auto',mobile:true,viewportWidth:390,explicitScale:null});
const desktop = playbackProfile({quality:'auto',mobile:false,viewportWidth:1920,explicitScale:null});
assert.deepEqual(tablet,{scale:2/3,fps:30,preserveDrawingBuffer:false});
assert.equal(phone.scale,0.5);
assert.deepEqual(desktop,{scale:1,fps:60,preserveDrawingBuffer:true});
assert.deepEqual(playbackProfile({quality:'original',mobile:true,viewportWidth:390,explicitScale:null}),desktop);
assert.deepEqual(playbackProfile({quality:'smooth',mobile:true,viewportWidth:390,explicitScale:2}),{scale:2,fps:60,preserveDrawingBuffer:true});
for (const hz of [60,120]) {
 for (const fps of [30,60]) {
  const p=new AudioFramePacer();let count=0;
  for(let i=0;i<hz*10;i++) if(p.shouldRender(i/hz,fps))count++;
  assert.equal(count,10*fps);
  console.log(JSON.stringify({simulationSeconds:10,displayHz:hz,beforeRenders:hz*10,afterRenders:count,targetFps:fps}));
 }
}
const p=new AudioFramePacer();assert.equal(p.shouldRender(0,30),true);assert.equal(p.shouldRender(0,30),false);assert.equal(p.shouldRender(20,30),true);assert.equal(p.shouldRender(1,30),true);p.reset();assert.equal(p.shouldRender(1,30),true);
console.log('PASS profiles, explicit export scale, duplicate frames, clock jumps, seek/reset');
