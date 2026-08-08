import { describe, expect, it } from 'vitest';
import { restoreApprovedHomes } from '../web/prototype/pages/shared/home-project-defaults.js';

const defaults = [
  { id: 'home-a', name: '内置 A', placements: [{ id: 'chair' }] },
  { id: 'home-b', name: '内置 B', placements: [{ id: 'bed' }] },
];

describe('restoreApprovedHomes', () => {
  it('restores both approved homes when an old store is empty', () => {
    expect(restoreApprovedHomes([], defaults)).toEqual(defaults);
  });

  it('preserves user projects while replacing stale built-in copies', () => {
    const userHome = { id: 'mine', name: '我的项目', placements: [] };
    const staleDefault = { id: 'home-a', name: '旧内置项目', placements: [] };

    expect(restoreApprovedHomes([userHome, staleDefault], defaults)).toEqual([
      ...defaults,
      userHome,
    ]);
  });

  it('removes the retired demo without mutating its input', () => {
    const retired = { id: 'old', source: { videoId: 'retired-video' } };
    const input = [retired];

    expect(restoreApprovedHomes(input, defaults, ['retired-video'])).toEqual(defaults);
    expect(input).toEqual([retired]);
  });
});

