const PandaPostReader = {
  // Self-contained because Chrome serializes this function into the X page.
  read: function(expectedId = null, metadataOnly = false, insertMessage) {
    const statusId = href => {
      try {return new URL(href,location.href).pathname.match(/^\/[^/]+\/status\/(\d+)(?:\/|$)/)?.[1] || null;}
      catch{return null;}
    };
    const ownLink = article => {
      const time=[...article.querySelectorAll('time')].find(node=>node.closest('article, [data-testid="tweet"]')===article);
      return time?.closest('a')?.href || article.querySelector?.('[data-testid="User-Name"] a[href*="/status/"]')?.href || null;
    };
    const comparable = value => (value || '').toLowerCase().replace(/(?:https?:\/\/\s*)?pic\.(?:x|twitter)\.com\/[^\s]+/g,'').replace(/\s+/g,'').trim();
    const articleText = article => article?.querySelector('[data-testid="tweetText"]')?.innerText?.trim() || '';
    const author = article => {
      const link=article.querySelector('[data-testid="User-Name"] a[href]');
      if(!link?.getAttribute('href'))return null;
      try {return new URL(link.getAttribute('href'),location.href).pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/)?.[1]?.toLowerCase() || null;}
      catch{return null;}
    };
    const articles=[...document.querySelectorAll('article, [data-testid="tweet"]')];
    const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(dialog=>
      dialog.getClientRects().length && dialog.querySelector('[data-testid="tweetTextarea_0"], [data-testid="tweetTextarea_1"], [role="textbox"][contenteditable="true"]'));
    const dialog=dialogs.at(-1);
    let article,href,id;
    if(dialog) {
      article=[...dialog.querySelectorAll('article, [data-testid="tweet"]')].find(candidate=>articleText(candidate));
      href=article ? ownLink(article) : null;
      id=statusId(href);
      if(!id) {
        // X's compact reply preview may have no article, tweet marker, or timestamp.
        // Exclude the editable draft, then match both the visible source text and @author.
        const preview=dialog.cloneNode(true);
        preview.querySelectorAll('[role="textbox"], textarea, [contenteditable="true"]').forEach(node=>node.remove());
        const visible=(preview.innerText || preview.textContent || '').replace(/\s+/g,' ').trim().toLowerCase();
        const name=article ? author(article) : null;
        const text=article ? articleText(article).replace(/\s+/g,' ').trim().toLowerCase() : null;
        const matches=articles.filter(candidate=>{
          if(dialog.contains(candidate) || !statusId(ownLink(candidate)))return false;
          const candidateName=author(candidate),candidateText=articleText(candidate).replace(/\s+/g,' ').trim().toLowerCase();
          if(!candidateName || !candidateText)return false;
          if(name && text)return candidateName===name && comparable(candidateText)===comparable(text);
          const handlePattern=new RegExp('(^|[^a-z0-9_])@'+candidateName+'(?=$|[^a-z0-9_])');
          const handleShown=[...preview.querySelectorAll('span')].some(node=>node.textContent?.trim().toLowerCase()==='@'+candidateName);
          return comparable(visible).includes(comparable(candidateText)) && (handleShown || handlePattern.test(visible));
        });
        if(matches.length===1) {
          article=matches[0];href=ownLink(article);id=statusId(href);
        } else {
          // Virtualized timelines may unload the source. Read only the preview's React props.
          const source=article || dialog.querySelector('[data-testid="tweetText"]');
          if(!source)return null;
          const sourceText=articleText(article) || source.innerText || '';
          const sourceComparable=value=>comparable((value || '').replace(/https?:\/\/[^\s]+/g,''));
          const handles=[...preview.querySelectorAll('span')].map(node=>node.textContent?.trim().toLowerCase())
            .filter(value=>/^@[a-z0-9_]{1,15}$/.test(value || ''));
          const found=new Map(),seen=new WeakSet();let visited=0;
          function inspect(value,depth) {
            if(!value || typeof value!=='object' || depth>7 || visited++>2500 || seen.has(value))return;
            seen.add(value);
            const legacy=value.legacy || value;
            const fullText=legacy.full_text || value.fullText || value.text;
            const tweetId=legacy.id_str || value.rest_id || value.id_str || value.id;
            const user=value.core?.user_results?.result || value.user;
            const screenName=user?.legacy?.screen_name || user?.core?.screen_name || user?.screen_name || user?.screenName;
            if(typeof fullText==='string' && /^\d+$/.test(String(tweetId)) && typeof screenName==='string' &&
                handles.includes('@'+screenName.toLowerCase()) && sourceComparable(fullText)===sourceComparable(sourceText)) {
              found.set(String(tweetId),{id:String(tweetId),handle:screenName});
            }
            for(const [key,child] of Object.entries(value)) {
              if(['children','ref','_owner'].includes(key))continue;
              inspect(child,depth+1);
            }
          }
          for(let element=source; element && element!==dialog.parentElement;element=element.parentElement) {
            const propsKey=Object.keys(element).find(key=>key.startsWith('__reactProps$'));
            if(propsKey)inspect(element[propsKey],0);
            const fiberKey=Object.keys(element).find(key=>key.startsWith('__reactFiber$'));
            let fiber=fiberKey && element[fiberKey];
            for(let level=0;fiber && level<16;level++,fiber=fiber.return)inspect(fiber.memoizedProps,0);
          }
          if(found.size!==1)return null;
          const target=[...found.values()][0];
          id=target.id;href='https://x.com/'+target.handle+'/status/'+id;
          article=article || {querySelector:()=>source};
        }
      }
    } else {
      id=statusId(location.href);
      if(!id)return null;
      article=articles.find(candidate=>statusId(ownLink(candidate))===id);
      href=ownLink(article || {querySelectorAll:()=>[]});
    }
    if(!id || !article || (expectedId && id!==expectedId))return null;
    const text=articleText(article);
    if(!text)return null;
    const url=new URL(href,location.href);
    // Always store the real post permalink, rather than /home or /compose/post.
    const post={text,url:url.origin+url.pathname,postId:id,isModal:Boolean(dialog)};
    if(insertMessage!==undefined) {
      const scope=dialog || document;
      const editor=scope.querySelector('[data-testid="tweetTextarea_0"], [data-testid="tweetTextarea_1"], [role="textbox"][contenteditable="true"]');
      if(!editor)return 'Reply copied. Open the reply editor on X and paste with Ctrl+V (Windows) or Cmd+V (Mac).';
      editor.focus();
      const selection=window.getSelection(),range=document.createRange();
      range.selectNodeContents(editor);selection.removeAllRanges();selection.addRange(range);
      const clipboard=new DataTransfer();clipboard.setData('text/plain',insertMessage);
      const paste=new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true});
      editor.dispatchEvent(paste);
      return new Promise(resolve=>setTimeout(()=>{
        const actual=(editor.innerText || '').replace(/\s+/g,'').trim();
        const expected=insertMessage.replace(/\s+/g,'').trim();
        resolve(actual===expected ? 'Full reply pasted into the editor. Review it and press Reply yourself.' :
          'Reply copied. X did not accept the paste automatically. Select the editor text and paste with Cmd+V (Mac) or Ctrl+V (Windows).');
      },150));
    }
    if(metadataOnly)return {postId:id,url:post.url,isModal:post.isModal};
    post.relatedPosts=dialog ? [] : articles.filter(other=>other!==article).map(other=>({
      account:other.querySelector('[data-testid="User-Name"]')?.innerText?.trim() || 'Unknown account',text:articleText(other)
    })).filter(other=>other.text && other.text!==text).slice(0,5);
    return post;
  }
};
