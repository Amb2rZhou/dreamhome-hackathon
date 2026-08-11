import { copyFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const appEntry = resolve(root, 'web/prototype/pages/discover/app/index.html')
const legacyEntry = resolve(root, 'web/prototype/pages/discover/index.html')

const html = await readFile(appEntry, 'utf8')
if (!html.includes('<div id="root"></div>') || !html.includes('type="module"')) {
  throw new Error('Built discover entry is incomplete; refusing to publish shell pages.')
}

// Keep the explicit Discover route on the React feed.  The canonical domain
// root is intentionally owned by web/index.html and now opens the inspiration
// asset library, so a Discover rebuild must never overwrite that product
// entry decision.
await copyFile(appEntry, legacyEntry)
