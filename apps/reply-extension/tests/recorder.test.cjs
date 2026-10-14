const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
function harness(){
 const db={},rows=new Map(),registrations=[];let focused=1,site='https://x.com/home';
 const ctx={URL,Date,crypto:{randomUUID:()=> 'session-1'},navigator:{locks:{request:async(key,fn)=>fn()}},PandaRecorderStore:{save:async(id,items)=>{let added=0;for(const item of items){if(!rows.has(item.key))added++;rows.set(item.key,item);}return added;}},
 chrome:{storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,structuredClone(db[key])])),set:async value=>Object.assign(db,structuredClone(value))}},
 permissions:{contains:async()=>true},scripting:{getRegisteredContentScripts:async()=>[],registerContentScripts:async scripts=>registrations.push(scripts[0]),unregisterContentScripts:async()=>{},executeScript:async()=>[]},
 tabs:{query:async query=>query.active?[{id:focused}]:[],get:async id=>({id,active:true,url:site}),onUpdated:{addListener(){}}},runtime:{onMessage:{addListener(){}}}}};
 vm.createContext(ctx);vm.runInContext(read('recorder-background.js')+'\nglobalThis.recorder=PandaRecorder;',ctx);
 return {db,rows,registrations,api:ctx.recorder,setSite:url=>site=url,setFocused:id=>focused=id};
}
const item={postUrl:'https://x.com/person/status/123',text:'Visible post',author:'@person',media:[],links:[]};
test('recorder starts only on request, honors Instagram choice, deduplicates, and stops',async()=>{
 const h=harness();assert.equal(h.db.browsingRecorder,undefined);
 const session=await h.api.start(false);assert.equal(session.active,true);assert.equal(h.registrations[0].matches.length,2);
 const sender={tab:{id:1},url:'https://x.com/home'};
 assert.equal((await h.api.capture({sessionId:session.id,items:[item]},sender)).ok,true);
 await h.api.capture({sessionId:session.id,items:[{...item,text:'Updated post'}]},sender);
 assert.equal(h.db.browsingRecorder.count,1);assert.equal(h.rows.get(item.postUrl).text,'Updated post');
 await h.api.stop();assert.equal(h.db.browsingRecorder.active,false);
 assert.equal((await h.api.capture({sessionId:session.id,items:[item]},sender)).ok,false);
 assert.equal(h.db.browsingSessions[0].count,1);
});
test('DM routes, background tabs, stale sessions, and cross-platform payloads are rejected',async()=>{
 const h=harness(),session=await h.api.start(false);
 for(const route of ['https://x.com/i/chat/123','https://www.instagram.com/direct/inbox/','https://x.com/settings/account'])assert.equal((await h.api.capture({sessionId:session.id,items:[item]},{tab:{id:1},url:route})).ok,false);
 h.setFocused(2);assert.equal((await h.api.capture({sessionId:session.id,items:[item]},{tab:{id:1},url:'https://x.com/home'})).ok,false);
 h.setFocused(1);assert.equal((await h.api.capture({sessionId:'old',items:[item]},{tab:{id:1},url:'https://x.com/home'})).ok,false);
 await h.api.capture({sessionId:session.id,items:[{...item,postUrl:'https://www.instagram.com/p/abc/'}]},{tab:{id:1},url:'https://x.com/home'});
 assert.equal(h.rows.size,0);
});
test('Instagram capture requires both requested inclusion and site permission',async()=>{
 const h=harness(),session=await h.api.start(true);assert.equal(h.registrations[0].matches.length,4);
 h.setSite('https://www.instagram.com/');
 await h.api.capture({sessionId:session.id,items:[{...item,postUrl:'https://www.instagram.com/p/abc/'}]},{tab:{id:1},url:'https://www.instagram.com/'});
 assert.equal(h.db.browsingRecorder.count,1);
});
test('HTML download escapes post content and does not execute or load remote media',()=>{
 const ctx={URL};vm.createContext(ctx);const source=read('recorder-ui.js');vm.runInContext(source.slice(0,source.indexOf('\n(() => {'))+'\nglobalThis.exporter=PandaRecordingExport;',ctx);
 const html=ctx.exporter.html({startedAt:'2026-10-14'},[{...item,platform:'x',firstSeen:'now',text:'<script>alert(1)</script>',media:[{url:'javascript:alert(1)',poster:'https://example.com/image.png'}]}]);
 assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>'));assert(!html.includes('href="javascript:'));assert(!html.includes('<img'));
});
