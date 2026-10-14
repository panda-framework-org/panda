const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
function create({db={},confirm=true,eligible=true,fillFails=false,incoming='',draftFails=false}={}) {
  const sent=[],generated=[],badges=[],locks=new Map();
  let browserReply=incoming;
  const context={URL,Date,console,setTimeout:fn=>{fn();return 0},clearTimeout(){},AbortController,
    navigator:{locks:{request:async(key,fn)=>{
      const prior=locks.get(key)||Promise.resolve();
      const job=prior.catch(()=>{}).then(fn);locks.set(key,job);
      try{return await job;}finally{if(locks.get(key)===job)locks.delete(key);}
    }}},chrome:{storage:{local:{
      get:async key=>key===null ? structuredClone(db) : {[key]:structuredClone(db[key])},
      set:async values=>Object.assign(db,structuredClone(values))
    }},tabs:{create:async()=>({id:2}),update:async()=>({}),query:async()=>[{id:9,url:'https://x.com/messages/1'}]},
    action:{setBadgeText:async value=>badges.push(value.text),setBadgeBackgroundColor:async()=>{}},
    scripting:{executeScript:async({func,args})=>{
      let result;
      if(func.name==='readOwner')result='owner';
      if(func.name==='followers')result=['follower','second'];
      if(func.name==='openDM')result={eligible};
      if(func.name==='conversation') {
        if(args[0]==='fill'){if(fillFails)throw Error('Existing draft');result={filled:true};}
        if(args[0]==='send'){sent.push(args[3]);result={clicked:true};}
        if(args[0]==='read')result=confirm ? {confirmed:true,messages:browserReply?[browserReply]:[],response:browserReply,url:'https://x.com/messages/1'}:null;
      }
      return [{result}];
    }}},PandaReply:{generate:async(...args)=>{
      generated.push(args);if(draftFails)throw Error('API unavailable');return 'Perceptions: [X post: Situation]\nAnalysis: Check evidence\nNetwork: Follower response considered\nDecision: Verify first\nAction: Read the source';
    }}};
  vm.createContext(context);
  vm.runInContext(read('network.js')+'\nglobalThis.network=PandaNetwork;',context);
  vm.runInContext(read('transactions.js')+'\nglobalThis.transactions=PandaTransactions;',context);
  return {db,context,network:context.network,transactions:context.transactions,sent,generated,badges,setIncoming:value=>browserReply=value};
}
const post={text:'What should we do?',url:'https://x.com/author/status/123',relatedPosts:[]};
const options={instructions:'Be specific',keyPoint:'Verify sources',tone:'direct'};
test('a pending transaction survives worker restart, resumes from a new DM tab, and does not resend',async()=>{
  const first=create({db:{apiKey:'test-only'}});
  const pending=await first.network.consult({id:1},post,'123',options);
  assert.equal(pending.state,'awaiting');assert.equal(first.sent.length,1);
  assert.equal(pending.post.text,post.text);assert.equal(pending.options.instructions,options.instructions);
  const restarted=create({db:first.db,incoming:'I would check the original source.'});
  await restarted.transactions.scan(9);
  const completed=await restarted.network.get(pending.key);
  assert.equal(completed.state,'ready');assert.equal(restarted.generated.length,1);
  assert.equal(restarted.generated[0][1].network.response,'I would check the original source.');
  assert.equal(restarted.generated[0][2],options.instructions);assert.equal(restarted.sent.length,0);
  await restarted.transactions.scan();await restarted.transactions.resume(pending.key);
  await restarted.network.consult({id:1},post,'123',options);
  assert.equal(restarted.generated.length,1);assert.equal(restarted.sent.length,0);
  assert(restarted.badges.includes('1'));
});
test('uncertain sends are durable and never retried automatically',async()=>{
  const first=create({confirm:false});
  const pending=await first.network.consult({id:1},post,'123',options);
  assert.equal(pending.state,'unconfirmed');assert.equal(first.sent.length,1);
  const restarted=create({db:first.db,confirm:false});
  await restarted.network.consult({id:1},post,'123',options);
  assert.equal(restarted.sent.length,0);assert.equal(restarted.generated.length,0);
});
test('blocked messaging and existing drafts never click Send',async()=>{
  for(const settings of [{eligible:false},{fillFails:true}]) {
    const h=create(settings),record=await h.network.consult({id:1},post,'123',options);
    assert.equal(record.state,'failed');assert.equal(h.sent.length,0);
  }
});
test('generation failure retains follower response and can be retried',async()=>{
  const h=create({db:{apiKey:'test-only'},draftFails:true});
  const pending=await h.network.consult({id:1},post,'123',options);
  await h.network.useResponse(pending.key,'Verify before acting.');
  const failed=await h.transactions.resume(pending.key);
  assert.equal(failed.state,'generation_failed');assert.equal(failed.response,'Verify before acting.');
  const restart=create({db:h.db});const ready=await restart.transactions.resume(pending.key);
  assert.equal(ready.state,'ready');assert.equal(restart.sent.length,0);
});
test('cancelled or already-commented posts do not resume drafting',async()=>{
  for(const mode of ['cancel','tracked']) {
    const h=create({db:{apiKey:'test-only'}}),pending=await h.network.consult({id:1},post,'123',options);
    await h.network.useResponse(pending.key,'Verify before acting.');
    if(mode==='cancel')await h.transactions.cancel(pending.key);
    else h.db['replyHistory:123']={state:'Reply prepared'};
    await h.transactions.resume(pending.key);
    assert.equal((await h.network.get(pending.key)).state,'cancelled');assert.equal(h.generated.length,0);
  }
});
test('concurrent continuations create one draft',async()=>{
  const h=create({db:{apiKey:'test-only'}}),pending=await h.network.consult({id:1},post,'123',options);
  await h.network.useResponse(pending.key,'Verify before acting.');
  await Promise.all([h.transactions.resume(pending.key),h.transactions.resume(pending.key)]);
  assert.equal(h.generated.length,1);
});
test('a follower with an unanswered request is skipped for the next post',async()=>{
  const h=create();await h.network.consult({id:1},post,'123',options);
  const other=await h.network.consult({id:1},{...post,url:'https://x.com/author/status/456'},'456',options);
  assert.equal(other.handle,'second');assert.equal(h.sent.length,2);
});
function readConversation({owner='owner',recipients=['follower'],messages=[]}={}) {
  const source=read('network.js');
  const func=source.slice(source.indexOf('  function conversation('),source.indexOf('  async function consult'));
  const entries=messages.map(({text,direction,left=0,right=300,bubbleLeft=0,bubbleRight=300})=>({
    innerText:text,
    querySelector:()=>({innerText:text,getBoundingClientRect:()=>({left:bubbleLeft,right:bubbleRight,width:bubbleRight-bubbleLeft})}),
    getAttribute:name=>name==='data-message-direction'?direction:null,
    getBoundingClientRect:()=>({left,right,width:right-left})
  }));
  const header={querySelectorAll:()=>recipients.map(name=>({href:'https://x.com/'+name}))};
  const scope={querySelector:()=>header,querySelectorAll:()=>entries};
  const editor={value:'',closest:()=>scope};
  const doc={querySelector:selector=>selector.includes('AppTabBar')?{getAttribute:()=>'/'+owner}:editor};
  const ctx={document:doc,URL,location:{href:'https://x.com/messages/1'}};
  vm.createContext(ctx);vm.runInContext(func+'\nglobalThis.readDM=conversation;',ctx);
  return ctx.readDM('read','owner','follower','Our exact question');
}
test('only incoming messages after the matching question are accepted',()=>{
  const result=readConversation({messages:[
    {text:'Old response',direction:'incoming'},
    {text:'Our exact question',direction:'outgoing'},
    {text:'My follow-up',direction:'outgoing'},
    {text:'Follower perspective',direction:'incoming'}
  ]});
  assert.equal(result.response,'Follower perspective');
});
test('unmatched recipients, groups, accounts, or missing questions cannot resume',()=>{
  assert.equal(readConversation({recipients:['someoneElse']}),null);
  assert.equal(readConversation({recipients:['follower','other']}),null);
  assert.throws(()=>readConversation({owner:'someoneElse'}),/account changed/);
  assert.equal(readConversation({messages:[{text:'A new message',direction:'incoming'}]}),null);
});
test('ambiguous message layout stays pending, while calibrated incoming bubbles are accepted',()=>{
  const ambiguous=readConversation({messages:[{text:'Our exact question'},{text:'Unknown sender'}]});
  assert.equal(ambiguous.response,'');
  const calibrated=readConversation({messages:[
    {text:'Our exact question',bubbleLeft:180,bubbleRight:300},
    {text:'Incoming reply',bubbleLeft:0,bubbleRight:120},
    {text:'My own follow-up',bubbleLeft:180,bubbleRight:300}
  ]});
  assert.equal(calibrated.response,'Incoming reply');
});
