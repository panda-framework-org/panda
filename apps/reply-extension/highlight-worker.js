importScripts('highlight-patterns.js');
self.onmessage=event=>{
  try {self.postMessage({ok:true,ranges:PandaHighlightPatterns.match(event.data.texts,event.data.patterns)});}
  catch(error){self.postMessage({ok:false,error:error.message});}
};
