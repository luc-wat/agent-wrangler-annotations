// Board half of the Session annotations extension. It contributes no slot: it
// watches core's Chat panel wherever that panel is shown (the board's sidebar,
// or lent to Wrangler² by api.mountSession) and Wrangler²'s own chats (a step's
// conversation with its session, the conversations with the wrangler), and
// draws its marks, tray and note editor inside each. See annotator.js and
// wrangler2.js.

import { createAnnotator } from './annotator.js';
import { createStore } from './store.js';
import { createWrangler2Annotations } from './wrangler2.js';

let current = null;
let wrangler2 = null;

export default {
  register(slots) {
    current?.destroy();
    wrangler2?.destroy();
    const api = slots?.api || null;
    const store = createStore();
    current = createAnnotator({ document: globalThis.document, api, store });
    wrangler2 = createWrangler2Annotations({ document: globalThis.document, api, store });
  },
};
