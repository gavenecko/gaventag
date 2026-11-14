import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTagCsv, decodePredictions, chooseRating, selectTags, buildPrompt, normalizeTag, imageDataToBgr, formatTag} from '../core.js';

test('parse original CSV order and categories',()=>{
  const labels=parseTagCsv('tag_id,name,category,count\n' + Array.from({length:1100},(_,i)=>`${i},tag_${i},${i<4?9:i<900?0:4},100`).join('\n'));
  assert.equal(labels.length,1100); assert.equal(labels[4].name,'tag_4'); assert.equal(labels[1099].category,4);
});
test('reject missing or corrupted CSV',()=>assert.throws(()=>parseTagCsv('id,name\n1,girl')));
test('tag ranking, category threshold, exclusion and character switch',()=>{
  const labels=[{name:'general',category:9},{name:'1girl',category:0},{name:'blue_hair',category:0},{name:'focal_character',category:4}];
  const preds=decodePredictions(Float32Array.from([.91,.97,.36,.86]),labels);
  assert.equal(chooseRating(preds).name,'general');
  assert.deepEqual(selectTags(preds,{generalThreshold:.35,characterThreshold:.85}).map(x=>x.name),['1girl','focal_character','blue_hair']);
  assert.deepEqual(selectTags(preds,{generalThreshold:.35,characterThreshold:.9,excluded:new Set(['1girl'])}).map(x=>x.name),['blue_hair']);
  assert.equal(selectTags(preds,{includeCharacters:false}).length,2);
  assert.throws(()=>decodePredictions([.1],labels));
});
test('prompt output and weighting',()=>{
  const tags=[{name:'blue_hair',score:.99},{name:'round_sunglasses',score:.4}];
  assert.equal(buildPrompt(tags,{format:'danbooru'}),'blue_hair, round_sunglasses');
  assert.equal(buildPrompt(tags,{format:'natural',includeQuality:true,prefix:'masterpiece, best quality'}),'masterpiece, best quality, blue hair, round sunglasses');
  assert.match(buildPrompt(tags,{weighted:true}),/\(blue_hair:1\.22\)/);
  assert.equal(normalizeTag('  Blue Hair '),'blue_hair');
  assert.equal(formatTag('blue_hair','natural'),'blue hair');
});
test('BGR float32 preprocessing leaves channels on 0..255 scale',()=>{
  const out=imageDataToBgr({width:2,height:1,data:new Uint8ClampedArray([1,2,3,255,15,25,35,255])});
  assert.deepEqual(Array.from(out),[3,2,1,35,25,15]);
});
