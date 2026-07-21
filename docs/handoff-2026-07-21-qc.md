# 交接文档 ①:资产质检修复 session(2026-07-21)

> 目标:6 条 demo 视频逐个验收修复,做到 **轨迹追踪全对 + 3D 组件全且准**。
> 读完本文即可开工,不需要翻旧 session。Boss 习惯:贵/不可逆操作先列选项再执行;先试产再全量;进度要报;失败要大声说。

## 0. 现状一句话

昨夜(07-20~21)已完成:图转3D 强制 SOP 落地(单体化→补全→单体闸→一致性闸,固化在 `backend/pipeline/run.py`),56平 21 件全部重生成,新增 5 条视频 88 件 ready 资产并逐条跑过外观校验。**质量比上一版大幅改善但未逐件人工验收——这就是本 session 的活**。

## 1. 数据现状

| 视频 | video_id | 状态 |
|---|---|---|
| 56平(最早的 demo 主片) | vid_605df2fff231 | 21 件全部新 SOP 重生成;#8 餐桌曾破碎已重抽修复 |
| 视频1 一室一厅 | vid_5f32a0ac954a | 8 ready + **3 件 rejected 待补跑**(TRELLIS 挂死误伤) |
| 视频2 48平 | vid_91fe552c5f7d | 15 ready |
| 视频3 治愈系 | vid_40734d7f2e6c | 7 ready |
| 视频4 原木风 | vid_b75d95dc92a7 | 26 ready |
| 视频5 原木小家 | vid_182cbf77954d | 32 ready |
| 第一个视频(v1 老资产,Boss 认可效果) | vid_58a7a1504281 | 37 件有 GLB,别动,户型重建 session 在用 |

DB: `backend/storage/dreamhome.db`(sqlite)。tracks.frames_json=[{t,bbox}],asset_id NULL=未绑定。

## 2. 工具箱(全在 backend/,都已实测)

| 工具 | 用途 |
|---|---|
| `review/audit.html` | **逐环节审核页**:每件资产 识别上下文→3D输入图→3D成品→绑定段,哪环坏了一眼看出。质检主战场 |
| `review/fix.html` + 3个API(`/api/tracks/{id}/unbind|rebind|cut`) | **手动矫正工作台**,SOP 见 `docs/sop-manual-fix.md`。指错物体→换绑;某段飘走→解绑该段;跨物体→切断 |
| `review/video.html` | demo 预览页(复验用) |
| `tools/regen_assets.py <vid> --only 6,7 [--dry]` | 按新 SOP 重生成指定资产(--only 用资产 thumb 文件名里的 ci 编号,audit 页标题有显示)。先 --dry 看补全图再真跑 |
| `tools/retry_failed.py` | 补跑 rejected 资产(视频1 那 3 件用它) |
| `tools/verify_bindings.py <vid> [--dry]` | 外观校验绑定(CLIP+qwen 三档判定),已对全部 6 条跑过;手动修完轨迹后**不要**再跑它(会覆盖人工判断) |
| `tools/batch_produce.py <links.txt>` | 批量生产,断点续跑(state 在 storage/batch_state.json) |
| TRELLIS 重抽 | seed 写死,同图重跑结果不变;把输入图 96% 微缩再喂 gen3d 即得新结果(参考 scratchpad 里 enh_8_r2 的做法,或直接问 memory) |

## 3. 基础设施与坑(必读)

- **GPU 服务器(阿里云 A10,¥7/h)现在是关的**。开机后 IP 会变:`sed -i '' 's/旧IP/新IP/g' backend/.env`(三处),`curl http://<IP>:9000/health` 探活。SSH: `ssh -i ~/Downloads/hackathon-key.pem root@<IP>`
- 重生成/补跑需要 GPU;纯轨迹手动矫正不需要
- **TRELLIS 容器会挂起而非退出**(docker 显示 unhealthy、9001 无响应):`docker restart trellis`,50s 恢复,首任务再加载模型 1-2 分钟(窗口期 submit 失败属正常,资产被误打回就 retry_failed)
- Boss 的 Mac 代理 TUN 模式会掐死 SSH/9000:先 `curl -s myip.ipip.net`,出口不是国内就让 Boss 关 TUN
- `pkill -f` 会自杀,用 `[b]racket` 模式;`timeout` 命令 Mac 上没有
- 本地后端: `cd backend && ./.venv/bin/uvicorn app.main:app --port 8000`(无 --reload,改 python 代码后要重启);队友 serina 的 segment_api 在 :8002,**别动她的模块**
- 长任务用 `nohup ... & disown` 脱离会话树(会话内 background 任务可能被系统连坐杀掉,昨晚发生过)
- 补全走 :8002 /api/inpaint(wan2.7-image ¥0.2/张),校验走 dashscope qwen(¥0.008/次),都有内容缓存,重跑不重复花钱

## 4. 本 session 工作循环(每条视频)

1. 开 `audit.html?v=<vid>` 逐件看:①识别对不对 ②输入图干不干净 ③3D 完整不 ④绑定段合理不
2. 3D 差 → `regen_assets.py --only <ci> --dry` 看补全图 → OK 就去掉 --dry 真跑(需 GPU);仍破碎 → 96% 微缩重抽
3. 轨迹错 → `fix.html` 手动修(解绑/换绑/切断),修完 `video.html` 复验
4. 缺资产(视频里有但库里没有)→ 该物体轨迹若已入索引,用 regen 思路生成并绑定;不在索引就记下来,量大再议方案
5. 一条视频全绿后在下表打勾,Feishu 报 Boss 验收

验收清单(做完打勾):
- [x] vid_605df2fff231 56平
- [x] vid_5f32a0ac954a 视频1(3件已补,2件重复边柜留未绑)
- [x] vid_91fe552c5f7d 视频2
- [x] vid_40734d7f2e6c 视频3
- [x] vid_b75d95dc92a7 视频4
- [x] vid_182cbf77954d 视频5(厨房柜1件废弃)

## 5. 顺手的收尾活

- ECS 控制台确认停机不计费(Boss 可能已看)
- **git 提交**:本地分支被别的 session 占用,**严禁 checkout/切分支**。安全路径:`git worktree add /tmp/dh-main origin/main` → rsync 改动文件过去 → 在 worktree 里 commit → `git push origin HEAD:main`。仓库是 **public**,IP/key 绝不能进 commit(全在 gitignored 的 backend/.env)
- `docs/sop-asset-production.md`、`docs/pipeline-explainer.md` 更新为新 SOP 版本
- 值得留痕的结论追加到 `~/.clawd/work/wiki/log.md`
