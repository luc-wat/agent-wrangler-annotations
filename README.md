# Agent Wrangler annotations

An [Agent Wrangler](https://github.com/PortSwigger/agent-wrangler) extension that brings a
comment-then-send flow to agent conversations. In a session's **Chat** view:

1. Highlight a passage. An **Annotate** button appears beside the selection.
2. Write a note on it. The passage is marked and numbered in the conversation.
3. Repeat. Every note is listed in a tray above the message box, where you can **Edit** or
   **Remove** it, or click its excerpt to scroll back to the passage.
4. Press **Send all**. The session gets one numbered message that quotes each excerpt with your
   note beneath it, and the notes are cleared.

```text
I have notes on 2 passages of this conversation:

1. > You don't need any JavaScript

   Is that true for Safari 15 too?

2. > To avoid a flash of the wrong theme on load

   Our CSP blocks inline scripts. What is the alternative?
```

It works wherever core's Chat panel appears: plain board sessions, and the conversations inside
[Wrangler²](https://github.com/PortSwigger/wrangler-squared) that borrow that panel (a New idea's
conversation, a step's Sessions, Phone control). Notes are kept per session in your browser, so they
survive switching pages, leaving a job page and a reload, until you send or clear them.

The Terminal view has no text to select, so annotations are Chat only.

## Install

Needs Agent Wrangler with host API 2.0.0 or later.

1. Open **Settings › Extensions** and choose **+ Add extension**.
2. Either find **agent-wrangler-annotations** under **Browse GitHub**, or switch to **Git URL** and
   paste `https://github.com/luc-wat/agent-wrangler-annotations.git`.
3. Review the extension and install it. It asks for one capability, `session:type`, which lets
   **Send all** type the message into the session's message box and send it, as you would. It has
   no runtime dependencies.
4. Open any session's Chat and select some text.

## How it behaves

- **Send all** refuses, and keeps your notes, while the message box already holds a draft (so the
  draft is never merged into the notes), while the session is locked or waiting on a Terminal
  prompt, or when the message does not go out. A toast says which.
- An excerpt is found again by its text, so marks come back after the chat redraws. A passage
  outside the loaded part of a long conversation keeps its note in the tray (its number dims) and
  is still sent.
- **Clear** asks for a second press before it drops every note for the session.
- Notes live in the browser's `localStorage` under `aw-annotations:v1:<session id>`, so they are
  per browser, not shared between devices.

## Develop

```sh
npm install
npm test
```

Tests use `node:test` and [happy-dom](https://github.com/capricorn86/happy-dom): message
composition (`test/compose.test.js`), persistence (`test/store.test.js`), finding the Chat panel
on the board and inside Wrangler²'s `.job-mc-host` and finding excerpts again
(`test/panel.test.js`), and the whole UI flow against a fake extension API
(`test/annotator.test.js`).

To try it in a running Agent Wrangler, copy a checkout (a real directory, not a symlink) to
`<AW_DATA_DIR>/extensions/annotations/` on an isolated `AW_DATA_DIR` and restart:

```sh
AW_DATA_DIR=~/.aw-annotations-dev AW_PORT=7890 node /path/to/agent-wrangler/server/cli.js
```

The board half is `public/`: `index.js` registers it, `annotator.js` draws the UI inside core's
`#chat-stream-wrap` and `#chat-wrap` (never on `<body>`, so it travels with the panel when an
extension view borrows it), `panel.js` finds the panel and the text, `compose.js` writes the
message and `store.js` keeps the notes.

## License

MIT
