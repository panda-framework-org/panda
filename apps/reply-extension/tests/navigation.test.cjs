const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
test('post reader ignores a new post linked inside an older quoted article',()=>{
  const source=fs.readFileSync(path.join(root,'post-reader.js'),'utf8');
  function article(id,text){
    const result={querySelector:()=>({innerText:text}),querySelectorAll:()=>[{closest:tag=>tag.startsWith('article')?result:{href:'https://x.com/author/status/'+id}}]};
    return result;
  }
  const old=article('123','Old post with a quote of the new post');
  const fresh=article('456','Fresh post');
  const context={URL,location:{pathname:'/author/status/456',href:'https://x.com/author/status/456'},document:{querySelectorAll:selector=>selector==='[role="dialog"]'?[]:[old,fresh]}};
  vm.createContext(context);vm.runInContext(source+'\nglobalThis.reader=PandaPostReader;',context);
  const result=context.reader.read('456');assert.equal(result.text,'Fresh post');assert.equal(result.postId,'456');
  assert.equal(context.reader.read('123'),null);
  context.document.querySelectorAll=selector=>selector==='[role="dialog"]'?[]:[old];assert.equal(context.reader.read('456'),null);
});
function contextHarness(){
  const source=fs.readFileSync(path.join(root,'popup.js'),'utf8');
  const elements={};let tab={id:1,url:'https://x.com/a/status/123'};
  const element=id=>elements[id] ||= {value:'',textContent:'',hidden:false,disabled:false};
  const ctx={URL,PandaPostReader:{read(){}},chrome:{tabs:{query:async()=>[{...tab}]},scripting:{executeScript:async()=>[{result:{postId:new URL(tab.url).pathname.match(/status\/(\d+)/)?.[1] || null}}]}},
    document:{getElementById:element},showNetwork:()=>{},setStatus:message=>element('status').textContent=message};
  vm.createContext(ctx);
  const start=source.indexOf('let current = null;'),end=source.indexOf('const setStatus');
  const postStart=source.indexOf('function postId'),postEnd=source.indexOf('const historyKey');
  vm.runInContext("const $=id=>document.getElementById(id);let lastLoadedNetworkDraft='';\n"+source.slice(start,end)+source.slice(postStart,postEnd)+
    '\nglobalThis.helpers={syncActiveContext,stillCurrent};',ctx);
  return {ctx,elements,helpers:ctx.helpers,setTab:value=>tab=value};
}
test('same-tab SPA navigation clears the old draft and invalidates an older generation',async()=>{
  const h=contextHarness();const first=await h.helpers.syncActiveContext();
  vm.runInContext("current={tabId:1,postId:'123'};generationSerial++;globalThis.oldSerial=generationSerial;",h.ctx);
  h.elements.draft.value='Old reply';h.elements.analysisSection.hidden=false;h.elements.analyze.disabled=true;
  h.setTab({id:1,url:'https://x.com/b/status/456'});
  const second=await h.helpers.syncActiveContext();
  assert.notEqual(first.epoch,second.epoch);
  assert.equal(h.elements.draft.value,'');assert.equal(h.elements.analysisSection.hidden,true);
  assert.equal(h.elements.insert.disabled,true);assert.equal(h.elements.analyze.disabled,false);
  assert.equal(await h.helpers.stillCurrent(first.epoch,h.ctx.oldSerial),false);
  assert.equal(await h.helpers.stillCurrent(second.epoch),true);
});
test('query-string changes preserve the current post, but switching tabs or leaving a post clears it',async()=>{
  const h=contextHarness();const first=await h.helpers.syncActiveContext();
  h.elements.draft.value='Current reply';
  h.setTab({id:1,url:'https://x.com/a/status/123?ref=share'});
  assert.equal((await h.helpers.syncActiveContext()).epoch,first.epoch);assert.equal(h.elements.draft.value,'Current reply');
  h.setTab({id:2,url:'https://x.com/a/status/123'});await h.helpers.syncActiveContext();assert.equal(h.elements.draft.value,'');
  h.elements.draft.value='Another reply';h.setTab({id:2,url:'https://x.com/home'});await h.helpers.syncActiveContext();assert.equal(h.elements.draft.value,'');
});
function modalHarness({withPermalink=true,duplicates=false,hasModal=true,originalText='Timeline post',modalText='Timeline post',compact=false,unloaded=false,react=false}={}) {
  const source=fs.readFileSync(path.join(root,'post-reader.js'),'utf8');
  function article(id,text,hasLink=true) {
    const result={
      querySelector:selector=>selector.includes('User-Name')?{getAttribute:()=>'/person'}:{innerText:text},
      querySelectorAll:()=>hasLink?[{closest:tag=>tag.startsWith('article')?result:{href:'https://x.com/person/status/'+id}}]:[]
    };return result;
  }
  const old=article('111','Other timeline post'),original=article('222',originalText),modal=article('222',modalText,withPermalink);
  let pasted='';
  const editor={innerText:'',focus(){},dispatchEvent:event=>{editor.innerText=event.clipboardData.getData('text/plain');pasted=editor.innerText;}};
  const dialog={getClientRects:()=>[{}],contains:node=>node===modal,
    cloneNode:()=>({innerText:'@person '+modalText,querySelectorAll:selector=>selector==='span'?[{textContent:'@person'}]:[]}),querySelector:()=>editor,querySelectorAll:()=>compact?[]:[modal]};
  modal.parentElement=dialog;dialog.parentElement=null;
  if(react)modal['__reactProps$test']={tweet:{id:'222',text:originalText,user:{screenName:'person'}}};
  const list=[old,...(unloaded?[]:[original]),...(duplicates?[article('333',originalText)]:[]),modal];
  const context={URL,setTimeout:fn=>fn(),DataTransfer:class{setData(type,text){this.text=text;}getData(){return this.text;}},ClipboardEvent:class{constructor(type,options){Object.assign(this,options);}},location:{pathname:'/home',href:'https://x.com/home'},
    window:{getSelection:()=>({removeAllRanges(){},addRange(){}})},
    document:{querySelectorAll:selector=>selector==='[role="dialog"]'?(hasModal?[dialog]:[]):list,
      createRange:()=>({selectNodeContents(){}}),execCommand:(command,unused,text)=>{pasted=text;return true;}}};
  vm.createContext(context);vm.runInContext(source+'\nglobalThis.reader=PandaPostReader;',context);
  return {reader:context.reader,pasted:()=>pasted};
}
test('timeline reply popup uses its source post and canonical permalink, not the timeline',async()=>{
  const h=modalHarness(),result=h.reader.read();
  assert.equal(result.postId,'222');assert.equal(result.text,'Timeline post');assert.equal(result.url,'https://x.com/person/status/222');
  assert.equal(result.isModal,true);assert.equal(result.relatedPosts.length,0);
  assert.equal(h.reader.read('111'),null);
  const outcome=await h.reader.read('222',false,'Whole reply');assert(outcome.includes('pasted into the editor'));assert.equal(h.pasted(),'Whole reply');
});
test('popup without a timestamp matches a unique timeline post by text and author',()=>{
  const h=modalHarness({withPermalink:false});assert.equal(h.reader.read().postId,'222');
  assert.equal(modalHarness({withPermalink:false,duplicates:true}).reader.read(),null);
  assert.equal(modalHarness({withPermalink:false,modalText:'Unmatched post'}).reader.read(),null);
});
test('closing the timeline popup clears the target instead of using the first timeline post',()=>{
  const h=modalHarness({hasModal:false});assert.equal(h.reader.read(),null);
});

