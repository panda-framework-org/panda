const features = [
  ['Contextual replies', 'Generate a staged draft from an X post, your instructions, key point and tone. Edit, copy or insert it, then publish manually.'],
  ['Follower consultations', 'Opt in to ask a follower by DM. Saved transactions wait for their response and prepare a draft for review, including after browser restarts.'],
  ['Reply history', 'Track prepared replies by post ID, mark manual comments and remove entries when an unpublished draft needs another attempt.'],
  ['Browse recorder', 'Record visible X and optional Instagram posts locally. Export saved sessions as structured JSON or readable HTML.'],
  ['Keyword highlights', 'Use positive and negative words or regular expressions to highlight post text. Negative matches take priority.'],
  ['PANDA Flow records', 'Enable optional logging in the companion to save the source, assessment and draft here. Records describe prepared drafts; publication is unconfirmed.'],
];

export function BrowserCompanion() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand-lockup brand-link" href="#/">PANDA</a>
        <nav className="topbar-actions" aria-label="Main navigation">
          <a className="topbar-flow-link" href="#/">Dashboard</a>
          <a className="topbar-flow-link" href="#/flow-records">Flow records</a>
        </nav>
      </header>
      <section className="hero">
        <div>
          <div className="eyebrow">Browser companion · v1.7</div>
          <h1>PANDA, alongside your social feed.</h1>
          <p>Draft replies, consult followers, collect posts and highlight keywords using the PANDA Chrome side panel.</p>
        </div>
      </section>
      <section className="panel companion-install">
        <h2>Connect the browser companion</h2>
        <ol>
          <li>In Chrome 116 or newer, open <code>chrome://extensions</code> and enable Developer mode.</li>
          <li>Choose <strong>Load unpacked</strong> and select <code>apps/reply-extension</code> inside your PANDA project folder.</li>
          <li>Open X and click the PANDA toolbar icon to open its side panel.</li>
          <li>Enter your OpenAI API key under <strong>OpenAI API settings</strong> for reply generation.</li>
          <li>To save drafts here, enable <strong>save draft to PANDA Flow records</strong>. If the daemon uses bearer authentication, enter its token in the companion.</li>
        </ol>
        <p>Keep the PANDA daemon running at <code>127.0.0.1:4317</code> for logging. Reload the extension in Chrome after updating its files.</p>
        <p>Keys and tokens stay in local Chrome extension storage, which is not encrypted by the companion. Draft generation sends the selected post, visible context and any selected follower response to OpenAI. Recording and highlighting run locally. Instagram access and follower DMs are opt in.</p>
        <a className="home-flow-link" href="#/flow-records">View saved reply drafts →</a>
      </section>
      <section className="companion-features" aria-label="Browser companion features">
        {features.map(([title, description]) => (
          <article className="panel companion-feature" key={title}>
            <h2>{title}</h2><p>{description}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
