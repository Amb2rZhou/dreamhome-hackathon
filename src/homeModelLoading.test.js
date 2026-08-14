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

    expect(source).toContain("planning:'../../assets/mascot/mascot-ui.png'");
    expect(source).toContain("decorating:'../../assets/mascot/states/mascot-working-loading.png'");
    expect(source).not.toContain('id="genVideo"');
    expect(source).not.toContain("mountMascotVideoCutout(genVideo");
    expect(source).toContain("setGenerationAnimation(loadingScene?'decorating':'planning')");
    expect(source).toContain("phase:TARGETED_ENTRY?'scene-loading':'setup'");
    expect(source).not.toContain('SAFARI_OR_IOS_WEBKIT');
    expect(source).toContain('ui.editorPhase.inert=sceneLoading');
    expect(source).toContain('if(modelLoadProgress.total>0)return');
    expect(source).not.toContain('SCENE_PREVIEW_DEADLINE_MS');
    expect(source).not.toContain('家具继续载入中');
    expect(source).not.toContain('件家具使用临时预览');
    expect(source).toContain('fallback.visible=false');
    expect(source).toContain('真实组件加载失败，保持加载层并重试');
    expect(source).toContain('const MAX_MODEL_LOADS=Math.min(2');
    expect(source).toContain('const MAX_LIGHTWEIGHT_MODEL_LOADS=Math.min(4');
    expect(source).toContain("const STATIC_MODEL_RELEASE = '20260811-cache-v2'");
    expect(source).toContain('staticFallbackModelUrl:modelId?staticModelUrl(modelId)');
    expect(source).toContain("cache:'default'");
    expect(source).not.toContain("cache:'no-cache'");
    expect(source).not.toContain("cache:'force-cache'");
  });

  it('migrates unchanged bad defaults without overwriting user-edited placements', () => {
    const source = readFileSync('web/prototype/pages/my-home/index.html', 'utf8');
    const scene = JSON.parse(readFileSync('web/prototype/assets/demo-backend/scenes/vid_91fe552c5f7d.json', 'utf8'));
    const byId = new Map(scene.items.map((item) => [item.id, item]));
    const sofa = byId.get('ast_e8e7b81eba5c');
    const tallPlant = byId.get('ast_55361e0c8415');
    const sofaDepthAlongZ = sofa.sizePrior.w;
    const zClearance = Math.abs(sofa.pos[2] - tallPlant.pos[2]) - (sofaDepthAlongZ + tallPlant.sizePrior.d) / 2;

    expect(scene.layoutVersion).toBe('20260811-long-room-v2');
    expect(scene.items).toHaveLength(15);
    expect(byId.has('ast_1ddb5e7e233c')).toBe(true);
    expect(byId.has('ast_98ec879aca7a')).toBe(true);
    expect(byId.has('ast_c0274a819f34')).toBe(false);
    expect(byId.has('ast_5229f072c636')).toBe(false);
    expect(zClearance).toBeGreaterThan(0);
    expect(source).toContain('sameScenePlacementTransform(prior,previousDefault)');
    expect(source).toContain('saved.source.sceneAssetSignature!==sceneAssetSignature');
    expect(source).toContain('if(layoutChanged&&sameScenePlacementTransform(prior,previousDefault))return placement');
  });
});
