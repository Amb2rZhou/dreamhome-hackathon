import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const discoverRoot = join(root, 'web', 'prototype', 'pages', 'discover', 'app')
const discoverIndex = join(discoverRoot, 'index.html')

const kib = 1024
const mib = 1024 * kib
const budgets = {
  initialJsBytes: Number(process.env.DREAMHOME_BUDGET_INITIAL_JS_BYTES || 520 * kib),
  initialCssBytes: Number(process.env.DREAMHOME_BUDGET_INITIAL_CSS_BYTES || 80 * kib),
  maxMp4Bytes: Number(process.env.DREAMHOME_BUDGET_MAX_MP4_BYTES || 15 * mib),
  maxImageBytes: Number(process.env.DREAMHOME_BUDGET_MAX_IMAGE_BYTES || 3.5 * mib),
  maxGlbBytes: Number(process.env.DREAMHOME_BUDGET_MAX_GLB_BYTES || 2.5 * mib),
}

function walk(start) {
  if (!existsSync(start)) return []
  const files = []
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) visit(path)
      else files.push(path)
    }
  }
  visit(start)
  return files
}

function largest(paths, extensions) {
  return paths
    .filter((path) => extensions.has(extname(path).toLowerCase()))
    .map((path) => ({ path: path.slice(root.length + 1), bytes: statSync(path).size }))
    .sort((left, right) => right.bytes - left.bytes)[0] ?? null
}

function formatBytes(bytes) {
  return `${(bytes / mib).toFixed(2)} MiB`
}

if (!existsSync(discoverIndex)) {
  console.error('Missing discover production build. Run npm run build:discover first.')
  process.exit(1)
}

const html = readFileSync(discoverIndex, 'utf8')
const initialAssets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)]
  .map((match) => match[1])
  .map((url) => join(root, 'web', url.replace(/^\//, '').replace(/^prototype\/pages\/discover\/app\//, 'prototype/pages/discover/app/')))
  .filter((path) => existsSync(path))

const initialJsBytes = initialAssets
  .filter((path) => extname(path) === '.js')
  .reduce((sum, path) => sum + statSync(path).size, 0)
const initialCssBytes = initialAssets
  .filter((path) => extname(path) === '.css')
  .reduce((sum, path) => sum + statSync(path).size, 0)

const media = [join(root, 'public'), join(root, 'web', 'prototype', 'assets')].flatMap(walk)
const measurements = {
  initialJs: { bytes: initialJsBytes, budget: budgets.initialJsBytes },
  initialCss: { bytes: initialCssBytes, budget: budgets.initialCssBytes },
  largestMp4: { ...largest(media, new Set(['.mp4'])), budget: budgets.maxMp4Bytes },
  largestImage: { ...largest(media, new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif'])), budget: budgets.maxImageBytes },
  largestGlb: { ...largest(media, new Set(['.glb'])), budget: budgets.maxGlbBytes },
}

const failures = Object.entries(measurements)
  .filter(([, value]) => (value.bytes ?? 0) > value.budget)
  .map(([name, value]) => ({ name, ...value }))

console.log(JSON.stringify({
  status: failures.length ? 'failed' : 'passed',
  measurements: Object.fromEntries(Object.entries(measurements).map(([name, value]) => [name, {
    ...value,
    display: `${formatBytes(value.bytes ?? 0)} / ${formatBytes(value.budget)}`,
  }])),
}, null, 2))

if (failures.length) process.exitCode = 1

