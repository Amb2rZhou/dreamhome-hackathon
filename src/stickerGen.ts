import type { FurnitureCategory } from './types'

const PATHS: Record<FurnitureCategory, string> = {
  '沙发': 'M10 78 Q10 70 14 66 L14 42 Q14 30 26 30 L94 30 Q106 30 106 42 L106 66 Q110 70 110 78 L110 88 Q110 96 102 96 L92 96 L92 86 L28 86 L28 96 L18 96 Q10 96 10 88 Z M20 50 L100 50 M38 30 L38 50 M62 30 L62 50',
  '茶几': 'M16 54 Q16 46 24 46 L96 46 Q104 46 104 54 Q104 60 96 60 L24 60 Q16 60 16 54 Z M28 60 L26 96 M60 60 L60 96 M92 60 L94 96',
  '吊灯': 'M58 8 L62 8 L62 30 L66 34 Q84 38 84 58 Q84 78 60 80 Q36 78 36 58 Q36 38 54 34 L58 30 Z',
  '绿植': 'M44 70 Q44 64 50 62 L70 62 Q76 64 76 70 L76 78 L44 78 Z M46 78 L74 78 L72 96 L48 96 Z M40 62 Q28 56 30 44 Q32 32 46 36 Q44 24 58 22 Q72 22 74 36 Q88 32 90 44 Q92 56 80 62 M60 36 L60 62',
  '装饰画': 'M14 14 L106 14 L106 106 L14 106 Z M22 22 L98 22 L98 98 L22 98 Z',
  '地毯': 'M8 40 Q8 34 14 34 L106 34 Q112 34 112 40 L112 84 Q112 90 106 90 L14 90 Q8 90 8 84 Z M16 42 L104 42 M16 82 L104 82',
}

export function genSticker(category: FurnitureCategory, color: string, salt = 0): string {
  const path = PATHS[category]
  const id = 's' + ((category.charCodeAt(0) * 31 + salt) % 100000).toString(36)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 120 120">
<defs>
  <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${color}" stop-opacity="0.95"/>
    <stop offset="100%" stop-color="${color}" stop-opacity="0.7"/>
  </linearGradient>
  <filter id="${id}f" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000000" flood-opacity="0.35"/>
  </filter>
</defs>
<g filter="url(#${id}f)" transform="rotate(-2 60 60)">
  <path d="${path}" fill="url(#${id})" stroke="${color}" stroke-opacity="0.3" stroke-width="1" stroke-linejoin="round"/>
  <path d="${path}" fill="none" stroke="#ffffff" stroke-opacity="0.25" stroke-width="1.5" stroke-linejoin="round" transform="translate(0,-1)"/>
</g>
</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