test('compact reply preview with no article or permalink matches the timeline source',()=>{
  const h=modalHarness({compact:true});
  assert.equal(h.reader.read().postId,'222');assert.equal(h.reader.read().text,'Timeline post');
  assert.equal(modalHarness({compact:true,duplicates:true}).reader.read(),null);
  assert.equal(modalHarness({compact:true,modalText:'Unmatched preview'}).reader.read(),null);
});

test('post reader can be serialized as a standalone Chrome injected function',()=>{
  const source=fs.readFileSync(path.join(root,'post-reader.js'),'utf8'),ctx={};
  vm.createContext(ctx);vm.runInContext(source+'\nglobalThis.reader=PandaPostReader;',ctx);
  assert.doesNotThrow(()=>vm.runInNewContext('('+ctx.reader.read.toString()+')'));
});

test('named popup preview matches multiline source when only the preview includes a media link',()=>{
  const h=modalHarness({withPermalink:false,originalText:'This update might be fire\n\nTrying better coins each day\n\nBest app in crypto',modalText:'This update might be fire\n\nTrying better coins each day\n\nBest app in crypto pic.x.com/zQTc8csAG8'});
  assert.equal(h.reader.read().postId,'222');
});

test('virtualized timeline popup resolves its own React post metadata without the source article loaded',()=>{
  const h=modalHarness({withPermalink:false,unloaded:true,react:true,originalText:'Actual source post',modalText:'Actual source post pic.x.com/xyz'});
  assert.equal(h.reader.read().postId,'222');assert.equal(h.reader.read().url,'https://x.com/person/status/222');
  assert.equal(modalHarness({withPermalink:false,unloaded:true}).reader.read(),null);
  assert.equal(modalHarness({withPermalink:false,unloaded:true,react:true,modalText:'Different text'}).reader.read(),null);
});
