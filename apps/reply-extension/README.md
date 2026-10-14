# PANDA browser companion integration

This extension is bundled with the PANDA workspace. Load this directory
(`apps/reply-extension`) unpacked in Chrome. The dashboard links to setup at
`http://127.0.0.1:5173/#/browser-companion`; the side panel links back there.

In API settings, enable **save draft to PANDA Flow records** to save generated
drafts to the existing daemon at `127.0.0.1:4317`. Supply the PANDA bearer token
if configured. This saves observations and drafts, not verified publications
or coordinator executions. API keys and tokens are stored locally in Chrome.
Background follower transactions retain drafts in extension storage; optional
Flow record logging applies to foreground Generate operations.

Run `pnpm --filter @panda/reply-extension test` for simulated browser checks,
and `pnpm --filter @panda/reply-extension build` for asset and syntax checks.
The original extension usage and release notes follow; references below to
filesystem execution audit logging describe the standalone version and are
superseded by the Flow records integration above.

# PANDA Reply Assistant 1.5

## Fix
The original extension used four generic reply templates and only printed PANDA-style analysis. This version actually calls OpenAI to draft a contextual reply from the post text and your instructions. The analysis trace is hidden under a disclosure panel; only the generated reply goes to the editable draft and X reply field.

## Install
1. Unzip the ZIP. In Chrome, visit `chrome://extensions` and enable Developer mode.
2. Click **Load unpacked**, choosing the extracted `panda-reply-extension` folder. If upgrading, remove or reload the older version.
3. Navigate to an individual post on `x.com` or `twitter.com`.
4. Click the extension toolbar icon to open the side panel → **OpenAI API settings** → enter your **OpenAI API key**. An OpenAI API account is required and API usage may be billed independently of ChatGPT. The key is saved automatically in Chrome local extension storage; this is convenient but is not encrypted by the extension. The key and post are sent over HTTPS to OpenAI when you generate a reply.
5. Enter reply instructions (e.g. `Pick one ticker. Be concise and use no hype.`) and optionally a key point/ticker.
6. Click **Generate reply**, then review the editable draft. Click **Copy reply** or open X's reply editor and click **Insert reply**. Publish manually within X.

## Notes
- PANDA-style stages remain a local analysis summary; **PANDA is not an LLM**, and the optional PANDA daemon checkbox is for audit logging only, not generation.
- This version uses OpenAI `gpt-4o-mini` via `POST https://api.openai.com/v1/chat/completions`; it does not use your ChatGPT subscription.
- Does not perform online ticker research; do not treat a generated market opinion as verified financial analysis.
- The extension does not automatically post, schedule, or bulk-comment.
- X's selectors can change. If insertion fails, use Copy reply.
- Never publish a Chrome extension with your personal API key included in its source.


## v1.2: Persistent API key

Enter your OpenAI API key once under **OpenAI API settings**. It is saved automatically in `chrome.storage.local` (along with your reply instructions and preferences), and restored when you reopen the panel or restart Chrome. No checkbox is required. The key is sent to `api.openai.com` for generating replies. **Chrome local extension storage is not encrypted**, so protect access to your computer and Chrome profile. Do not share a ZIP containing your configured Chrome profile or key.

## v1.3: Side panel by default

Requires Chrome 116 or newer. Clicking the extension toolbar icon opens PANDA Reply in the side panel. You can also select it from Chrome’s side panel menu. The panel stays open while you interact with X, and its layout fits the panel width. Reload the extension at `chrome://extensions` after updating. Access is limited to X/Twitter pages so reading and inserting replies also works when the panel is opened from Chrome’s side panel menu or you switch to another X tab.

## Staged replies

The draft, copied text, and inserted reply include Perceptions [X post: …], Analysis, Network, Decision, and Action, within 280 characters. On individual post pages, up to five other visible posts and their displayed account names are included as unverified context. These may be replies or recommendations; the extension does not browse account profiles or independently verify claims. Network states when no other accounts were checked.

## Duplicate reply protection

Individual X posts are tracked locally by numeric post ID across X/Twitter URLs and browser restarts. Generate and Insert are blocked for tracked posts. Insert reserves the post before editing, including clipboard fallback; this records a prepared reply, not confirmed publication. Reply history lets you mark the current post commented (including manual replies), or remove an entry to retry an unpublished draft. Earlier comments and replies made outside the extension are not detected automatically.

## v1.4: Ask a follower in Network

Enable **Network: ask one of my followers by DM**, then click **Generate reply** (or **Ask a follower**). The extension reads your own logged-in profile link, visits your followers in a separate tab, and checks up to the first five visible followers for X’s Message button. It sends one question to the first eligible follower, including the original post, asking what decision/action they would take and why. The message says their response may inform a public reply. Existing DM drafts are not overwritten.

The toggle is off initially and remembered locally. With it enabled, drafting waits for a follower response. Use **Open DM tab** to unlock Chat or view the conversation, **Check messages** to load messages after the question, and select the follower’s actual response. You can also paste their response if X’s Chat interface cannot be read. Return to the original post and click **Use follower response and generate**. That text is sent to OpenAI as unverified perspective and informs Decision and Action. The public Network line says “Follower response considered”; it does not automatically quote their private message. Turn the toggle off to generate without waiting.

