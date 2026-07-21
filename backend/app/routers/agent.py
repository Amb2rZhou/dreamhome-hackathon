"""Feedback → 后台 Claude Code 会话桥(配套 /review/rebuild.html 视频旁的工作流面板).

boss 在页面上对 demo 提反馈,这里起一个 headless claude 会话(-p + stream-json)
在项目根目录干活;工作流事件(工具调用/文本/结果)经 SSE 推回页面。
会话 id 落盘,多条反馈 --resume 续用同一会话,保住上下文。
"""
import asyncio
import json
import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter(prefix="/api/agent", tags=["agent"])

ROOT = Path(__file__).resolve().parents[3]                      # dreamhome-hackathon/
AGENT_DIR = Path(__file__).resolve().parents[2] / "storage" / "agent"
AGENT_DIR.mkdir(parents=True, exist_ok=True)
EVENTS = AGENT_DIR / "events.jsonl"
SESSION = AGENT_DIR / "session_id.txt"

_subs: set[asyncio.Queue] = set()
_busy = False

# 新会话的第一条提示带上项目上下文;之后 --resume 有历史,直接发反馈原文
FIRST_PROMPT = """你是 DreamHome 项目的 demo 改进 agent,工作目录就是项目根。
Boss 会对 /review/rebuild.html(视频→3D 户型重建对照页,FastAPI 静态托管)持续提反馈,
你直接改代码落实。主要文件: backend/review/rebuild.html;后端路由在 backend/app/routers/。
改完页面刷新即生效,不用重启服务。用中文回复,简短说明改了什么、为什么。

Boss 的反馈: {text}"""


class Feedback(BaseModel):
    text: str


def _claude_bin() -> str:
    p = shutil.which("claude") or str(Path.home() / ".local/bin/claude")
    if not Path(p).exists():
        raise HTTPException(500, "找不到 claude CLI")
    return p


async def _publish(ev: dict):
    with EVENTS.open("a") as f:
        f.write(json.dumps(ev, ensure_ascii=False) + "\n")
    for q in list(_subs):
        q.put_nowait(ev)


def _brief(inp: dict) -> str:
    """工具参数压成一行,页面上仿 claude code 的 ● Tool(简述) 显示."""
    for k in ("file_path", "path", "notebook_path"):
        if inp.get(k):
            v = str(inp[k])
            return v.replace(str(ROOT) + "/", "")
    for k in ("command", "pattern", "query", "description", "url", "prompt"):
        if inp.get(k):
            v = " ".join(str(inp[k]).split())
            return v[:80] + ("…" if len(v) > 80 else "")
    return ""


def _simplify(raw: dict) -> list[dict]:
    t = raw.get("type")
    if t == "system" and raw.get("subtype") == "init":
        return [{"kind": "init", "session_id": raw.get("session_id", "")}]
    if t == "assistant":
        out = []
        for blk in (raw.get("message") or {}).get("content") or []:
            if blk.get("type") == "text" and blk.get("text", "").strip():
                out.append({"kind": "text", "text": blk["text"].strip()})
            elif blk.get("type") == "tool_use":
                out.append({"kind": "tool", "tool": blk.get("name", "?"),
                            "brief": _brief(blk.get("input") or {})})
        return out
    if t == "result":
        return [{"kind": "done", "ok": raw.get("subtype") == "success",
                 "secs": round((raw.get("duration_ms") or 0) / 1000),
                 "session_id": raw.get("session_id", "")}]
    return []


async def _run(text: str):
    global _busy
    _busy = True
    try:
        await _publish({"kind": "prompt", "text": text})
        sid = SESSION.read_text().strip() if SESSION.exists() else ""
        prompt = text if sid else FIRST_PROMPT.format(text=text)
        cmd = [_claude_bin(), "-p", prompt,
               "--output-format", "stream-json", "--verbose",
               "--permission-mode", "bypassPermissions"]
        if sid:
            cmd += ["--resume", sid]
        proc = await asyncio.create_subprocess_exec(
            *cmd, cwd=str(ROOT), limit=20 * 1024 * 1024,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        stderr_task = asyncio.create_task(proc.stderr.read())
        async for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                raw = json.loads(line)
            except json.JSONDecodeError:
                continue
            new_sid = raw.get("session_id")
            if new_sid:
                SESSION.write_text(new_sid)
            for ev in _simplify(raw):
                await _publish(ev)
        rc = await proc.wait()
        if rc != 0:
            err = (await stderr_task).decode(errors="replace")[-400:].strip()
            # resume 失效(会话被删/被占用)就清掉,下条反馈重开新会话
            if sid and ("session" in err.lower() or "resume" in err.lower()):
                SESSION.unlink(missing_ok=True)
            await _publish({"kind": "error", "text": err or f"claude 退出码 {rc}"})
    except Exception as e:  # noqa: BLE001 — 任何异常都要让页面看到,而不是面板卡死
        await _publish({"kind": "error", "text": str(e)[:400]})
    finally:
        _busy = False


@router.post("/feedback")
async def post_feedback(fb: Feedback):
    text = fb.text.strip()
    if not text:
        raise HTTPException(400, "反馈内容为空")
    if _busy:
        raise HTTPException(409, "上一条反馈还在处理中")
    asyncio.create_task(_run(text))
    return {"ok": True}


@router.get("/status")
async def status():
    sid = SESSION.read_text().strip() if SESSION.exists() else ""
    return {"busy": _busy, "session_id": sid}


@router.post("/reset")
async def reset():
    """换新会话并清空面板历史(不动已改的代码)."""
    if _busy:
        raise HTTPException(409, "处理中,不能重置")
    SESSION.unlink(missing_ok=True)
    EVENTS.unlink(missing_ok=True)
    return {"ok": True}


@router.get("/stream")
async def stream():
    q: asyncio.Queue = asyncio.Queue()
    _subs.add(q)

    async def gen():
        try:
            # 回放历史,页面刷新工作流不丢
            if EVENTS.exists():
                for ln in EVENTS.read_text().splitlines()[-300:]:
                    yield f"data: {ln}\n\n"
            yield 'data: {"kind":"live"}\n\n'
            while True:
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            _subs.discard(q)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache"})
