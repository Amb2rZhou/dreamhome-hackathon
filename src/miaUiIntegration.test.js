import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readPage = (name) => readFileSync(resolve(process.cwd(), `web/prototype/pages/${name}/index.html`), 'utf8');
const readShared = (name) => readFileSync(resolve(process.cwd(), `web/prototype/pages/shared/${name}`), 'utf8');

describe('Mia interaction with DreamHome data', () => {
  it('keeps style filtering while removing the multi-asset assembly entry', () => {
    const library = readPage('inspiration-library');
    const home = readPage('my-home');
    expect(library).toContain('data-fs-style');
    expect(home).toContain('id="styleTabs"');
    expect(home).not.toContain('addAssets');
    expect(home).not.toContain('拼装清单');
  });

  it('preserves declared tag provenance on captured assets', () => {
    const capture = readPage('capture');
    expect(capture).toContain("source:'user_declared'");
    expect(capture).toContain("humanReviewStatus:'reviewed'");
    expect(capture).toContain("sizeStatus:Array.isArray(job.estimated_size_m)");
  });

  it('publishes the room-size page with the matching live-preview module', () => {
    const setup = readPage('room-setup');
    const preview = readShared('template-preview-3d.js');
    const home = readPage('my-home');
    expect(setup).toContain("template-preview-3d.js?v=20260810c");
    expect(preview).toContain('export function createLivePreview');
    expect(home).toContain('roomOverride:null');
    expect(home).toContain('friendMode:false');
  });
});
