const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
function patterns(){const ctx={};vm.createContext(ctx);vm.runInContext(read('highlight-patterns.js')+'\nglobalThis.api=PandaHighlightPatterns;',ctx);return ctx.api;}
test('plain keywords and phrases are literal and case-insensitive, including cashtags',()=>{
 const api=patterns(),parsed=api.parse('$PANDA\ngood news','scam');assert.equal(parsed.errors.length,0);
 const result=api.match(['Good NEWS for $panda; avoid SCAM.'],parsed.patterns)[0];
 assert.equal(result.filter(match=>match.kind==='positive').length,2);assert.equal(result.filter(match=>match.kind==='negative').length,1);
 assert.equal(api.match(['anything'],api.parse('a.*').patterns)[0].length,0);
});
test('regex lists support alternation, boundaries, flags, and overlapping categories',()=>{
 const api=patterns(),parsed=api.parse('/\\b(bullish|profit)\\b/i','/profit|loss(?:es)?/i');
 assert.equal(parsed.errors.length,0);const matches=api.match(['BULLISH profit losses bullishness'],parsed.patterns)[0];
 assert.equal(matches.filter(match=>match.kind==='positive').length,2);assert.equal(matches.filter(match=>match.kind==='negative').length,2);
 assert.equal(api.match(['BULLISH'],api.parse('/bullish/').patterns)[0].length,0);
});
test('invalid regex, unsupported flags, and excessive rules report useful errors',()=>{
 const api=patterns();assert.match(api.parse('/[/i').errors[0],/positive line 1/);assert.match(api.parse('/x/ii').errors[0],/flags/);
 assert.match(api.parse('/x/y').errors[0],/flags/);assert(api.parse(Array.from({length:101},(_,n)=>'rule'+n).join('\n')).errors.length);
});
test('zero-width expressions terminate and create no empty highlights',()=>{
 const api=patterns();assert.equal(api.match(['abc 🐼'],api.parse('/(?:)/gu').patterns)[0].length,0);
});
test('offscreen matcher terminates a nonresponsive regex worker and reports timeout',async()=>{
 let listener,terminated=false;
 const ctx={chrome:{runtime:{onMessage:{addListener:fn=>listener=fn}}},Worker:class{postMessage(){}terminate(){terminated=true;}},setTimeout:fn=>setTimeout(fn,5),clearTimeout};
 vm.createContext(ctx);vm.runInContext(read('highlight-offscreen.js'),ctx);
 const result=await new Promise(resolve=>listener({type:'panda-highlight-worker',texts:['text'],patterns:[]},{},resolve));
 assert.equal(result.ok,false);assert.match(result.error,/took too long/);assert.equal(terminated,true);
});
test('highlight renderer uses text ranges and skips editable fields without rewriting posts',()=>{
 const source=read('highlight-content.js');assert(source.includes('new Highlight()'));assert(source.includes('negative.priority=2'));
 assert(source.includes('[contenteditable="true"]'));assert(source.includes('[role="textbox"]'));
 assert(!source.includes('innerHTML='));assert(!source.includes('replaceWith('));
});
