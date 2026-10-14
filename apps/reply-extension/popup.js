const $ = id => document.getElementById(id);
let current = null;
let viewEpoch=0, generationSerial=0, activeContext=null;
function clearPostView() {
  current=null; lastLoadedNetworkDraft='';
  $('draft').value=''; $('analysis').textContent='';
  $('analysisSection').hidden=true; $('insert').disabled=true;
  $('analyze').disabled=false; showNetwork(null);
}
async function syncActiveContext() {
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  let id=null,readError=null;
  if(tab?.url && /^https:\/\/(x\.com|twitter\.com)\//.test(tab.url)) {
    try {
      const result=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:PandaPostReader.read,args:[null,true]});
      id=result[0]?.result?.postId || null;
    }catch(error) {readError=error.message;} // Pages still loading do not have a readable target yet.
  }
  const context=tab ? tab.id+':'+(id || 'other') : 'none';
  if(context!==activeContext) {
    activeContext=context; viewEpoch++; generationSerial++;
    clearPostView();
    setStatus(id ? 'New post selected. Generate a fresh reply.' : 'Open an X post or a timeline reply popup to generate a reply.');
  }
  if(readError)setStatus('Could not read the X page: '+readError);
  return {tab,id,epoch:viewEpoch};
}
async function stillCurrent(epoch,serial) {
  await syncActiveContext();
  return epoch===viewEpoch && (serial===undefined || serial===generationSerial);
}
const setStatus = message => $('status').textContent = message;
const normalize = value => (value || '').replace(/\s+/g, ' ').trim();

// Chrome extension storage persists across panel closures, browser restarts, and extension reloads.
// Do not use sync storage for credentials.
const settingsIds = ['instructions', 'custom', 'tone', 'runtime', 'apiKey', 'networkEnabled', 'pandaToken'];
let settingsReady = false;
let saving = Promise.resolve();

async function persist() {
  const settings = {
    instructions: $('instructions').value,
    custom: $('custom').value,
    tone: $('tone').value,
    runtime: $('runtime').checked,
    networkEnabled: $('networkEnabled').checked,
    apiKey: $('apiKey').value.trim(),
    pandaToken: $('pandaToken').value.trim()
  };
  saving = saving.catch(() => {}).then(() => chrome.storage.local.set(settings));
  await saving;
  $('keySaved').textContent = settings.apiKey
    ? 'API key saved locally in Chrome. It will be available the next time you open this extension.'
    : 'Enter an API key. It will be saved automatically on this device.';
}

async function restoreSettings() {
  try {
    const saved = await chrome.storage.local.get(settingsIds);
    $('instructions').value = saved.instructions ?? 'Respond directly to the post, be specific and useful, avoid hype and invented facts. Keep it short.';
    $('custom').value = saved.custom ?? '';
    $('tone').value = saved.tone ?? 'direct';
    $('runtime').checked = Boolean(saved.runtime);
    $('networkEnabled').checked = Boolean(saved.networkEnabled);
    $('networkControls').hidden = !$('networkEnabled').checked;
    $('apiKey').value = saved.apiKey ?? '';
    $('pandaToken').value = saved.pandaToken ?? '';
    $('keySaved').textContent = saved.apiKey ? 'API key saved locally in Chrome.' : 'Enter an API key. It will be saved automatically on this device.';
  } catch (error) {
    setStatus('Could not load saved settings: ' + error.message);
  } finally {
    settingsReady = true;
  }
}
restoreSettings();
for (const id of settingsIds) {
  $(id).addEventListener('input', () => { if (settingsReady) persist().catch(e => setStatus('Settings could not be saved: '+e.message)); });
  $(id).addEventListener('change', () => { if (settingsReady) persist().catch(e => setStatus('Settings could not be saved: '+e.message)); });
}

