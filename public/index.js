// Board half of the Session annotations extension. It contributes no slot: it
// watches core's Chat panel wherever that panel is shown (the board's sidebar,
// or lent to Wrangler² by api.mountSession) and draws its marks, tray and note
// editor inside it. See annotator.js.

import { createAnnotator } from './annotator.js';
import { createStore } from './store.js';

let current = null;

export default {
  register(slots) {
    current?.destroy();
    const api = slots?.api || null;
    current = createAnnotator({ document: globalThis.document, api, store: createStore() });
  },
};
