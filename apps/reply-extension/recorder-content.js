(() => {
  if(globalThis.__pandaRecorderInstalled)return;
  globalThis.__pandaRecorderInstalled=true;
  let session=null,timer,busy=false;
  const emitted=new Map();
  const instagram=location.hostname.endsWith('instagram.com');
  const privatePage=()=>/^\/(?:messages|direct|accounts|settings|i\/(?:chat|messages|settings))(?:\/|$)/.test(location.pathname);
  const visible=node=>{
    const rect=node.getBoundingClientRect();
    return rect.width>0 && rect.height>0 && rect.bottom>0 && rect.top<innerHeight && rect.right>0 && rect.left<innerWidth &&
      getComputedStyle(node).visibility!=='hidden' && getComputedStyle(node).display!=='none';
  };
  const webURL=value=>{try{const url=new URL(value,location.href);return /^https?:$/.test(url.protocol)?url.href:null;}catch{return null;}};
  async function scan() {
    if(busy || !session || (instagram && !session.includeInstagram) || document.visibilityState!=='visible' || privatePage())return;
    busy=true;
    try {
      let posts=[...document.querySelectorAll('article')].filter(visible);
      if(instagram && !posts.length && /^\/(p|reel)\/[^/]+/.test(location.pathname)) {
        const main=document.querySelector('main');if(main && visible(main))posts=[main];
      }
      const items=[];
      for(const post of posts.slice(0,20)) {
        if(post.closest('[data-testid="DMDrawer"]'))continue;
        const links=[...post.querySelectorAll('a[href]')].map(a=>webURL(a.getAttribute('href'))).filter(Boolean);
        const permalink=instagram ? links.find(url=>/^\/(p|reel)\/[^/]+/.test(new URL(url).pathname)) ||
          (/^\/(p|reel)\/[^/]+/.test(location.pathname)?location.href:null) :
          [...post.querySelectorAll('time')].map(time=>time.closest('a')?.href).find(url=>/\/status\/\d+/.test(url || ''));
        if(!permalink)continue;
        const canonical=new URL(permalink);canonical.search='';canonical.hash='';
        canonical.pathname=instagram ? canonical.pathname.match(/^\/(?:p|reel)\/[^/]+/)?.[0]+'/' : canonical.pathname.match(/^\/[^/]+\/status\/\d+/)?.[0] || '/i/status/'+canonical.pathname.match(/\/status\/(\d+)/)?.[1];
        const clone=post.cloneNode(true);
        clone.querySelectorAll('button, input, textarea, [contenteditable="true"], nav').forEach(node=>node.remove());
        const text=(instagram ? clone.textContent : post.querySelector('[data-testid="tweetText"]')?.innerText || '')?.trim().slice(0,12000) || '';
        const author=instagram ? [...post.querySelectorAll('a[href]')].find(a=>/^\/[A-Za-z0-9_.]+\/?$/.test(new URL(a.href).pathname))?.innerText?.trim() || '' :
          post.querySelector('[data-testid="User-Name"]')?.innerText?.trim() || '';
        const media=[...post.querySelectorAll('img,video')].filter(node=>{
          const rect=node.getBoundingClientRect();return rect.width>=80 && rect.height>=80;
        }).slice(0,12).map(node=>({type:node.tagName.toLowerCase(),url:webURL(node.currentSrc || node.src),poster:webURL(node.poster),alt:node.alt || ''}));
        const fingerprint=JSON.stringify({text,media});
        const key=canonical.href;
        if(emitted.get(key)===fingerprint || items.some(item=>item.key===key))continue;
        items.push({key,platform:instagram?'instagram':'x',postUrl:key,pageUrl:location.href,author,text,links:links.slice(0,30),media,seenAt:new Date().toISOString()});
        // Mark only after the worker confirms durable storage.
        if(items.length>=15)break;
      }
      if(items.length) {
        const result=await chrome.runtime.sendMessage({type:'panda-recorder-capture',sessionId:session.id,items});
        if(result?.ok)for(const item of items)emitted.set(item.key,JSON.stringify({text:item.text,media:item.media}));
      }
    }catch {} finally{busy=false;}
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(scan,700);}
  chrome.storage.local.get('browsingRecorder').then(saved=>{session=saved.browsingRecorder?.active?saved.browsingRecorder:null;schedule();});
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==='local' && changes.browsingRecorder) {
      const next=changes.browsingRecorder.newValue;
      if(next?.id!==session?.id)emitted.clear();
      session=next?.active?next:null;schedule();
    }
  });
  new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  addEventListener('scroll',schedule,{passive:true});addEventListener('focus',schedule);
  document.addEventListener('visibilitychange',schedule);
  setInterval(scan,3000);
  schedule();
})();
