const PandaHighlightService = (() => {
  let creating;
  const origins=['https://x.com/*','https://twitter.com/*'];
  async function ensureWorker() {
    const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[chrome.runtime.getURL('highlight-offscreen.html')]});
    if(contexts.length)return;
    if(!creating)creating=chrome.offscreen.createDocument({url:'highlight-offscreen.html',reasons:['WORKERS'],justification:'Evaluate user regex locally in a terminable worker to keep social pages responsive.'}).finally(()=>creating=null);
    await creating;
  }
  async function match(message,sender) {
    if(!sender.tab || !/^https:\/\/(x\.com|twitter\.com|(?:www\.)?instagram\.com)\//.test(sender.url || ''))throw Error('Unsupported highlight page.');
    const {keywordHighlights}=await chrome.storage.local.get('keywordHighlights');
    if(!keywordHighlights?.enabled)return {ok:true,ranges:[]};
    const parsed=PandaHighlightPatterns.parse(keywordHighlights.positive,keywordHighlights.negative);
    if(parsed.errors.length)throw Error(parsed.errors.join('\n'));
    if(!parsed.patterns.length)return {ok:true,ranges:[]};
    const texts=(Array.isArray(message.texts)?message.texts:[]).slice(0,20).map(text=>String(text).slice(0,8000));
    await ensureWorker();
    const result=await chrome.runtime.sendMessage({type:'panda-highlight-worker',texts,patterns:parsed.patterns});
    if(!result?.ok)await chrome.storage.local.set({highlightLastError:result?.error || 'Highlight matching failed.'});
    return result;
  }
  async function install() {
    const matches=[...origins];
    const {keywordHighlights}=await chrome.storage.local.get('keywordHighlights');
    if(keywordHighlights?.instagram)for(const origin of ['https://www.instagram.com/*','https://instagram.com/*']) {
      if(await chrome.permissions.contains({origins:[origin]}))matches.push(origin);
    }
    const registered=await chrome.scripting.getRegisteredContentScripts({ids:['panda-highlights']});
    if(registered.length)await chrome.scripting.unregisterContentScripts({ids:['panda-highlights']});
    await chrome.scripting.registerContentScripts([{id:'panda-highlights',matches,js:['highlight-content.js'],runAt:'document_idle',persistAcrossSessions:true}]);
    const tabs=await chrome.tabs.query({url:matches});
    await Promise.allSettled(tabs.map(tab=>chrome.scripting.executeScript({target:{tabId:tab.id},files:['highlight-content.js']})));
  }
  return {match,install};
})();
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  let task;
  if(message?.type==='panda-highlight-match')task=PandaHighlightService.match(message,sender);
  else if(message?.type==='panda-highlight-install' && !sender.tab)task=PandaHighlightService.install().then(()=>({ok:true}));
  else return;
  Promise.resolve(task).then(respond,error=>respond({ok:false,error:error.message}));return true;
});
