// The one message Send all types into the session: every annotation, numbered
// in the order the human made them, its excerpt quoted and its note beneath.
// Pure, so the exact wording is pinned by compose.test.js.

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
  return [head, ...list.map((a, i) => item(i + 1, a))].join('\n\n');
}
