import { copyFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const appEntry = resolve(root, 'web/prototype/pages/discover/app/index.html')
const rootEntry = resolve(root, 'web/index.html')
const legacyEntry = resolve(root, 'web/prototype/pages/discover/index.html')

const html = await readFile(appEntry, 'utf8')
if (!html.includes('<div id="root"></div>') || !html.includes('type="module"')) {
  throw new Error('Built discover entry is incomplete; refusing to publish shell pages.')
}

// Both the canonical domain and the legacy discover URL load the React app
// directly. This removes two serial HTML requests and the iframe cold start.
await Promise.all([
  copyFile(appEntry, rootEntry),
  copyFile(appEntry, legacyEntry),
])
