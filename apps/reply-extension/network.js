// Runs only when the user enables follower consultation and generates a reply.
const PandaNetwork = (() => {
  const clean = value => (value || '').replace(/\s+/g, ' ').trim();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function run(tabId, func, args = []) {
    const results = await chrome.scripting.executeScript({target: {tabId}, func, args});
    return results[0]?.result;
  }
  async function waitFor(tabId, func, args = []) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const result = await run(tabId, func, args);
      if (result) return result;
      await sleep(500);
    }
    throw new Error('X did not expose the expected controls. Open or unlock Chat, then try again.');
  }
  // Uses the logged-in profile navigation link, never the post author's account.
  function readOwner() {
    const link = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
    return link?.getAttribute('href')?.match(/^\/([A-Za-z0-9_]{1,15})\/?$/)?.[1] || null;
  }
  async function identity(tabId, postId) {
    const owner = await run(tabId, readOwner);
    if (!owner) throw new Error('Could not identify your logged-in X profile. Open X while signed in.');
    return {owner, key: `networkConsultation:${owner.toLowerCase()}:${postId}`};
  }
  async function get(key) { return (await chrome.storage.local.get(key))[key]; }
  async function put(key, record) { await chrome.storage.local.set({[key]: record}); return record; }
  function question(post) {
    return `Hi! Could I get your perspective on this situation?\n\n${post.text.slice(0,900)}\n${post.url}\n\nWhat decision would you make, what action would you take, and why? Your answer may help me draft a public reply to this post.`;
  }
  function followers(owner) {
    const own = document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href');
    if (!own) return null;
    if (own.replace(/\/$/,'').toLowerCase() !== '/'+owner.toLowerCase()) throw new Error('The logged-in X account changed.');
    if (location.pathname.toLowerCase() !== '/'+owner.toLowerCase()+'/followers') return null;
    const cells = [...document.querySelectorAll('main [data-testid="UserCell"]')];
    const handles = cells.flatMap(cell => [...cell.querySelectorAll('a[href]')].map(a =>
      a.getAttribute('href')?.match(/^\/([A-Za-z0-9_]{1,15})$/)?.[1]
    )).filter(handle => handle && handle.toLowerCase() !== owner.toLowerCase());
    return handles.length ? [...new Set(handles)].slice(0,5) : null;
  }
  function openDM(owner, handle) {
    const own = document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href');
    if (!own) return null;
    if (own.replace(/\/$/,'').toLowerCase() !== '/'+owner.toLowerCase()) throw new Error('The logged-in X account changed.');
    if (location.pathname.toLowerCase() !== '/'+handle.toLowerCase()) return null;
    if (!document.querySelector('[data-testid="UserName"]')) return null;
    const button = document.querySelector('[data-testid="sendDMFromProfile"]');
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return {eligible:false};
    button.click(); return {eligible:true};
  }
  // Shared by filling, sending, and reading: validates the exact conversation.
  function conversation(operation, owner, handle, message) {
    const clean = value => (value || '').replace(/\s+/g,' ').trim();
    const own = document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href');
    if (!own) return null;
    if (own.replace(/\/$/,'').toLowerCase() !== '/'+owner.toLowerCase()) throw new Error('The logged-in X account changed.');
    const editor = document.querySelector('[data-testid="dmComposerTextInput"]');
    if (!editor) return null;
    const scope = editor.closest('[role="dialog"]') || editor.closest('[data-testid="DMDrawer"]') || editor.closest('main');
    if (!scope) return null;
    const header = scope.querySelector('[data-testid="DMConversationHeader"], [data-testid="DM_Conversation_Header"], [data-testid="conversation-header"], header');
    // Never identify the recipient from a conversation list or an old message link.
    if (!header) return null;
    const handles = [...new Set([...header.querySelectorAll('a[href]')].flatMap(a => {
      try {
        const name = new URL(a.href).pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/)?.[1]?.toLowerCase();
        return name && !['home','messages','settings','explore','notifications','compose','i',owner.toLowerCase()].includes(name) ? [name] : [];
      } catch { return []; }
    }))];
    if (handles.length !== 1 || handles[0] !== handle.toLowerCase()) return null;
    const text = () => editor.value ?? editor.innerText;
    if (operation === 'fill') {
      if (clean(text())) throw new Error('This DM contains an existing draft. Clear it in X before continuing.');
      editor.focus();
      if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
        const prototype = editor instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype,'value').set.call(editor,message);
        editor.dispatchEvent(new Event('input',{bubbles:true}));
      } else {
        if (!document.execCommand('insertText',false,message)) throw new Error('Could not fill the DM editor.');
      }
      return {filled:clean(text()) === clean(message)};
    }
    if (operation === 'send') {
      if (clean(text()) !== clean(message)) throw new Error('The DM draft changed. Nothing was sent.');
      const button = scope.querySelector('[data-testid="dmComposerSendButton"]');
      if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return null;
      button.click(); return {clicked:true};
    }
    const entries = [...scope.querySelectorAll('[data-testid="messageEntry"]')];
    const bubble = entry => entry.querySelector('[data-testid="message-text"]') || entry;
    const messages = entries.map(entry => clean(bubble(entry).innerText));
    const index = messages.findLastIndex(value => value === clean(message) || value.includes(clean(message)));
    if (index < 0) return null;
    // Read explicit sender/direction information; never guess from a new message alone.
    // If unavailable, compare bubble placement to the known outbound question.
    const outbound = bubble(entries[index]).getBoundingClientRect();
    const bounds = entries[index].getBoundingClientRect();
    const center = (bounds.left+bounds.right)/2;
    const outboundRight = (outbound.left+outbound.right)/2 > center+20;
    function incoming(entry) {
      const direction = entry.getAttribute('data-message-direction') || entry.getAttribute('data-direction');
      if (direction) return ['incoming','inbound','received'].includes(direction);
      const sender = entry.getAttribute('data-sender-handle');
      if (sender) return sender.replace(/^@/,'').toLowerCase() === handle.toLowerCase();
      const rect = bubble(entry).getBoundingClientRect();
      // Strictly require the known outbound bubble on the right and this one on the left.
      return outboundRight && rect.width>0 && (rect.left+rect.right)/2 < center-20;
    }
    const later = entries.slice(index+1);
    // If another question has been sent here, do not attribute its answer to this post.
    const unrelatedQuestion = later.findIndex(entry => clean(bubble(entry).innerText).startsWith('Hi! Could I get your perspective on this situation?'));
    const relevant = unrelatedQuestion < 0 ? later : later.slice(0,unrelatedQuestion);
    const responses = relevant.filter(incoming).map(entry => clean(bubble(entry).innerText)).filter(Boolean);
    return {confirmed:!clean(text()), messages:relevant.map(entry => clean(bubble(entry).innerText)).filter(Boolean).slice(-10),
      response:responses.join('\n').slice(0,4000), url:location.href};
  }

  async function consult(tab, post, id, options = {}) {
    const {owner,key} = await identity(tab.id,id);
    return navigator.locks.request('network-contact:'+owner.toLowerCase(),()=>navigator.locks.request(key,async()=>{
      const previous = await get(key);
      if (previous && !['failed','finding'].includes(previous.state)) {
        if (!previous.post) {previous.post=post; previous.options=options; await put(key,previous);}
        return {...previous,key};
      }
      const record = {owner, postId:id, postUrl:post.url, post, options, sourceTabId:tab.id, question:question(post), state:'finding', time:new Date().toISOString()};
      await put(key,record);
      try {
        const networkTab = await chrome.tabs.create({url:`https://x.com/${owner}/followers`,active:false});
        record.tabId = networkTab.id;
        await put(key,record);
        const candidates = await waitFor(record.tabId,followers,[owner]);
        const stored = await chrome.storage.local.get(null);
        const busy = Object.entries(stored).filter(([savedKey,item]) => savedKey.startsWith('networkConsultation:') &&
          item.owner?.toLowerCase()===owner.toLowerCase() && ['sending','unconfirmed','awaiting'].includes(item.state))
          .map(([,item])=>item.handle?.toLowerCase());
        for (const handle of candidates) {
          if (busy.includes(handle.toLowerCase())) continue;
          await chrome.tabs.update(record.tabId,{url:`https://x.com/${handle}`});
          const eligibility = await waitFor(record.tabId,openDM,[owner,handle]);
          if (!eligibility.eligible) continue;
          record.handle = handle;
          const filled = await waitFor(record.tabId,conversation,['fill',owner,handle,record.question]);
          if (!filled.filled) throw new Error('X did not accept the full DM text. Nothing was sent.');
          // Persist before clicking Send. An uncertain send must never be retried automatically.
          record.state = 'sending'; await put(key,record);
          await waitFor(record.tabId,conversation,['send',owner,handle,record.question]);
          record.state = 'unconfirmed'; await put(key,record);
          const sent = await waitFor(record.tabId,conversation,['read',owner,handle,record.question]);
          record.state = sent.confirmed ? 'awaiting' : 'unconfirmed';
          record.conversationUrl = sent.url;
          record.messages = sent.messages;
          await put(key,record);
          return {...record,key};
        }
        throw new Error('No messageable follower found among the first five visible followers.');
      } catch (error) {
        record.error = error.message;
        record.state = ['sending','unconfirmed'].includes(record.state) ? 'unconfirmed' : 'failed';
        await put(key,record);
        return {...record,key};
      }
    }));
  }
  async function refresh(key, tabId) {
    return navigator.locks.request(key,async()=>{
      const record = await get(key);
      if (!record) throw new Error('Start a follower consultation first.');
      if (!['awaiting','unconfirmed','sending'].includes(record.state)) return {...record,key};
      const result = await run(tabId ?? record.tabId,conversation,['read',record.owner,record.handle,record.question]);
      if (!result) throw new Error('Open the follower conversation in its Network tab and unlock Chat if needed.');
      record.messages = result.messages;
      if (result.confirmed) {record.state = 'awaiting'; delete record.error;}
      if (result.response) {
        record.response=result.response; record.state='responded';
        record.responseSource='Incoming message after the question in the matched DM conversation';
        record.respondedAt=new Date().toISOString();
      }
      record.checkedAt=new Date().toISOString();
      await put(key,record); return {...record,key};
    });
  }
  async function useResponse(key, response) {
    return navigator.locks.request(key,async()=>{
      const record = await get(key);
      if (!record?.handle) throw new Error('No follower conversation selected.');
      if (!clean(response)) throw new Error('Select or paste the follower’s actual response first.');
      record.response = response.trim().slice(0,4000);
      record.state = 'responded'; record.responseSource = 'user-confirmed follower response';
      await put(key,record); return {...record,key};
    });
  }
  return {consult,refresh,useResponse,identity,get,question};
})();
