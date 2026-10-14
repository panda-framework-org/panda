const PandaRecorderStore = (() => {
  let database;
  async function db() {
    if(!database)database=new Promise((resolve,reject)=>{
      const request=indexedDB.open('panda-browsing-recordings',1);
      request.onupgradeneeded=()=>{
        const store=request.result.createObjectStore('entries',{keyPath:'id'});
        store.createIndex('sessionId','sessionId');
      };
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    return database;
  }
  async function save(sessionId,items) {
    const database=await db();
    return new Promise((resolve,reject)=>{
      const transaction=database.transaction('entries','readwrite'),store=transaction.objectStore('entries');
      let added=0;
      for(const item of new Map(items.map(item=>[item.key,item])).values()) {
        const id=sessionId+':'+item.key,request=store.get(id);
        request.onsuccess=()=>{
          const existing=request.result;
          store.put({...item,id,sessionId,firstSeen:existing?.firstSeen || item.seenAt,lastSeen:item.seenAt,
            views:(existing?.views || 0)+1});
          if(!existing)added++;
        };
      }
      transaction.oncomplete=()=>resolve(added);
      transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error || Error('Recording storage failed.'));
    });
  }
  async function entries(sessionId) {
    const database=await db();
    return new Promise((resolve,reject)=>{
      const request=database.transaction('entries').objectStore('entries').index('sessionId').getAll(sessionId);
      request.onsuccess=()=>resolve(request.result.sort((a,b)=>a.firstSeen.localeCompare(b.firstSeen)));
      request.onerror=()=>reject(request.error);
    });
  }
  return {save,entries};
})();
