chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type!=='panda-highlight-worker')return;
  const worker=new Worker('highlight-worker.js');
  let finished=false;
  const finish=result=>{if(finished)return;finished=true;clearTimeout(timeout);worker.terminate();respond(result);};
  // User regex executes outside the website's UI thread and is forcibly time-limited.
  const timeout=setTimeout(()=>finish({ok:false,error:'A regex rule took too long. Simplify the expression and save again.'}),300);
  worker.onmessage=event=>finish(event.data);
  worker.onerror=()=>finish({ok:false,error:'Could not evaluate highlight rules.'});
  worker.postMessage({texts:message.texts,patterns:message.patterns});
  return true;
});
