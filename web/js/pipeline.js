// 图/照片 → 3D 组件 的共享管线（图生3D、拍照 两个 tab 复用）
import { run, findMeshUrl } from './fal.js';
import { FAL, guessKind } from './config.js';
import { showProgress } from './progress.js';
import { toast } from './toast.js';
import { add } from './library.js';
import { thumbnail } from './imgutil.js';

// imageDataURI：已缩放好的 dataURI。返回新建的组件记录。
export async function imageToComponent(imageDataURI, { name } = {}) {
  const prog = showProgress();
  try {
    const res = await run(FAL.trellis, { image_url: imageDataURI }, { overallMs: 120000 });
    const glb = findMeshUrl(res);
    if (!glb) throw new Error('未拿到 3D 模型 URL');
    const img = await thumbnail(imageDataURI).catch(() => imageDataURI);
    const finalName = (name && name.trim()) || '摘抄组件';
    const rec = add({ name: finalName, kind: guessKind(finalName), glb, img });
    prog.done();
    toast('已摘抄进组件库 ✓', 'ok');
    return rec;
  } catch (e) {
    prog.fail();
    if (e.noKey) toast('请先在地址栏用 #key=你的key 注入 fal key', 'err', 3800);
    else toast(e.message || '生成失败，请重试', 'err', 3400);
    throw e;
  }
}
