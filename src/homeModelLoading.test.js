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

    expect(source).toContain('id="genMotion"');
    expect(source).toContain('working-drawing.webm');
    expect(source).toContain("genMotion.addEventListener('loadeddata',showGenerationMotion");
    expect(source).not.toContain("mountMascotVideoCutout(genMotion");
    expect(source).not.toContain('GENERATION_FALLBACKS');
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
    expect(source).toContain('if(!TARGETED_ENTRY)scheduleVideoScenePreload(scenes)');
    expect(source).toContain('task.finally(()=>{if(modelBufferCache.get(absoluteUrl)===task)modelBufferCache.delete(absoluteUrl);})');
    expect(source).toContain("dreamhome.default-demo-homes.v6-long-living-flower-surface");
  });

  it('does not re-normalize the approved single-apartment snapshot', () => {
    const page = readFileSync('web/prototype/pages/my-home/index.html', 'utf8');
    const defaults = readFileSync('web/prototype/pages/shared/default-homes.generated.js', 'utf8');

    expect(defaults).toContain('"id": "video-vid_40734d7f2e6c"');
    expect(defaults).toContain('"preserveApprovedPlacementScales": true');
    expect(page).toContain('state.project?.preserveApprovedPlacementScales===true');
    expect(page).toContain('const approved=placement.sourceScale||placement.scale');
    expect(page).toContain('const openedReleaseHomeImmediately=Boolean(requestedHomeId&&!FRIEND_SHARE_REQUEST');
    expect(page).toContain('if(openedReleaseHomeImmediately)void openHome(requestedHomeId)');
  });

  it('keeps the long-living-room flower arrangement on its side-table surface', () => {
    const defaults = readFileSync('web/prototype/assets/demo-backend/default-homes.json', 'utf8');
    const { homes } = JSON.parse(defaults);
    const home = homes.find((item) => item.id === 'video-vid_91fe552c5f7d');
    const flower = home.placements.find((item) => item.assetId === 'ast_79d7df1565e0');
    const sideTable = home.placements.find((item) => item.assetId === 'ast_06c83d58cb62');

    expect(flower.position).toEqual({ x: sideTable.position.x, y: 0.65, z: sideTable.position.z });
  });

  it('saves large previews normally and recovers an interrupted assembly draft', () => {
    const source = readFileSync('web/prototype/pages/my-home/index.html', 'utf8');

    expect(source).not.toContain('body:JSON.stringify(project),keepalive:true');
    expect(source).toContain('function recoverLocalAssemblyDraft(serverProject, assemblyId)');
    expect(source).toContain('if(recovered&&queryHomeUserId)syncProjectInBackground(project)');
  });
});
