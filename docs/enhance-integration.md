# 抠图补全模块对接契约(给队友)

> 你负责的环节:**残缺的视频帧抠图 → 干净完整的家具产品图**。
> pipeline 已留好卡槽(`backend/app/services/enhance.py`),按下面任一形式交付即可即插即用,
> 其余环节(检测/追踪/聚类/3D生成/入库)不用动。

## 输入 / 输出

- **输入**:一张 jpg 路径 —— 从视频帧裁出的单件家具,可能残缺/遮挡/偏暗/切边(外扩了 8% 上下文)
- **输出**:补全后的产品图写到指定路径 —— 单件家具、尽量完整、白/纯色背景、光照均匀,
  **保持颜色材质造型与原图一致**(用户要认得出是"同款")
- 失败就非零退出/抛异常,pipeline 会自动降级用原图,不用做兜底

## 交付形式(二选一)

**A. Python 模块**(推荐):仓库放 `backend/enhance_custom.py`,实现:

```python
def enhance(in_path: str, out_path: str) -> None:
    ...  # 读 in_path,补全,写 out_path;同步/async 都行
```

启用:`.env` 里 `ENHANCE_PROVIDER=module`

**B. 命令行脚本**(语言不限):

```
你的命令 <输入路径> <输出路径>
```

启用:`ENHANCE_PROVIDER=cmd` + `ENHANCE_CMD="python3 你的脚本.py {in} {out}"`

## 测试素材

`backend/storage/pipeline/<video_id>/cut_*.jpg` 里有真实量产抠图(各种残缺程度都有),
直接拿来调效果。单张耗时建议 ≤60s(pipeline 超时 120s 降级)。

## 接入后验证

```bash
cd backend && ENHANCE_PROVIDER=module ./.venv/bin/python tools/batch_produce.py "<抖音链接>"
# 跑完开 http://localhost:8000/review 对比模型质量
```
