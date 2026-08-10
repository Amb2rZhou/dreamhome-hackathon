import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readPage = (name) => readFileSync(resolve(process.cwd(), `web/prototype/pages/${name}/index.html`), 'utf8');
const readShared = (name) => readFileSync(resolve(process.cwd(), `web/prototype/pages/shared/${name}`), 'utf8');
const readBackend = (name) => readFileSync(resolve(process.cwd(), `backend/app/${name}`), 'utf8');

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
    const photoRouter = readBackend('routers/photo.py');
    expect(capture).toContain('styles:[...state.styles]');
    expect(capture).toContain('/commit`');
    expect(photoRouter).toContain('"source_type": "offline_photo"');
    expect(photoRouter).toContain('"styles": styles');
    expect(photoRouter).toContain('"materials": materials');
    expect(photoRouter).toContain('size_prior = None');
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

  it('uses Mia room setup as the only custom-room flow and keeps the shared editor contract', () => {
    const setup = readPage('room-setup');
    const home = readPage('my-home');

    expect(home).not.toContain('custom-plan');
    expect(home).not.toContain('customPlanButton');
    expect(home).not.toContain('selectCustomPlan');
    expect(home).toContain("location.href = `../room-setup/index.html?template=${encodeURIComponent(state.selectedTemplateId)}`");
    expect(setup).toContain("location.href = `${MY_HOME}?template=${encodeURIComponent(state.templateId)}&w=${w}&d=${d}&h=${h}&autogen=1`");
    expect(setup).toContain("supportedFloorplans().some((item) => item.templateId === requested)");

    // Mia's dimensions must enter the existing DreamHome project/editor shape.
    expect(home).toContain('project.source.custom = { ...dims }');
    expect(home).toContain('walls:clone(template.walls)');
    expect(home).toContain('rooms, windowSlots, placements');
    expect(home).toContain('finishes:{floorAssetId:null,wallpaperAssetId:null}');
    expect(home).toContain('function beginPlacement(assetId)');
    expect(home).toContain('function applyProjectFinish(kind, assetId)');
  });

  it('opens canonical space assemblies as editable projects without cloning assets', () => {
    const home = readPage('my-home');

    expect(home).toContain("const assemblyId=QUERY.get('assembly')");
    expect(home).toContain('function projectFromSpaceAssembly(sceneData, projectData)');
    expect(home).toContain('/api/space-assemblies/${encoded}/scene');
    expect(home).toContain('/api/space-assemblies/${encoded}/home-project');
    expect(home).toContain("type:'space_assembly'");
    expect(home).toContain('homeSceneService.saveProject(project)');
    expect(home).toContain("project?.source?.type==='space_assembly'&&!queryHomeUserId");
  });

  it('opens the editor on lightweight AI recommendations without exposing the old mascot assistant', () => {
    const home = readPage('my-home');

    expect(home).toContain("drawerMode:'ai'");
    expect(home).toContain('data-drawer-mode="ai">✦ AI 推荐</button>');
    expect(home).toContain('function getDrawerAiRecommendations()');
    expect(home).toContain('commonMatchTags(tags.styles,profile.styles)');
    expect(home).toContain('commonMatchTags(tags.colors,profile.colors)');
    expect(home).toContain('commonMatchTags(tags.materials,profile.materials)');
    expect(home).toContain('data-ai-refresh');
    expect(home).toContain('function canUseMatchAssistant() { return false; }');
  });

  it('integrates Sunny friend sharing while preserving backend canonical assets', () => {
    const home = readPage('my-home');
    const chat = readPage('chat');
    const social = readShared('social-demo-data.js');
    const assets = readShared('asset-library-data.js');

    expect(home).toContain("import { getFriends, addMessage, getConversation }");
    expect(home).toContain('id="shareFriendRow"');
    expect(home).toContain("type:'home_share'");
    expect(home).toContain('sourceShareMessage()');
    expect(home).toContain('sourceHomeId:state.project.sourceHomeId||state.project.id');
    expect(chat).toContain('data-share-id=');
    expect(chat).toContain('&shareId=${encodeURIComponent(message.id)}');
    expect(chat).toContain('addCanonicalAssetToLibrary(assetId');
    expect(assets).toContain('/api/library/batch-add');
    expect(assets).toContain('record?.asset_id === id');
    expect(social).toContain('export function addMessage');
    expect(home).toContain("import { mountFireBuddyHomeVisitor }");
    expect(home).toContain('if(IS_FRIEND_SHARE_VISIT)');
    expect(home).toContain('projectPlacements:project.placements||[]');
    expect(home).toContain("variant:'share'");
    expect(home).toContain('fireBuddyVisitor?.dispose?.()');
  });
});
