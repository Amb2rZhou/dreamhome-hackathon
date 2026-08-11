import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { inferRuntimePrimitive, isModelBackedHome } from '../web/prototype/pages/shared/home-model-loading.js';

describe('DreamHome model-backed scenes', () => {
  it('keeps both video scenes and copied same-home scenes behind the loading gate', () => {
    expect(isModelBackedHome({ source: { type: 'video_rebuild' } })).toBe(true);
    expect(isModelBackedHome({ source: { type: 'case_copy' } })).toBe(true);
    expect(isModelBackedHome({ source: { type: 'space_assembly' } })).toBe(true);
    expect(isModelBackedHome({ source: { type: 'template' } })).toBe(false);
  });

  it('uses asset labels to render a meaningful temporary fallback', () => {
    expect(inferRuntimePrimitive({ name: '双人床', tags: ['白色', '布艺'] })).toBe('bed');
    expect(inferRuntimePrimitive({ name: '办公椅', tags: ['带轮子'] })).toBe('chair');
    expect(inferRuntimePrimitive({ name: '原木色衣柜', tags: ['收纳'] })).toBe('cabinet');
  });

  it('loads Draco from the path shared by local preview and static deployment', () => {
    const source = readFileSync('web/prototype/pages/my-home/index.html', 'utf8');

    expect(source).toContain("setDecoderPath('/draco/')");
    expect(source).not.toContain("setDecoderPath('/vendor/three-addons/libs/draco/')");
  });

  it('keeps the blocking Bao Gong Qiu loader until every real model settles', () => {
    const source = readFileSync('web/prototype/pages/my-home/index.html', 'utf8');

    expect(source).toContain('working-drawing.webm');
    expect(source).toContain('ui.editorPhase.inert=sceneLoading');
    expect(source).toContain('if(modelLoadProgress.total>0)return');
    expect(source).not.toContain('SCENE_PREVIEW_DEADLINE_MS');
    expect(source).not.toContain('家具继续载入中');
    expect(source).not.toContain('件家具使用临时预览');
    expect(source).toContain('fallback.visible=false');
    expect(source).toContain('真实组件加载失败，保持加载层并重试');
    expect(source).toContain('const MAX_MODEL_LOADS=Math.min(2');
    expect(source).toContain("cache:'default'");
    expect(source).not.toContain("cache:'no-cache'");
    expect(source).not.toContain("cache:'force-cache'");
  });
});
