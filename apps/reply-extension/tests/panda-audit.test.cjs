const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function audit(fetch) {
  const context = vm.createContext({fetch});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../panda-audit.js'), 'utf8') + '\nglobalThis.audit = PandaAudit;', context);
  return context.audit;
}
test('saves a flow record with authentication without claiming publication', async () => {
  let request;
  const api = audit(async (url, options) => {request = {url, ...options}; return {ok:true,json:async()=>({id:'saved'})};});
  await api.save({url:'https://x.com/user/status/123',text:'Source'}, {}, 'Analysis: Check sources\nNetwork: No other accounts checked\nDecision: Wait\nAction: Read', 'secret');
  assert.equal(request.url, 'http://127.0.0.1:4317/flow-records');
  assert.equal(request.headers.Authorization, 'Bearer secret');
  const body = JSON.parse(request.body);
  assert.equal(body.analysis, 'Check sources');
  assert.equal(body.decision, 'Wait');
  assert.match(body.action, /publication unconfirmed/);
  assert.equal(Object.keys(body).length, 6);
  assert.ok(!request.body.includes('secret'));
});
test('surfaces daemon failures for optional logging', async () => {
  await assert.rejects(audit(async()=>({ok:false,status:401})).save({text:'Source'}, {}, 'Draft'), /401/);
});
