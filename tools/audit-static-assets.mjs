import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const reportPath = join(root, 'reports', 'performance-assets.json')
const assetExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.mov', '.webm', '.glb', '.js', '.css', '.wasm', '.onnx', '.otf'])
const textExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.html', '.css', '.json', '.md'])
const ignoredParts = new Set(['node_modules', '.git', 'dist'])

function walk(start, predicate = () => true) {
  if (!existsSync(start)) return []
  const output = []
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (ignoredParts.has(entry.name)) continue
      const path = join(current, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (predicate(path)) output.push(path)
    }
  }
  visit(start)
  return output.sort()
}

function posix(path) {
  return path.split(sep).join('/')
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function kind(path) {
  const extension = extname(path).toLowerCase()
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extension)) return 'image'
  if (['.mp4', '.mov', '.webm'].includes(extension)) return 'video'
  if (extension === '.glb') return 'glb'
  if (['.js', '.css'].includes(extension)) return extension.slice(1)
  if (['.wasm', '.onnx'].includes(extension)) return 'runtime-model'
  if (extension === '.otf') return 'font'
  return 'other'
}

const assetRoots = [
  join(root, 'public'),
  join(root, 'web', 'prototype', 'assets'),
  join(root, 'web', 'prototype', 'pages', 'discover', 'app', 'assets'),
]
const assets = assetRoots.flatMap((assetRoot) => walk(assetRoot, (path) => assetExtensions.has(extname(path).toLowerCase())))
const textFiles = [join(root, 'src'), join(root, 'web', 'prototype'), join(root, 'web')]
  .flatMap((textRoot) => walk(textRoot, (path) => textExtensions.has(extname(path).toLowerCase())))
  .filter((path, index, all) => all.indexOf(path) === index && !path.includes(`${sep}pages${sep}discover${sep}app${sep}`))
const textIndex = textFiles.map((path) => ({ path, text: readFileSync(path, 'utf8') }))

const inventory = assets.map((path) => {
  const repoPath = posix(relative(root, path))
  const basename = repoPath.slice(repoPath.lastIndexOf('/') + 1)
  const references = textIndex
    .filter(({ text }) => text.includes(basename))
    .map(({ path: source }) => posix(relative(root, source)))
  return { path: repoPath, bytes: statSync(path).size, kind: kind(path), sha256: sha256(path), references }
})

const totalsByKind = Object.fromEntries([...new Set(inventory.map((item) => item.kind))].sort().map((assetKind) => {
  const matches = inventory.filter((item) => item.kind === assetKind)
  return [assetKind, { files: matches.length, bytes: matches.reduce((sum, item) => sum + item.bytes, 0) }]
}))

const mascotInventory = inventory.filter(({ path }) => (
  path.startsWith('public/mascot-motion/') || path.startsWith('web/prototype/assets/mascot/')
))
const mascotHashes = new Map()
for (const item of mascotInventory) mascotHashes.set(item.sha256, [...(mascotHashes.get(item.sha256) ?? []), item.path])
const mascotExactDuplicates = [...mascotHashes.entries()]
  .filter(([, paths]) => paths.length > 1)
  .map(([hash, paths]) => ({ sha256: hash, paths }))

const motionNames = ['idle', 'idle-magnifier', 'idle-belt', 'working', 'working-hammer', 'working-drawing', 'complete']
const mascotCompression = motionNames.map((name) => {
  const originalPath = join(root, 'public', 'mascot-motion', `${name}.mp4`)
  const optimizedPath = join(root, 'public', 'mascot-motion', `${name}.web.mp4`)
  const beforeBytes = statSync(originalPath).size
  const afterBytes = statSync(optimizedPath).size
  return {
    name,
    original: posix(relative(root, originalPath)),
    optimized: posix(relative(root, optimizedPath)),
    beforeBytes,
    afterBytes,
    savedBytes: beforeBytes - afterBytes,
    savedPercent: Number((((beforeBytes - afterBytes) / beforeBytes) * 100).toFixed(2)),
  }
})
const compressionTotals = mascotCompression.reduce((total, item) => ({
  beforeBytes: total.beforeBytes + item.beforeBytes,
  afterBytes: total.afterBytes + item.afterBytes,
  savedBytes: total.savedBytes + item.savedBytes,
}), { beforeBytes: 0, afterBytes: 0, savedBytes: 0 })
compressionTotals.savedPercent = Number(((compressionTotals.savedBytes / compressionTotals.beforeBytes) * 100).toFixed(2))