let networkRecord = null;
function showNetwork(record) {
  if(record && activeContext && !activeContext.endsWith(':'+record.postId))return;
  networkRecord = record;
  const descriptions = {
    finding:'Finding a follower…', sending:'Sending question…',
    awaiting:'Question sent to @'+record?.handle+'. Waiting for their response.',
    unconfirmed:'Send status unconfirmed. Check the DM tab before doing anything else; the question will not be sent again automatically.',
    failed:'Could not contact a follower. '+(record?.error || ''),
    responded:'Follower response from @'+record?.handle+' saved. Continuing the PANDA process…',
    generating:'Follower replied. Generating Decision and Action…',
    ready:'PANDA draft ready using @'+record?.handle+'’s response. Open the original post to review it.',
    generation_failed:'Follower response saved; drafting failed: '+(record?.error || '')+'. Generate again to retry.',
    cancelled:'This Network transaction has been stopped.'
  };
  $('networkStatus').textContent = record ? descriptions[record.state] || record.state : 'No follower contacted for this post yet.';
  $('openNetwork').disabled = !record?.tabId;
  $('refreshNetwork').disabled = !record?.handle;
  $('useNetworkResponse').disabled = !record?.handle;
  $('networkResponse').value = record?.response || '';
  $('networkMessages').replaceChildren();
  const placeholder=document.createElement('option'); placeholder.value='';
  placeholder.textContent='Select the follower’s response (not your own message)';
  $('networkMessages').append(placeholder);
  for(const text of record?.messages || []) {
    const option=document.createElement('option'); option.value=text;
    option.textContent=text.slice(0,180); $('networkMessages').append(option);
  }
}
$('networkEnabled').addEventListener('change',()=>{
  $('networkControls').hidden=!$('networkEnabled').checked;
});
$('networkMessages').addEventListener('change',()=>{
  if($('networkMessages').value)$('networkResponse').value=$('networkMessages').value;
});
$('askFollower').addEventListener('click',async()=>{
  $('askFollower').disabled=true;
  try {
    if(!$('networkEnabled').checked)throw new Error('Enable Network first.');
    await persist();
    const {tab,id}=await activePost();
    if(!id)throw new Error('Open an X post or its timeline reply popup first.');
    await checkHistory(id);
    const post=await getPost(tab,id);
    if(!post?.text)throw new Error('Could not read this post.');
    $('networkStatus').textContent='Visiting your followers and looking for someone you can message…';
    showNetwork(await PandaNetwork.consult(tab,post,id,networkOptions()));
  }catch(e){setStatus(e.message);}finally{$('askFollower').disabled=false;}
});
async function openNetworkConversation(record) {
  const tabs=await chrome.tabs.query({url:['https://x.com/*','https://twitter.com/*']});
  const target=tabs.find(tab=>record.conversationUrl && tab.url===record.conversationUrl);
  if(target)await chrome.tabs.update(target.id,{active:true});
  else await chrome.tabs.create({url:record.conversationUrl || 'https://x.com/'+record.handle,active:true});
}
$('openNetwork').addEventListener('click',async()=>{
  try { await openNetworkConversation(networkRecord); }
  catch(e){setStatus(e.message);}
});
$('refreshNetwork').addEventListener('click',async()=>{
  $('refreshNetwork').disabled=true;
  try {
    const tabs=await chrome.tabs.query({url:['https://x.com/*','https://twitter.com/*']});
    const matching=tabs.find(tab=>tab.url===networkRecord.conversationUrl);
    const record=await PandaNetwork.refresh(networkRecord.key,matching?.id);
    showNetwork(record);
    if(record.state==='responded')await continueTransaction(record.key);
  }
  catch(e){setStatus(e.message);}finally{$('refreshNetwork').disabled=!networkRecord?.handle;}
});
$('useNetworkResponse').addEventListener('click',async()=>{
  try {
    const {tab,id}=await activePost();
    if(!id || id!==networkRecord?.postId)throw new Error('Return to the original X post first.');
    const identity=await PandaNetwork.identity(tab.id,id);
    if(identity.key!==networkRecord.key)throw new Error('The logged-in X account changed.');
    showNetwork(await PandaNetwork.useResponse(networkRecord.key,$('networkResponse').value));
    $('analyze').click();
  }catch(e){setStatus(e.message);}
});

