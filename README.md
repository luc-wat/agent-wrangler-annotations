# Agent Wrangler annotations

An [Agent Wrangler](https://github.com/PortSwigger/agent-wrangler) extension that brings a
comment-then-send flow to agent conversations. In a session's **Chat** view:

1. Highlight a passage. An **Annotate** button appears beside the selection.
2. Write a note on it. The passage is marked and numbered in the conversation.
3. Repeat. Every note is listed in a tray above the message box, where you can **Edit** or
   **Remove** it, or click its excerpt to scroll back to the passage.
4. Press **Send all**. The session gets one numbered message that quotes each excerpt with your
   note beneath it, and asks the agent to start each answer with `Re note N:`. Anything you have
   typed in the message box goes at the bottom of that same message. The notes are cleared from
   the tray and the message box is left empty.
5. When the agent replies, each `Re note N` label in its answer becomes a small chip. Hover it (or
   focus it with Tab) to see the excerpt and the note it answers.

```text
I have notes on 2 passages of this conversation:

1. > You don't need any JavaScript

   Is that true for Safari 15 too?

2. > To avoid a flash of the wrong theme on load

   Our CSP blocks inline scripts. What is the alternative?

Please answer each note in turn and start each answer with its label ("Re note 1:", "Re note 2:" and so on) so I can tell which note it answers.

If both are fine, go ahead and ship it.
```

Here the last line is what was typed in the message box when **Send all** was pressed. With an empty
message box the message ends at the request for labelled answers.

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

- **Send all** takes whatever is typed in the message box, trims it and adds it at the bottom of the
  notes message, after the request for labelled answers, so it all goes as one message and the
  draft is not left behind or sent twice. A blank message box adds nothing. The tray says so under
  the list.
- **Send all** refuses, and keeps your notes and any draft, while the session is locked or waiting
  on a Terminal prompt, or when the message does not go out. A toast says which.
- An excerpt is found again by its text, so marks come back after the chat redraws. A passage
  outside the loaded part of a long conversation keeps its note in the tray (its number dims) and
  is still sent.
- A label becomes a chip only in the agent's messages, only when it reads `Re note N:` (any case,
  bold or not) and only when note N was in the batch it answers. Labels in code blocks, links and
  your own messages are left as text.
- Each reply is matched to the batch it answers: the nearest **Send all** message above it in the
  chat. So when a later batch reuses a number, an older reply still shows the older note. If that
  message is outside the loaded part of a long conversation, a later batch's message below the
  reply bounds it (the reply answers the batch sent before that one), and otherwise the most
  recent batch is used.
- Chips are drawn again whenever the chat redraws, and after a reload.
- **Clear** asks for a second press before it drops every note for the session.
- Notes live in the browser's `localStorage` under `aw-annotations:v1:<session id>`, so they are
  per browser, not shared between devices. What **Send all** sent (each note's number, excerpt and
  note, and the whole message text, draft included) is kept under `aw-annotations:sent:v1:<session id>`, the last 20
  batches per session, so the chips can show it.

## Develop

```sh
npm install
npm test
```

Tests use `node:test` and [happy-dom](https://github.com/capricorn86/happy-dom): message
composition (`test/compose.test.js`), persistence of notes and sent batches (`test/store.test.js`),
finding `Re note N:` labels and the batch each reply answers (`test/replies.test.js`), finding the
Chat panel
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
message, `store.js` keeps the notes and what was sent, and `replies.js` turns the agent's labels
into chips.

## License

MIT
