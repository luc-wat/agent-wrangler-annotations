import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A board-only extension: no tools, handlers or stores. The browser half
// (public/) finds core's Chat panel wherever it is mounted and types the
// composed message through api.sessionPanel.type, the one capability it needs.
// Keep this in step with package.json's `wranglerExtension` block.
export default {
  id: 'annotations',
  label: 'Session annotations',
  description: "Highlight passages in a session's Chat view, note each, and send them all at once.",
  author: 'luc-wat',
  requires: ['session:type'],
  engines: { wranglerApi: '^2.0.0' },
  boardApi: '^2.0.0',
  dir: path.dirname(fileURLToPath(import.meta.url)),
  defaultEnabled: true,
  board: { client: 'public/index.js', styles: 'public/styles.css' },
};