function postId(url) {
  return new URL(url).pathname.match(/^\/[^/]+\/status\/(\d+)(?:\/|$)/)?.[1] || null;
}
const historyKey = id => 'replyHistory:' + id;
async function checkHistory(id) {
  const saved=await chrome.storage.local.get(historyKey(id));
  if(saved[historyKey(id)])throw new Error('Reply already tracked for this post. Duplicate reply blocked. See Reply history below.');
}
async function renderHistory() {
  const saved=await chrome.storage.local.get(null);
  const entries=Object.entries(saved).filter(([key])=>key.startsWith('replyHistory:'))
    .sort((a,b)=>b[1].time.localeCompare(a[1].time));
  $('historyList').replaceChildren();
  for(const [key,entry] of entries) {
    const row=document.createElement('div');
    const link=document.createElement('a');
    link.href='https://x.com/i/status/'+key.slice('replyHistory:'.length);
    link.target='_blank'; link.rel='noopener noreferrer';
    link.textContent=entry.state+' — '+new Date(entry.time).toLocaleString();
    const undo=document.createElement('button'); undo.textContent='Remove';
    undo.addEventListener('click',async()=>{
      try { await navigator.locks.request(key,async()=>chrome.storage.local.remove(key)); await renderHistory(); }
      catch(e){setStatus(e.message);}
    });
    row.append(link,undo); $('historyList').append(row);
  }
  if(!entries.length)$('historyList').textContent='No tracked posts yet.';
}
renderHistory().catch(e=>setStatus('Could not load reply history: '+e.message));
$('markCommented').addEventListener('click',async()=>{
  try {
    const {tab,id}=await activePost();
    if(!id)throw new Error('Open an X post or its timeline reply popup first.');
    await navigator.locks.request(historyKey(id),async()=>{
      await chrome.storage.local.set({[historyKey(id)]:{state:'Marked commented',time:new Date().toISOString()}});
    });
    await renderHistory(); setStatus('Post marked commented. Future duplicate replies are blocked.');
  }catch(e){setStatus(e.message);}
});

