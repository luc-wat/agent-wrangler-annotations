// The one message Send all types into the session: every annotation, numbered
// in the order the human made them, its excerpt quoted and its note beneath.
// It ends by asking the agent to start each answer with "Re note N:", which
// replies.js turns into a chip showing that note. Pure, so the exact wording is
// pinned by compose.test.js.

import { LABEL } from './replies.js';

// An excerpt longer than this is cut, with an ellipsis, so one careless
// select-all cannot bury the notes under pages of the agent's own words.
export const MAX_QUOTE_CHARS = 1200;

// Blank lines inside an excerpt are dropped and each line is trimmed, so the
// quote stays one block whatever the selection crossed (paragraphs, list items).
export function tidyQuote(text, max = MAX_QUOTE_CHARS) {
  const lines = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean);
  let out = lines.join('\n');
  if (out.length > max) out = `${out.slice(0, max).trimEnd()}…`;
  return out;
}

// One annotation: `1. > first line` with every further quote line and the note
// indented under the number, so it reads as one list item in markdown too.
function item(n, { quote, note }) {
  const pad = ' '.repeat(`${n}. `.length);
  const q = tidyQuote(quote).split('\n');
  const lines = [`${n}. > ${q[0] || ''}`, ...q.slice(1).map((l) => `${pad}> ${l}`)];
  const body = String(note ?? '').replace(/\r\n?/g, '\n').trim();
  if (body) {
    lines.push('');
    for (const l of body.split('\n')) lines.push(l ? `${pad}${l}` : '');
  }
  return lines.join('\n');
}

export function composeMessage(annotations) {
  const list = (Array.isArray(annotations) ? annotations : []).filter((a) => a && tidyQuote(a.quote));
  if (!list.length) return '';
  const head = list.length === 1
    ? 'I have a note on one passage of this conversation:'
    : `I have notes on ${list.length} passages of this conversation:`;
  return [head, ...list.map((a, i) => item(i + 1, a)), ask(list.length)].join('\n\n');
}

// The request for labelled answers, worded for one note or several.
export function ask(count) {
  if (count === 1) return `Please start your answer with "${LABEL(1)}" so I can tell which note it answers.`;
  return `Please answer each note in turn and start each answer with its label ("${LABEL(1)}", "${LABEL(2)}" and so on) so I can tell which note it answers.`;
}

// What Send all records for a batch: each note's number, tidied excerpt and
// note, as the message numbered them.
export function sentItems(annotations) {
  return (Array.isArray(annotations) ? annotations : [])
    .filter((a) => a && tidyQuote(a.quote))
    .map((a, i) => ({ n: i + 1, quote: tidyQuote(a.quote), note: String(a.note ?? '').trim() }));
}