function checkLiteralPaths() {
  const failures = []
  const publicLiteral = /['"`]\/(mascot-motion|video-posters|videos|models|ui|fonts)\/[^'"`?#]+/g
  for (const { path, text } of textIndex.filter(({ path }) => path.includes(`${sep}src${sep}`))) {
    for (const match of text.matchAll(publicLiteral)) {
      const url = match[0].slice(1)
      if (!existsSync(join(root, 'public', url))) failures.push({ source: posix(relative(root, path)), target: url })
    }
  }
  const prototypeLiteral = /['"`](\.\.\/)+assets\/[^'"`?#]+/g
  for (const { path, text } of textIndex.filter(({ path }) => path.includes(`${sep}web${sep}prototype${sep}`))) {
    for (const match of text.matchAll(prototypeLiteral)) {
      const literal = match[0].slice(1)
      if (literal.includes('${')) continue
      const target = resolve(dirname(path), literal)
      if (!existsSync(target)) failures.push({ source: posix(relative(root, path)), target: posix(relative(root, target)) })
    }
  }
  return failures
}

const pathFailures = checkLiteralPaths()
const report = {
  schemaVersion: 1,
  scope: ['public', 'web/prototype/assets', 'web/prototype/pages/discover/app/assets'],
  totalsByKind,
  mascot: {
    roots: ['public/mascot-motion', 'web/prototype/assets/mascot'],
    inventory: mascotInventory,
    exactDuplicates: mascotExactDuplicates,
    referenceSummary: {
      mainAppDynamicMp4: motionNames.map((name) => `public/mascot-motion/${name}.web.mp4`),
      failureOnlyPosters: motionNames.map((name) => `public/mascot-motion/${name}.poster.png`),
      retainedUnreferencedSources: motionNames.map((name) => `public/mascot-motion/${name}.mp4`),
      logicalOverlapNotByteDuplicates: [
        { state: 'working-hammer', mainApp: 'public/mascot-motion/working-hammer.web.mp4', prototype: 'web/prototype/assets/mascot/motion/working-hammer.webm' },
        { state: 'working-drawing', mainApp: 'public/mascot-motion/working-drawing.web.mp4', prototype: 'web/prototype/assets/mascot/motion/working-drawing.webm' },
        { state: 'assembly-loading', mainAppSourceOnly: 'public/mascot-motion/assembly-loading.mp4', prototype: 'web/prototype/assets/mascot/motion/assembly-loading.webm' },
      ],
    },
    compression: { items: mascotCompression, totals: compressionTotals },
    deliveryStrategy: {
      mainApp: '640x480 H.264 MP4 for broad browser support; original MP4/MOV retained as sources',
      prototypeWebm: [
        'web/prototype/assets/mascot/motion/assembly-loading.webm',
        'web/prototype/assets/mascot/motion/working-drawing.webm',
        'web/prototype/assets/mascot/motion/working-hammer.webm',
      ],
      duplicatePolicy: 'Keep referenced prototype WebM in place; do not copy it into public and create another binary duplicate',
      posterPolicy: '240x180 PNG loads only after mascot video failure',
    },
    loading: {
      before: { normalRequestCount: 2, assets: ['original idle MP4', 'active feed video metadata'] },
      after: { normalRequestCount: 2, assets: ['optimized idle MP4', 'active feed video metadata'] },
      failureFallbackAdditionalRequests: 1,
      deferredStates: motionNames.filter((name) => name !== 'idle'),
    },
  },
  mediaBehavior: {
    feedVideo: {
      preload: 'metadata',
      nextVideoPrefetch: 'metadata after current canplay plus 1500ms',
      posters: { files: 9, bytes: walk(join(root, 'public', 'video-posters')).reduce((sum, path) => sum + statSync(path).size, 0) },
      integrationPatch: 'reports/feed-video-poster.integration.patch',
    },
    glb: { load: 'drawer-open and active-item only', module: 'lazy import', failureFallback: 'thumbnail remains visible' },
  },
  pathCheck: { checkedTextFiles: textIndex.length, failures: pathFailures },
}

if (process.argv.includes('--write')) {
  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(posix(relative(root, reportPath)))
} else {
  console.log(JSON.stringify(report.pathCheck, null, 2))
}

if (process.argv.includes('--check') && pathFailures.length > 0) process.exitCode = 1