Consultations are stored per logged-in account and post ID. Pending, completed, and uncertain sends are not automatically resent. A failure before Send can be retried; an uncertain send must be checked in the DM tab. This uses X’s visible website controls, not an X API: changing layouts, encrypted Chat unlock screens, unavailable followers, or blocked messaging can prevent automation. Background monitoring checks saved conversations; if message direction cannot be identified, select or paste the follower’s actual response. No test DMs were sent during development.

## v1.5: Long-running PANDA transactions

Every follower request saves the original post, account, contacted follower, question, instructions, tone, response, and resulting draft in local extension storage. Closing the side panel or restarting Chrome does not discard a pending transaction. A DOM observer requests checks when an X DM conversation changes; a one-minute Chrome alarm also checks open X tabs. Alarms cannot run while Chrome is closed; saved work resumes when Chrome is opened again. No API request is kept open while waiting for a follower.

Checks match your account, the follower’s conversation header, and the original outgoing question. Only later incoming messages are eligible. Explicit sender/direction metadata is preferred; in the legacy message layout, a left-hand bubble is accepted only after calibrating against the known outgoing question on the right. If the layout does not expose these signals or the question is not loaded, the transaction stays pending and manual selection remains available. Messages already in the conversation and your own outgoing messages are not used as a new follower response. A follower with another unanswered consultation is skipped when choosing whom to contact.

When a response is detected, the service worker continues drafting Decision and Action using the saved instructions, stores the completed draft, and shows a badge. **Network transactions** lists whom you contacted, the original post, time, and state. **View draft** opens the original post and restores the reply for review and insertion; **Open follower DM** lets you check returns; **Stop transaction** stops continuation without unsending the question. Uncertain sends are never automatically resent, and posts already in reply history cannot be resumed into another inserted reply. Generation errors retain the response for retry. Turning the Network toggle off prevents new requests but does not cancel existing transactions.

Automation depends on X exposing its DM controls and message layout. Encrypted/locked Chat or newer layouts may need manual unlock or response selection. The workflow was tested with simulated browser and storage events; it has not been tested against a live X account, and no live DMs were sent during development.

## v1.5.1: Refresh when switching posts

The panel clears the prior draft on X navigation or tab changes, including navigation within the same tab. A late generation for an earlier post cannot replace the current draft. The post reader waits for the current post’s own timestamp permalink and text, rather than matching quoted-post links in old articles. Saved Network transactions remain tied to their original post.

## v1.5.2: Timeline reply popups

Generate, Insert, duplicate tracking, and Network requests also work from a timeline reply popup. The reader prioritizes the post inside the visible reply dialog and stores its canonical permalink. If the popup omits that permalink, it matches the popup text and author to a unique timeline post. It does not guess when the source cannot be identified. Switching or closing popups clears the selected post and stale draft.

## v1.5.3: Compact preview and Chrome injection fix

The reader is a standalone function that Chrome can serialize into the page. Compact reply previews can be matched to a unique timeline post using the source text and displayed author handle even when the preview has no permalink, disables profile links, or includes an extra media URL.

## v1.5.4: Popup source survives timeline virtualization

If X has unloaded the original timeline article, the reader uses the popup preview’s React post data in the page world, accepting only a unique numeric post ID whose author and text match the displayed preview. The insertion check uses the same resolver. Media-link and paragraph differences do not prevent identifying the post.

## v1.6: Local browse recorder

Open **Browse recorder · X / Instagram** in the side panel. Click **Start recording**, browse and scroll, then **Stop**. Choose a saved session and download **JSON** (structured data) or **HTML** (readable offline document). Downloading during recording exports a snapshot. Enable **Include Instagram** before Start and grant Chrome’s optional Instagram site access. Only X/Twitter are available without that permission.

Visible articles are captured from the active tab in the focused browser window: author, post text, canonical source link, available image/video URLs, and capture timestamps. Revisiting a post updates its record rather than adding duplicates. Capture is local in IndexedDB; recordings are not sent to OpenAI. Sessions persist through panel closures and browser restarts and keep recording until stopped. A session stops at 3,000 posts or if storage fails. Private DM, login, account, and settings routes and editable fields are skipped. Existing recording files remain available after stopping.

This records rendered post content, not screen video or full media files. Instagram article feeds and individual post/reel pages are supported when their content is exposed by the page. Stories, video/audio playback, content not loaded by the site, and layouts without identifiable source links may not be captured. Exported HTML links to media; it does not automatically load remote images.

The X recording workflow was verified live: scrolling saved seven unique posts, Stop ended capture, and both JSON and HTML exports were downloaded and checked. Instagram extraction is implemented but has not been tested in a live signed-in Instagram session.

## v1.7: Positive and negative keyword highlights

Open **Keyword highlights · positive / negative**, enable highlighting, enter one rule per line, and **Save highlights**. Plain words or phrases match case-insensitively as substrings. For regex use `/expression/flags`, such as `/bullish|profit/i` or `/bearish|loss(?:es)?/i`. Supported flags: `g`, `i`, `m`, `s`, `u`; regex is case-sensitive unless `i` is supplied. Up to 100 rules, 300 characters per rule. Invalid rules show a line-specific error and cannot be saved.

Positive matches are green and negative matches red; negative takes priority at overlaps. Settings persist locally. Post text is highlighted without changing its DOM text; reply editors and private DM/account/settings pages are skipped. Instagram highlighting is opt-in and uses optional site access. Regex evaluation stays local in a worker with a 300 ms timeout; an excessively slow rule is reported in the panel. Highlighting and recording operate independently.
