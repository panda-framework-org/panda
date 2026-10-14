importScripts('network.js','reply-engine.js','transactions.js','recorder-store.js','recorder-background.js','highlight-patterns.js','highlight-background.js');
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true})
  .catch(error=>console.error('Could not configure PANDA side panel:',error));

// Alarms survive worker suspension; storage survives closing panels and restarting Chrome.
async function ensureMonitoring() {
  await chrome.alarms.create('panda-network',{periodInMinutes:1});
  await PandaTransactions.scan();
}
chrome.runtime.onInstalled.addListener(()=>ensureMonitoring().catch(console.error));
chrome.runtime.onStartup.addListener(()=>ensureMonitoring().catch(console.error));
chrome.alarms.onAlarm.addListener(alarm=>{
  if(alarm.name==='panda-network')PandaTransactions.scan().catch(console.error);
});
chrome.tabs.onUpdated.addListener((tabId,change)=>{
  if(change.status==='complete')PandaTransactions.scan(tabId).catch(console.error);
});
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  let task;
  if(message?.type==='panda-network-page' && sender.tab && /^https:\/\/(x\.com|twitter\.com)\//.test(sender.url || '')) {
    task=PandaTransactions.scan(sender.tab.id);
  } else if(!sender.tab && message?.type==='panda-network-resume') {
    task=PandaTransactions.resume(message.key);
  } else if(!sender.tab && message?.type==='panda-network-cancel') {
    task=PandaTransactions.cancel(message.key);
  } else return;
  Promise.resolve(task).then(record=>sendResponse({ok:true,record}),error=>sendResponse({ok:false,error:error.message}));
  return true;
});
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=='local')return;
  if(Object.entries(changes).some(([key,change])=>key.startsWith('networkConsultation:') && change.newValue?.state==='responded')) {
    PandaTransactions.scan().catch(console.error);
  }
  if(Object.keys(changes).some(key=>key.startsWith('replyHistory:')))PandaTransactions.badge().catch(console.error);
});
ensureMonitoring().catch(console.error);

chrome.runtime.onInstalled.addListener(()=>PandaHighlightService.install().catch(console.error));
chrome.runtime.onStartup.addListener(()=>PandaHighlightService.install().catch(console.error));