async function activeTab(){
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab?.id || !/^https:\/\/(x\.com|twitter\.com)\//.test(tab.url||''))throw new Error('Open an X post (x.com) first.');
  return tab;
}
async function activePost() {
  const context=await syncActiveContext();
  if(!context.id)throw new Error('Open a post or its reply popup on the timeline first.');
  return context;
}
async function getPost(tab,expectedId){
  for(let attempt=0;attempt<20;attempt++) {
    const actual=await chrome.tabs.get(tab.id);
    if(!/^https:\/\/(x\.com|twitter\.com)\//.test(actual.url || ''))throw new Error('Return to X to generate a reply.');
    const results=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:PandaPostReader.read,args:[expectedId]});
    if(results[0]?.result)return results[0].result;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw new Error('The current post is still loading or cannot be read. Try Generate again.');
}
function analyze(text){
  return {
    hasQuestion:/\?|\b(convince me|thoughts|which|what|why|how|pick one|one ticker)\b/i.test(text),
    crypto:/\b(SOL|BTC|ETH|ticker|crypto|token|coin|memecoin)\b/i.test(text),
    asksForTicker:/\b(one ticker|pick (a|one) ticker|which ticker|name (a|one) ticker)\b/i.test(text),
    cautions:'Do not invent facts, prices, partnerships, guarantees or returns.'
  };
}
const generateWithAI = PandaReply.generate;
async function logToPanda(post,assessment,reply){
  await PandaAudit.save(post, assessment, reply, $('pandaToken').value.trim());
}
function networkOptions() {
  return {instructions:$('instructions').value,keyPoint:$('custom').value,tone:$('tone').value};
}
async function continueTransaction(key) {
  const result=await chrome.runtime.sendMessage({type:'panda-network-resume',key});
  if(!result?.ok)throw new Error(result?.error || 'Could not resume the Network transaction.');
  return result.record;
}
function displayReply(tab,post,reply) {
  const assessment=analyze(post.text), id=postId(post.url);
    $('draft').value=reply;
    $('analysis').textContent=`PERCEPTIONS — [X post: ${post.text.slice(0,700)}]\n\nANALYSIS — ${assessment.hasQuestion?'Request/question':'Statement'}${assessment.crypto?'; crypto topic':''}${assessment.asksForTicker?'; asks for a single ticker':''}.\n\nNETWORK — ${post.network ? '@'+post.network.handle+' replied (Network perspective): '+post.network.response+'\n\n' : ''}${post.relatedPosts.length ? 'Visible context (unverified): '+post.relatedPosts.map(item => item.account+': '+item.text.slice(0,250)).join(' | ') : post.network ? 'No additional visible posts checked.' : 'No other accounts checked.'}\n\nDECISION — OpenAI generated the draft using your instructions${post.network ? ' and the follower perspective' : ''}.\n\nACTION — Review and insert manually.`;
    $('analysisSection').hidden=false;
    current={tabId:tab.id,url:post.url,postId:id};$('insert').disabled=false;
    setStatus('Reply ready. Review before inserting.');
}
let lastLoadedNetworkDraft='';
async function loadNetworkForActivePost() {
  const {tab,id,epoch}=await syncActiveContext();
  if($('analyze').disabled)return;
  if(!id)return;
  const {key}=await PandaNetwork.identity(tab.id,id);
  const saved=await PandaNetwork.get(key);
  if(!await stillCurrent(epoch) || $('analyze').disabled)return;
  if(saved && JSON.stringify({...saved,key})!==JSON.stringify(networkRecord))showNetwork({...saved,key});
  else if(networkRecord?.postId!==id)showNetwork(null);
  if(saved?.state==='ready' && saved.post && saved.draft && ($('networkEnabled').checked || !current)) {
    const stamp=key+':'+saved.completedAt+':'+tab.id;
    if(stamp!==lastLoadedNetworkDraft) {
      await checkHistory(id);
      if(!await stillCurrent(epoch) || $('analyze').disabled)return;
      displayReply(tab,{...saved.post,network:{handle:saved.handle,response:saved.response}},saved.draft);
      lastLoadedNetworkDraft=stamp;
    }
  }
}
async function renderTransactions() {
  const stored=await chrome.storage.local.get(null);
  const entries=Object.entries(stored).filter(([key])=>key.startsWith('networkConsultation:'))
    .sort((a,b)=>b[1].time.localeCompare(a[1].time));
  $('networkTransactions').replaceChildren();
  for(const [key,record] of entries) {
    const row=document.createElement('div');row.className='transaction';
    const info=document.createElement('p');
    info.textContent='@'+record.owner+' → '+(record.handle ? '@'+record.handle : 'finding follower')+' · Post '+record.postId+' · '+record.state+' · '+new Date(record.time).toLocaleString();
    if(record.error)info.textContent+=' · '+record.error;
    const controls=document.createElement('div');controls.className='actions';
    const post=document.createElement('button');post.textContent=record.state==='ready' ? 'View draft' : 'Open post';
    post.addEventListener('click',()=>chrome.tabs.create({url:record.postUrl,active:true}).catch(e=>setStatus(e.message)));
    controls.append(post);
    if(record.handle) {
      const dm=document.createElement('button');dm.textContent='Open follower DM';
      dm.addEventListener('click',async()=>{
        try {
          await openNetworkConversation(record);
        }catch(e){setStatus(e.message);}
      });controls.append(dm);
    }
    if(!['ready','cancelled','failed'].includes(record.state)) {
      const stop=document.createElement('button');stop.textContent='Stop transaction';
      stop.addEventListener('click',async()=>{
        const result=await chrome.runtime.sendMessage({type:'panda-network-cancel',key});
        if(!result?.ok)setStatus(result?.error || 'Could not stop transaction.');
      });controls.append(stop);
    }
    row.append(info,controls);$('networkTransactions').append(row);
  }
  if(!entries.length)$('networkTransactions').textContent='No Network transactions yet.';
}
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==='local' && Object.keys(changes).some(key=>key.startsWith('networkConsultation:'))) {
    renderTransactions().catch(e=>setStatus(e.message));
    loadNetworkForActivePost().catch(()=>{});
  }
});
chrome.tabs.onActivated.addListener(()=>loadNetworkForActivePost().catch(()=>{}));
chrome.tabs.onUpdated.addListener((tabId,change)=>{
  if(change.url || change.status==='complete')loadNetworkForActivePost().catch(()=>{});
});
renderTransactions().catch(e=>setStatus(e.message));
loadNetworkForActivePost().catch(()=>{});
setInterval(()=>loadNetworkForActivePost().catch(()=>{}),1000);

