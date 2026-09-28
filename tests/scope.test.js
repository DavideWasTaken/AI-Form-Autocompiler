import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {capturePage} from '../src/capture.js';
function page(html) {
 const w=new JSDOM(html,{url:'https://example.test',runScripts:'outside-only',pretendToBeVisual:true}).window;
 w.HTMLElement.prototype.getClientRects=()=>[{width:100,height:20}];
 return w;
}
function capture(w,id,scope){return w.eval(`(${capturePage.toString()})(${JSON.stringify(id)},100000,${JSON.stringify(scope)})`);}
test('empty scope targets only empty fields and preserves populated radio groups',()=>{
 const w=page('<input name="existing" value="Keep"><input name="blank"><input type="radio" name="contact" checked><input type="radio" name="contact"><input type="checkbox" name="yes" checked><textarea name="notes"></textarea>');
 const s=capture(w,'new',{mode:'empty'});
 assert.deepEqual(Array.from(s.fields,f=>f.label),['blank','notes']);
 assert.match(s.html,/Keep/);
 assert.equal(w.document.querySelector('[name=existing]').hasAttribute('data-af-id'),false);
});
test('failed scope remaps only current failed marker IDs, including open shadow roots',()=>{
 const w=page('<input name="name"><div id="host"></div>');
 w.document.querySelector('#host').attachShadow({mode:'open'}).innerHTML='<input name="city">';
 const old=capture(w,'old',{mode:'all'});
 const s=capture(w,'new',{mode:'failed',failedIds:[old.fields[1].id]});
 assert.equal(s.fields.length,1);assert.equal(s.fields[0].label,'city');assert.match(s.fields[0].id,/^new-/);
});
test('empty or stale scoped target sets fail clearly before generation',()=>{
 const w=page('<input value="Existing">');
 assert.throws(()=>capture(w,'new',{mode:'empty'}),/No empty fields/);
 assert.throws(()=>capture(w,'new',{mode:'failed',failedIds:['gone']}),/No failed fields/);
});
