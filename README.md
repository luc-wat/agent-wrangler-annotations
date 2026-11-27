# Agent Wrangler annotations

An [Agent Wrangler](https://github.com/PortSwigger/agent-wrangler) extension that brings a
comment-then-send flow to agent conversations. In a session's **Chat** view (and in [Wrangler²'s own chats](#in-wrangler²s-own-chats)):

1. Highlight a passage. An **Annotate** button appears beside the selection.
2. Write a note on it. The passage is marked and numbered in the conversation.
3. Repeat. Every note is listed in a tray above the message box, where you can **Edit** or
   **Remove** it, or click its excerpt to scroll back to the passage.
4. Press **Send all**. The session gets one numbered message that quotes each excerpt with your
   note beneath it, and asks the agent to start each answer with `Re note N:`. Anything you have
   typed in the message box goes at the bottom of that same message. The notes are cleared from
   the tray and the message box is left empty.
5. When the agent replies, each `Re note N` label in its answer becomes a small chip. Hover it (or
   focus it with Tab) to see the excerpt and the note it answers. Click it (or press Enter or Space
   while it has focus) to scroll back to the passage that note was on, which flashes briefly, as
   clicking an excerpt in the tray does.

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

### In Wrangler²'s own chats

Wrangler² draws two kinds of conversation itself, and they work the same way:

- a step's **conversation with the session** (on Code review, and under the step's History), and
- each **conversation with the wrangler** on a job or step page.

Highlight, note, edit and remove as above: the Annotate button, the numbered marks, the note editor
and the tray are all drawn inside that conversation, the tray as its last row (above the Add idea box
in a conversation with the wrangler). **Send all** puts the numbered message into Wrangler²'s **Add
idea box** for that conversation, with anything already typed there at the bottom, and presses its
Send, as you would. From a step's conversation with the session that is the step page's Add idea box;
the wrangler forwards your words to the session unchanged. When the session or the wrangler answers
with `Re note N:`, the label becomes a chip with the same hover card, in the step's thread and in the
conversation with the wrangler where the forward's answer is shown. Clicking it jumps to the passage
in the conversation the note was made in: from the forward's answer in a conversation with the
wrangler, that is the step's thread.

Notes are kept per conversation, never mixed with a session's notes on the board: one list per step's
conversation with its session and one per conversation with the wrangler.

**Send all** there refuses, and keeps your notes and the box's draft, when the conversation takes no
reply (no Add idea box under it), when an attachment in the box is still uploading or failed, when the
message would be longer than the box takes (8,000 characters), or when Wrangler² does not take it. If
Wrangler² takes it and the server then refuses it, Wrangler² puts the whole message back in the box.

A folded conversation, or a step's conversation with no message yet, has nothing to annotate.

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
- Clicking a chip looks for the passage only above the **Send all** message that sent its note, so it
  never lands on the copy quoted in that message or in the reply itself. If the passage is not in the
  loaded part of the conversation, a toast says so, as it does for an excerpt in the tray. Batches
  sent before chips could jump keep only the tidied excerpt, so their chips look for that text (or
  its first line found) instead.
- **Clear** asks for a second press before it drops every note for the session.
- Notes live in the browser's `localStorage` under `aw-annotations:v1:<session id>`, so they are
  per browser, not shared between devices. What **Send all** sent (each note's number, excerpt,
  note and where its passage is, and the whole message text, draft included) is kept under `aw-annotations:sent:v1:<session id>`, the last 20
  batches per session, so the chips can show it and jump back to it.
- In Wrangler²'s own chats the key is the conversation's instead of a session id:
  `w2:talk:<conversation id>` for a conversation with the wrangler, and `w2:thread:<signature>` for a
  step's conversation with its session, whose markup carries no id (the signature is taken from the
  step's title and the thread's first message, which never change once sent; renaming the step starts
  a new list). A reply there is matched against what any Wrangler² conversation on screen sent, by the
  sent text, so the forward's answer in a conversation with the wrangler shows the thread's notes.
- Wrangler²'s chats are another extension's markup. Everything this extension reads of it is in one
  place, `public/wrangler2.js`; if that markup is missing or changes shape, nothing is drawn there and
  nothing breaks.

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
(`test/panel.test.js`), the whole UI flow against a fake extension API
(`test/annotator.test.js`), and Wrangler²'s own chats against fixtures of its markup and a fake of
its Add idea box, which draws the page again on every send as Wrangler² does
(`test/w2-fixture.js`, `test/wrangler2.test.js`).

To try it in a running Agent Wrangler, copy a checkout (a real directory, not a symlink) to
`<AW_DATA_DIR>/extensions/annotations/` on an isolated `AW_DATA_DIR` and restart:

```sh
AW_DATA_DIR=~/.aw-annotations-dev AW_PORT=7890 node /path/to/agent-wrangler/server/cli.js
```

The board half is `public/`: `index.js` registers it, `annotator.js` draws the UI for one
conversation through an adapter (inside core's `#chat-stream-wrap` and `#chat-wrap`, never on
`<body>`, so it travels with the panel when an extension view borrows it), `panel.js` finds the
panel and the text and is core Chat's adapter, `wrangler2.js` is the adapter for Wrangler²'s own
chats and keeps one annotator per conversation on screen, `compose.js` writes the message,
`store.js` keeps the notes and what was sent, and `replies.js` turns the agent's labels into chips.

## License

MIT