$('analyze').addEventListener('click',async()=>{
  const {epoch}=await syncActiveContext();
  const serial=++generationSerial;
  clearPostView();
  $('analyze').disabled=true; $('insert').disabled=true;current=null;
  try{
    await persist();
    const key=$('apiKey').value.trim();
    if(!key){$('settings').open=true;throw new Error('Enter an OpenAI API key in AI settings to generate a real reply.');}
    setStatus('Reading post…');
    const {tab,id}=await activePost();
    if(!id)throw new Error('Open an X post or its timeline reply popup first.');
    await checkHistory(id);
    const post=await getPost(tab,id);
    if(!post?.text)throw new Error('Cannot read the post. Open a single X post and try again.');
    if(!await stillCurrent(epoch,serial))return;
    let savedDraft=null;
    if($('networkEnabled').checked) {
      $('networkStatus').textContent='Checking follower consultation for this post…';
      let record=await PandaNetwork.consult(tab,post,id,networkOptions());
      if(!await stillCurrent(epoch,serial))return;
      showNetwork(record);
      if(['responded','generation_failed'].includes(record.state))record=await continueTransaction(record.key);
      if(!await stillCurrent(epoch,serial))return;
      showNetwork(record);
      if(record.state!=='ready') {
        setStatus(['failed','generation_failed'].includes(record.state) ? record.error : 'Network transaction saved. It will continue when the follower replies on the DM page.');
        return;
      }
      post.network={handle:record.handle,response:record.response};
      savedDraft=record.draft;
    }
    const assessment=analyze(post.text);
    setStatus('Generating a contextual reply…');
    const reply=savedDraft || await generateWithAI(key,post,$('instructions').value,$('custom').value,$('tone').value);
    if(!await stillCurrent(epoch,serial))return;
    displayReply(tab,post,reply);
    if($('runtime').checked){try{await logToPanda(post,assessment,reply);if(await stillCurrent(epoch,serial))setStatus('Reply ready. PANDA log saved.');}catch(e){if(await stillCurrent(epoch,serial))setStatus('Reply ready. Optional PANDA log failed: '+e.message);}}
  }catch(e){if(await stillCurrent(epoch,serial))setStatus(e.message)}finally{if(serial===generationSerial){$('analyze').disabled=false;loadNetworkForActivePost().catch(()=>{});}}
});
$('insert').addEventListener('click',async()=>{
  const reply=$('draft').value.trim();
  if(!current || !reply){setStatus('Generate or write a reply first.');return;}
  $('insert').disabled=true;
  const target={...current};
  try{
    const {tab,id}=await activePost();
    if(tab.id!==target.tabId||id!==target.postId)throw new Error('Return to the original post before inserting.');
    await navigator.locks.request(historyKey(target.postId),async()=>{
    await checkHistory(target.postId);
    await navigator.clipboard.writeText(reply);
    // Reserve durably before editing so a second panel cannot insert again.
    await chrome.storage.local.set({[historyKey(target.postId)]:{state:'Reply prepared (publication unconfirmed)',time:new Date().toISOString()}});
    const result=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:PandaPostReader.read,args:[target.postId,false,reply]});
    setStatus(result[0]?.result||'Post changed. Return to the original post or its reply popup before inserting.');
    });
    await renderHistory();
  }catch(e){setStatus(e.message)}finally{$('insert').disabled=!current;}
});
$('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('draft').value);setStatus('Reply copied.');}catch(e){setStatus('Could not copy: '+e.message);}});
