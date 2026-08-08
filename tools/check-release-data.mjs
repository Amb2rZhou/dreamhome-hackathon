import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const python = process.env.PYTHON || 'python3'
const validator = resolve(root, 'backend', 'tools', 'validate_feed_manifest.py')
const result = spawnSync(python, [validator, '--dry-run', '--strict'], {
  cwd: root,
  encoding: 'utf8',
  stdio: 'inherit',
})

if (result.error) {
  console.error(`Unable to run release data validation with ${python}: ${result.error.message}`)
  process.exit(1)
}

if (result.status !== 0) {
  console.error('Release data check failed. Ordinary builds remain available; resolve the manifest issues before publishing.')
}
process.exit(result.status ?? 1)

