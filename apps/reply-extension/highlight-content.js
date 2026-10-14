(() => {
  if(globalThis.__pandaHighlightsInstalled)return;
  globalThis.__pandaHighlightsInstalled=true;
  let settings={},timer,busy=false,revision=0,previous=null;
  if(!CSS.highlights || typeof Highlight==='undefined')return;
  const style=document.createElement('style');style.textContent='::highlight(panda-positive){background-color:#91efac;color:#102818}::highlight(panda-negative){background-color:#ff9aa7;color:#4b0714}';
  document.documentElement.append(style);
  function clear(){CSS.highlights.delete('panda-positive');CSS.highlights.delete('panda-negative');previous=null;}
  const visible=node=>{const rect=node.getBoundingClientRect();return rect.bottom>0 && rect.top<innerHeight && rect.width>0 && rect.height>0;};
  async function scan() {
    if(busy)return;
    if(document.visibilityState!=='visible')return;
    if(!settings.enabled || (location.hostname.endsWith('instagram.com') && !settings.instagram) ||
        /^\/(messages|direct|accounts|settings|i\/chat)(\/|$)/.test(location.pathname)){clear();return;}
    busy=true;const version=revision;
    try {
      const instagram=location.hostname.endsWith('instagram.com');
      const roots=[...document.querySelectorAll(instagram?'article':'[data-testid="tweetText"]')].filter(visible).slice(0,20);
      const snapshots=roots.map(root=>{
        const nodes=[];let text='';
        const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:node=>
          node.parentElement.closest('button,input,textarea,nav,script,style,[contenteditable="true"],[role="textbox"],[data-testid="DMDrawer"]')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
        let node;while((node=walker.nextNode()) && text.length<8000){nodes.push({node,start:text.length,value:node.textContent});text+=node.textContent;}
        return {text:text.slice(0,8000),nodes};
      });
      if(previous && previous.length===snapshots.length && snapshots.every((snapshot,index)=>snapshot.text===previous[index].text && snapshot.nodes.length===previous[index].nodes.length && snapshot.nodes.every((item,n)=>item.node===previous[index].nodes[n].node)))return;
      // Ranges refer to DOM nodes: rebuild even for identical text if React replaced those nodes.
      const result=await chrome.runtime.sendMessage({type:'panda-highlight-match',texts:snapshots.map(snapshot=>snapshot.text)});
      if(version!==revision || !settings.enabled)return;
      if(!result?.ok){clear();return;}
      const positive=new Highlight(),negative=new Highlight();negative.priority=2;positive.priority=1;
      for(let index=0;index<snapshots.length;index++) {
        const snapshot=snapshots[index];
        if(snapshot.nodes.some(item=>!item.node.isConnected || item.node.textContent!==item.value))continue;
        for(const match of result.ranges?.[index] || []) {
          const first=snapshot.nodes.find(item=>match.start>=item.start && match.start<item.start+item.value.length);
          const last=snapshot.nodes.find(item=>match.end>item.start && match.end<=item.start+item.value.length);
          if(!first || !last)continue;
          const range=document.createRange();range.setStart(first.node,match.start-first.start);range.setEnd(last.node,match.end-last.start);
          (match.kind==='negative'?negative:positive).add(range);
        }
      }
      CSS.highlights.set('panda-positive',positive);CSS.highlights.set('panda-negative',negative);previous=snapshots;
    }catch {clear();}finally{busy=false;}
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(scan,400);}
  chrome.storage.local.get('keywordHighlights').then(saved=>{settings=saved.keywordHighlights || {};schedule();});
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==='local' && changes.keywordHighlights){settings=changes.keywordHighlights.newValue || {};revision++;clear();schedule();}
  });
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true,characterData:true});
  document.addEventListener('visibilitychange',schedule);
  addEventListener('scroll',schedule,{passive:true});addEventListener('popstate',schedule);
  schedule();
})();
