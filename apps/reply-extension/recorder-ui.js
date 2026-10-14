const PandaRecordingExport = (() => {
  const escape=value=>String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const link=(url,label)=>{
    try {if(!/^https?:$/.test(new URL(url).protocol))return '';}
    catch{return '';}
    return `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(label || url)}</a>`;
  };
  function html(session,entries) {
    return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PANDA browsing recording</title><style>body{max-width:900px;margin:40px auto;padding:0 20px;font:16px/1.5 system-ui;color:#172b20;background:#f4f7f5}article{background:white;padding:24px;margin:20px 0;border:1px solid #cedbd2;border-radius:12px}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}a{color:#176441;overflow-wrap:anywhere}small{color:#526258}</style><h1>PANDA browsing recording</h1><p>'+escape(session.startedAt)+' · '+entries.length+' recorded posts</p><p>Post text and source links captured while browsing. Media files are not embedded.</p>'+entries.map(entry=>'<article><small>'+escape(entry.platform)+' · '+escape(entry.firstSeen)+'</small><h2>'+escape(entry.author || 'Post')+'</h2><p>'+link(entry.postUrl,'Open original post')+'</p><pre>'+escape(entry.text)+'</pre>'+((entry.media || []).length?'<details><summary>Media links</summary>'+entry.media.map(media=>'<p>'+link(media.url,media.alt || media.type || 'Media')+' '+link(media.poster,'Video poster')+'</p>').join('')+'</details>':'')+'</article>').join('')+'</html>';
  }
  return {html};
})();
(() => {
  const element=id=>document.getElementById(id);
  let sessions=[],active=null;
  async function render() {
    const saved=await chrome.storage.local.get(['browsingRecorder','browsingSessions']);
    active=saved.browsingRecorder;sessions=saved.browsingSessions || [];
    const selected=element('recordingSession').value;
    element('recordingSession').replaceChildren();
    for(const session of sessions) {
      const option=document.createElement('option');option.value=session.id;
      option.textContent=new Date(session.startedAt).toLocaleString()+' · '+session.count+' posts'+(session.active?' · recording':'');
      element('recordingSession').append(option);
    }
    if(sessions.some(session=>session.id===selected))element('recordingSession').value=selected;
    element('recordInstagram').disabled=Boolean(active?.active);
    if(active?.active)element('recordInstagram').checked=Boolean(active.includeInstagram);
    element('recordStart').disabled=Boolean(active?.active);
    element('recordStop').disabled=!active?.active;
    element('recordJSON').disabled=element('recordHTML').disabled=!sessions.length;
    element('recordingStatus').textContent=active?.error || (active?.active?'Recording visible posts locally · '+active.count+' posts. Continues until you press Stop.':active?'Stopped · '+active.count+' posts saved.':'Not recording.');
  }
  element('recordStart').addEventListener('click',async()=>{
    element('recordStart').disabled=true;
    try {
      if(element('recordInstagram').checked) {
        const granted=await chrome.permissions.request({origins:['https://www.instagram.com/*','https://instagram.com/*']});
        if(!granted)throw Error('Instagram access was not granted. Uncheck Instagram to record X only.');
      }
      const result=await chrome.runtime.sendMessage({type:'panda-recorder-start',includeInstagram:element('recordInstagram').checked});
      if(!result?.ok)throw Error(result?.error || 'Could not start recording.');
      await render();
    }catch(error){await render();element('recordingStatus').textContent=error.message;}
  });
  element('recordStop').addEventListener('click',async()=>{
    try {
      const result=await chrome.runtime.sendMessage({type:'panda-recorder-stop'});
      if(!result?.ok)throw Error(result?.error || 'Could not stop recording.');
      await render();
    }catch(error){element('recordingStatus').textContent=error.message;}
  });
  async function download(format) {
    const session=sessions.find(item=>item.id===element('recordingSession').value);
    if(!session)return;
    try {
      const entries=await PandaRecorderStore.entries(session.id);
      const content=format==='json'?JSON.stringify({formatVersion:1,session,entries},null,2):PandaRecordingExport.html(session,entries);
      const url=URL.createObjectURL(new Blob([content],{type:format==='json'?'application/json':'text/html;charset=utf-8'}));
      const anchor=document.createElement('a');anchor.href=url;
      anchor.download='panda-browsing-'+session.startedAt.replace(/[:.]/g,'-')+'.'+format;
      document.body.append(anchor);anchor.click();anchor.remove();
      setTimeout(()=>URL.revokeObjectURL(url),30000);
      element('recordingStatus').textContent='Downloaded '+entries.length+' posts'+(session.active?' (snapshot; recording continues).':'.');
    }catch(error){element('recordingStatus').textContent='Download failed: '+error.message;}
  }
  element('recordJSON').addEventListener('click',()=>download('json'));
  element('recordHTML').addEventListener('click',()=>download('html'));
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==='local' && (changes.browsingRecorder || changes.browsingSessions))render().catch(()=>{});
  });
  render().catch(error=>element('recordingStatus').textContent=error.message);
})();
