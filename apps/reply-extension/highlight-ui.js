(() => {
  const element=id=>document.getElementById(id);
  function validate() {
    const result=PandaHighlightPatterns.parse(element('highlightPositive').value,element('highlightNegative').value);
    element('highlightStatus').textContent=result.errors.length?result.errors.join('\n'):
      result.patterns.filter(rule=>rule.kind==='positive').length+' positive rules · '+result.patterns.filter(rule=>rule.kind==='negative').length+' negative rules. Press Save to apply.';
    element('highlightSave').disabled=Boolean(result.errors.length);
    return result;
  }
  for(const id of ['highlightPositive','highlightNegative'])element(id).addEventListener('input',validate);
  element('highlightSave').addEventListener('click',async()=>{
    if(validate().errors.length)return;
    element('highlightSave').disabled=true;
    try {
      const settings={enabled:element('highlightEnabled').checked,instagram:element('highlightInstagram').checked,
        positive:element('highlightPositive').value,negative:element('highlightNegative').value};
      if(settings.enabled && settings.instagram && !await chrome.permissions.request({origins:['https://www.instagram.com/*','https://instagram.com/*']}))throw Error('Instagram access was not granted. Uncheck Instagram to highlight X only.');
      await chrome.storage.local.set({keywordHighlights:settings,highlightLastError:null});
      const result=await chrome.runtime.sendMessage({type:'panda-highlight-install'});
      if(!result?.ok)throw Error(result?.error || 'Could not apply highlights.');
      element('highlightStatus').textContent=settings.enabled?'Saved. Positive matches are green; negative matches are red.':'Saved. Highlights are off.';
    }catch(error){element('highlightStatus').textContent=error.message;}finally{element('highlightSave').disabled=false;}
  });
  chrome.storage.local.get(['keywordHighlights','highlightLastError']).then(saved=>{
    const settings=saved.keywordHighlights || {};
    element('highlightEnabled').checked=Boolean(settings.enabled);element('highlightInstagram').checked=Boolean(settings.instagram);
    element('highlightPositive').value=settings.positive || '';element('highlightNegative').value=settings.negative || '';
    element('highlightStatus').textContent=saved.highlightLastError || (settings.enabled?'Highlighting is enabled.':'Highlighting is off.');
  });
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==='local' && changes.highlightLastError?.newValue)element('highlightStatus').textContent=changes.highlightLastError.newValue;
  });
})();
