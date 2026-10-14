// Browser companion records are observations and drafts, not verified publications.
const PandaAudit = (() => {
  function fields(post, assessment, reply) {
    const stage = name => reply.match(new RegExp('^' + name + ': (.+)$', 'm'))?.[1];
    const bounded = value => String(value).slice(0, 10000);
    return {
      title: ('X reply draft · ' + (post.url || 'source post')).slice(0, 200),
      perception: bounded((post.url || '') + '\n' + post.text),
      analysis: bounded(stage('Analysis') || JSON.stringify(assessment)),
      network: bounded(stage('Network') || 'No other accounts checked'),
      decision: bounded(stage('Decision') || 'Draft prepared for review'),
      action: bounded('Draft prepared; publication unconfirmed.\n' + reply)
    };
  }
  async function save(post, assessment, reply, token = '') {
    const headers = {'content-type': 'application/json'};
    if (token) headers.Authorization = 'Bearer ' + token;
    const response = await fetch('http://127.0.0.1:4317/flow-records', {
      method: 'POST', headers, body: JSON.stringify(fields(post, assessment, reply))
    });
    if (!response.ok) throw new Error('PANDA daemon HTTP ' + response.status);
    return response.json();
  }
  return {fields, save};
})();
