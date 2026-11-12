import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const tmp=mkdtempSync(join(tmpdir(),'nanjing-cache-'));
try {
 const result=await build({stdin:{contents:"export { Compositor } from './src/engine/compositor'; export { SUBTITLES, subtitleAt } from './src/overlay2d/subtitles';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
 const file=join(tmp,'test.mjs');writeFileSync(file,result.outputFiles[0].text);
 const {Compositor,SUBTITLES,subtitleAt}=await import(pathToFileURL(file));
 const compositor=new Compositor({});
 const canvas={width:1920,height:1080};
 const texture=compositor.texture(canvas,1);const initial=texture.version;
 assert.equal(compositor.texture(canvas,1).version,initial);
 assert.equal(compositor.texture(canvas,2).version,initial+1);
 assert.equal(compositor.texture(canvas).version,initial+2);
 assert.equal(compositor.texture(canvas).version,initial+3);
 let cached=null,updates=0;
 for(let frame=0;frame<5400;frame++) {
   const cue=subtitleAt(frame/60);const plated=cue?.plated?cue:null;
   if(plated&&plated!==cached){cached=plated;updates++;}
 }
 assert.equal(updates,4);
 for(const cue of SUBTITLES){assert.equal(subtitleAt(cue.start),cue);assert.notEqual(subtitleAt(cue.end),cue);}
 console.log(JSON.stringify({durationSeconds:90,baselineSubtitleCanvasRedraws:5400*3,cachedSubtitleCanvasRedraws:updates*3}));
 console.log('PASS unchanged revision skips upload; changed revision uploads; animated textures still upload; cue boundaries');
 compositor.dispose();
} finally {rmSync(tmp,{recursive:true,force:true});}
