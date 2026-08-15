/**
 * Auto-injection behaviour: trivial-prompt rejection, short id round trip,
 * relevance floor, and token budget enforcement.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStore } from '../dist/store/index.js';
import { SearchService } from '../dist/search/index.js';
import { BuiltinEmbedder } from '../dist/embed/index.js';
import { isSearchable, renderPromptContext } from '../dist/hooks/relevance.js';
import { toShortId, partitionIds } from '../dist/util/shortid.js';

let f=0; const ck=(l,ok,d='')=>{if(!ok)f++;console.log(`${ok?'PASS':'FAIL'}  ${l}${d?`  (${d})`:''}`)};
const tok = s => Math.ceil(s.length/4);

console.log('--- trivial prompt rejection (no query issued) ---');
for (const p of ['ok','thanks','continue','yes','go ahead','do it','fix it'])
  ck(`rejects "${p}"`, !isSearchable(p));
for (const p of ['why did we drop polling for the order feed','the websocket reconnect is looping again','add pagination to the invoice table'])
  ck(`accepts "${p.slice(0,32)}..."`, isSearchable(p));

console.log('\n--- short ids ---');
const uuid='2904a5fd-0f22-488b-83aa-1cba78ffee12';
ck('short id is a literal prefix', uuid.startsWith(toShortId(uuid)), toShortId(uuid));
ck('short id is 13 chars', toShortId(uuid).length===13);
const pt=partitionIds([uuid, toShortId(uuid)]);
ck('partitions exact vs prefix', pt.exact.length===1 && pt.prefixes.length===1);

console.log('\n--- end to end injection ---');
const dir=mkdtempSync(join(tmpdir(),'inj-'));
const store=await createStore(join(dir,'i.db')); await store.init();
const emb=new BuiltinEmbedder(); const search=new SearchService(store,emb);
const project='/p/app';
const seed=[
 ['decision','Chose WebSocket over polling for live order updates','Polling hammered the API and still lagged.'],
 ['deadend','Redux middleware for socket events did not scale','Re-renders across the whole tree.'],
 ['bugfix','Fixed reconnect storm on token refresh','Auth refresh raced the retry timer.'],
 ['pattern','Virtualized the invoice table with react-window','5k rows blocked the main thread.'],
];
const obs=[];
for(const[k,t,b] of seed){const[e]=await emb.embed([`${t} ${b}`]);
 obs.push({id:randomUUID(),sessionId:'s',project,kind:k,title:t,body:b,files:[],tags:[],createdAt:Date.now(),embedding:e});}
await store.insertObservations(obs);

const prompt='the websocket keeps reconnecting in a loop';
const hits=await search.search({text:prompt,project,limit:4});
const block=renderPromptContext(hits,500);
ck('relevant prompt produces a block', block!==null);

// expansion: the top match must arrive with its body, no tool call needed
const full1 = await store.getObservations([hits[0].id]);
const withBody = renderPromptContext(hits, 500, full1, 900);
ck('top match is injected in full', withBody.includes(full1[0].body.slice(0, 40)));
ck('remaining matches stay as pointers',
  !withBody.includes(full1[0].body) || withBody.split('Asked:').length <= 2);
// Cap must be below the actual body length or nothing truncates and the
// assertion proves nothing.
const tightCap = Math.floor(full1[0].body.length / 2);
ck('expansion respects its own char cap',
  renderPromptContext(hits, 500, full1, tightCap).length < withBody.length,
  `body ${full1[0].body.length}, cap ${tightCap}`);
console.log('\x1b[36m'+block+'\x1b[0m');
console.log(`\n  injected cost: ${block.length} chars  ~${tok(block)} tokens`);

const none=renderPromptContext(await search.search({text:'kubernetes helm chart rollout',project,limit:4}),500);
ck('unrelated prompt stays silent', none===null, none===null?'':String(none).slice(0,40));

console.log('\n--- short id round trip through layer 3 ---');
const shortIds=hits.map(h=>toShortId(h.id));
const full=await store.getObservations(shortIds);
ck('short ids resolve to full observations', full.length===hits.length, `${full.length}/${hits.length}`);
ck('bodies came back', full.every(o=>o.body.length>0));

console.log('\n--- budget enforcement ---');
const tiny=renderPromptContext(hits,80);
ck('respects a tight char budget', tiny===null||tiny.length<260, String(tiny?.length));

await store.close(); rmSync(dir,{recursive:true,force:true});
console.log(f===0?'\nAll injection checks passed.':`\n${f} failed.`);
process.exit(f?1:0);
