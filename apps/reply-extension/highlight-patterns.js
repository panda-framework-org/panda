const PandaHighlightPatterns = (() => {
  function parse(positive='',negative='') {
    const patterns=[],errors=[];
    for(const [kind,list] of [['positive',positive],['negative',negative]]) {
      const lines=String(list).split(/\r?\n/);
      for(let index=0;index<lines.length;index++) {
        const value=lines[index].trim();if(!value)continue;
        if(patterns.length>=100){errors.push('Use at most 100 rules in total.');break;}
        if(value.length>300){errors.push(`${kind} line ${index+1}: rule exceeds 300 characters.`);continue;}
        try {
          let source,flags;
          if(value.startsWith('/')) {
            const end=value.lastIndexOf('/');if(end===0)throw Error('Use /expression/flags for regex rules.');
            source=value.slice(1,end);flags=value.slice(end+1);
            if(!source)throw Error('Empty regex rule.');
            if(!/^[gimsu]*$/.test(flags) || new Set(flags).size!==flags.length)throw Error('Supported flags: g, i, m, s, u (no duplicates).');
            flags=flags.includes('g')?flags:flags+'g';
          } else {source=value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');flags='gi';}
          new RegExp(source,flags);
          patterns.push({kind,source,flags});
        }catch(error){errors.push(`${kind} line ${index+1}: ${error.message}`);}
      }
    }
    return {patterns,errors};
  }
  function match(texts,patterns) {
    return texts.map(text=>{
      const ranges=[];
      for(const pattern of patterns) {
        const regex=new RegExp(pattern.source,pattern.flags);
        let result;
        while((result=regex.exec(text)) && ranges.length<500) {
          if(result[0].length)ranges.push({start:result.index,end:result.index+result[0].length,kind:pattern.kind});
          else regex.lastIndex+=regex.unicode && text.codePointAt(regex.lastIndex)>0xffff ? 2 : 1;
        }
      }
      return ranges;
    });
  }
  return {parse,match};
})();
