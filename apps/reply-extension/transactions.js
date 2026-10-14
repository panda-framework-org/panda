// Durable continuation: no open popup or long-lived timer is required.
const PandaTransactions = (() => {
  const prefix = 'networkConsultation:';
  let scanning = false;
  async function resume(key) {
    if (!key?.startsWith(prefix)) throw new Error('Invalid Network transaction.');
    return navigator.locks.request(key,async()=>{
      let record = await PandaNetwork.get(key);
      if (!record) throw new Error('Network transaction not found.');
      if (['ready','cancelled'].includes(record.state)) return {...record,key};
      if (!record.response || !record.post) return {...record,key};
      const tracked = await chrome.storage.local.get('replyHistory:'+record.postId);
      if (tracked['replyHistory:'+record.postId]) {
        record.state='cancelled'; record.error='This post already has a tracked reply.';
        await chrome.storage.local.set({[key]:record}); return {...record,key};
      }
      record.state='generating'; record.generationStartedAt=new Date().toISOString();
      delete record.error;
      await chrome.storage.local.set({[key]:record});
      try {
        const {apiKey} = await chrome.storage.local.get('apiKey');
        if (!apiKey) throw new Error('Save an OpenAI API key to continue this transaction.');
        const options=record.options || {};
        const post={...record.post,network:{handle:record.handle,response:record.response}};
        const draft=await PandaReply.generate(apiKey,post,options.instructions || '',options.keyPoint || '',options.tone || 'direct');
        record.draft=draft; record.state='ready'; record.completedAt=new Date().toISOString();
      } catch(error) {
        record.state='generation_failed'; record.error=error.message;
      }
      await chrome.storage.local.set({[key]:record});
      await badge();
      return {...record,key};
    });
  }
  async function scan(tabId) {
    if (scanning) return;
    scanning=true;
    try {
      const stored=await chrome.storage.local.get(null);
      const records=Object.entries(stored).filter(([key,record])=>key.startsWith(prefix) &&
        ['awaiting','unconfirmed','sending','responded','generating'].includes(record.state));
      const tabs=await chrome.tabs.query({url:['https://x.com/*','https://twitter.com/*']});
      for (const [key,snapshot] of records) {
        if (snapshot.state==='responded' || (snapshot.state==='generating' &&
            Date.now()-Date.parse(snapshot.generationStartedAt || 0)>120000)) {
          await resume(key); continue;
        }
        if(snapshot.state==='generating')continue;
        const candidates=tabId ? tabs.filter(tab=>tab.id===tabId) : tabs;
        for (const tab of candidates) {
          try {
            const result=await PandaNetwork.refresh(key,tab.id);
            if(result.state==='responded') {await resume(key); break;}
          } catch {
            // Unrelated pages, closed conversations, and locked Chat remain pending.
          }
        }
      }
      await badge();
    } finally {scanning=false;}
  }
  async function cancel(key) {
    if(!key?.startsWith(prefix))throw new Error('Invalid Network transaction.');
    return navigator.locks.request(key,async()=>{
      const record=await PandaNetwork.get(key);
      if(!record)throw new Error('Network transaction not found.');
      record.state='cancelled';record.cancelledAt=new Date().toISOString();
      await chrome.storage.local.set({[key]:record}); await badge();
      return {...record,key};
    });
  }
  async function badge() {
    const stored=await chrome.storage.local.get(null);
    const count=Object.entries(stored).filter(([key,record])=>key.startsWith(prefix) && record.state==='ready' &&
      !stored['replyHistory:'+record.postId]).length;
    await chrome.action.setBadgeText({text:count ? String(count) : ''});
    await chrome.action.setBadgeBackgroundColor({color:'#7ae49c'});
  }
  return {resume,scan,cancel,badge};
})();
