// No DM contents are sent here. The worker checks only saved, pending conversations.
(() => {
  let timer;
  const check = () => {
    if(!/^\/(messages|i\/chat)(\/|$)/.test(location.pathname) && !document.querySelector('[data-testid="DMDrawer"], [data-testid="dmComposerTextInput"]'))return;
    clearTimeout(timer);
    timer=setTimeout(()=>chrome.runtime.sendMessage({type:'panda-network-page'}).catch(()=>{}),1500);
  };
  new MutationObserver(check).observe(document.documentElement,{childList:true,subtree:true,characterData:true});
  window.addEventListener('popstate',check);
  window.addEventListener('focus',check);
  check();
})();
