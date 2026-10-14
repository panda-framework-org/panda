const PandaRecorder = (() => {
  const allowed=url=>/^https:\/\/(?:x\.com|twitter\.com|(?:www\.)?instagram\.com)\//.test(url || '');
  const privatePage=url=>/^\/(?:messages|direct|accounts|settings|i\/(?:chat|messages|settings))(?:\/|$)/.test(new URL(url).pathname);
  async function inject(tab) {
    if(!allowed(tab?.url))return;
    try {await chrome.scripting.executeScript({target:{tabId:tab.id},files:['recorder-content.js']});}catch {}
  }
  async function start(includeInstagram = false) {
    return navigator.locks.request('panda-recording',async()=>{
      const saved=await chrome.storage.local.get(['browsingRecorder','browsingSessions']);
      if(saved.browsingRecorder?.active)return saved.browsingRecorder;
      const record={id:crypto.randomUUID(),active:true,includeInstagram:Boolean(includeInstagram),startedAt:new Date().toISOString(),count:0};
      const sessions=[record,...(saved.browsingSessions || [])];
      const matches=['https://x.com/*','https://twitter.com/*'];
      for(const host of ['https://www.instagram.com/*','https://instagram.com/*']) {
        if(includeInstagram && await chrome.permissions.contains({origins:[host]}))matches.push(host);
      }
      const scripts=await chrome.scripting.getRegisteredContentScripts({ids:['panda-recorder']});
      if(scripts.length)await chrome.scripting.unregisterContentScripts({ids:['panda-recorder']});
      await chrome.scripting.registerContentScripts([{id:'panda-recorder',matches,js:['recorder-content.js'],runAt:'document_idle',persistAcrossSessions:true}]);
      await chrome.storage.local.set({browsingRecorder:record,browsingSessions:sessions});
      const tabs=await chrome.tabs.query({url:matches});
      await Promise.allSettled(tabs.map(inject));
      return record;
    });
  }
  async function stop(reason) {
    return navigator.locks.request('panda-recording',async()=>{
      const saved=await chrome.storage.local.get(['browsingRecorder','browsingSessions']);
      if(!saved.browsingRecorder)return null;
      const record={...saved.browsingRecorder,active:false,stoppedAt:new Date().toISOString(),...(reason?{error:reason}:{})};
      await chrome.storage.local.set({browsingRecorder:record,browsingSessions:(saved.browsingSessions || []).map(item=>item.id===record.id?record:item)});
      await chrome.scripting.unregisterContentScripts({ids:['panda-recorder']}).catch(()=>{});
      return record;
    });
  }
  async function capture(message,sender) {
    if(!sender.tab || !allowed(sender.url) || privatePage(sender.url))return {ok:false};
    const tab=await chrome.tabs.get(sender.tab.id);
    const [focused]=await chrome.tabs.query({active:true,lastFocusedWindow:true});
    if(!tab.active || focused?.id!==tab.id || tab.url!==sender.url)return {ok:false};
    return navigator.locks.request('panda-recording',async()=>{
      const saved=await chrome.storage.local.get(['browsingRecorder','browsingSessions']);
      const session=saved.browsingRecorder;
      if(!session?.active || session.id!==message.sessionId)return {ok:false};
      const platform=new URL(sender.url).hostname.endsWith('instagram.com')?'instagram':'x';
      if(platform==='instagram' && !session.includeInstagram)return {ok:false};
      const items=(Array.isArray(message.items)?message.items:[]).slice(0,15).filter(item=>{
        try {return allowed(item.postUrl) && (platform==='instagram' ? /^\/(p|reel)\/[^/]+/.test(new URL(item.postUrl).pathname) : /^\/[^/]+\/status\/\d+$/.test(new URL(item.postUrl).pathname)) && (new URL(item.postUrl).hostname.endsWith('instagram.com')?'instagram':'x')===platform;}
        catch{return false;}
      }).map(item=>({...item,key:item.postUrl,platform,pageUrl:sender.url,text:String(item.text || '').slice(0,12000),author:String(item.author || '').slice(0,300),seenAt:new Date().toISOString()}));
      try {
        const added=await PandaRecorderStore.save(session.id,items);
        session.count+=added;
        if(session.count>=3000){session.active=false;session.stoppedAt=new Date().toISOString();session.error='Reached 3,000 posts. Download this session and start another.';}
        await chrome.storage.local.set({browsingRecorder:session,browsingSessions:(saved.browsingSessions || []).map(item=>item.id===session.id?session:item)});
        return {ok:true};
      }catch(error){
        session.active=false;session.error='Recording stopped: '+error.message;
        await chrome.storage.local.set({browsingRecorder:session,browsingSessions:(saved.browsingSessions || []).map(item=>item.id===session.id?session:item)});
        return {ok:false};
      }
    });
  }
  return {start,stop,capture,inject};
})();
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  let operation;
  if(!sender.tab && message?.type==='panda-recorder-start')operation=PandaRecorder.start(message.includeInstagram);
  else if(!sender.tab && message?.type==='panda-recorder-stop')operation=PandaRecorder.stop();
  else if(message?.type==='panda-recorder-capture')operation=PandaRecorder.capture(message,sender);
  else return;
  Promise.resolve(operation).then(result=>respond(message.type==='panda-recorder-capture'?result:{ok:true,result}),error=>respond({ok:false,error:error.message}));
  return true;
});
chrome.tabs.onUpdated.addListener(async(tabId,change,tab)=>{
  if(change.status!=='complete')return;
  const {browsingRecorder}=await chrome.storage.local.get('browsingRecorder');
  if(browsingRecorder?.active)await PandaRecorder.inject(tab);
});
