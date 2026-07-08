/**
 * DreamHome 后端客户端。三个能力共用同一套 提交→轮询 流程。
 * 改 API_BASE 指向你部署的后端(本地调试用局域网 IP，上线用公网域名)。
 */

// 部署后端后改这里。Expo 支持 EXPO_PUBLIC_ 前缀的环境变量。
export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE ?? "http://localhost:8000";

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export interface Job {
  job_id: string;
  kind: "video" | "photo" | "sketch";
  status: JobStatus;
  progress: number;
  model_url: string | null;
  thumbnail_url: string | null;
  category?: string | null;
  style?: string | null;
  error?: string | null;
  provider?: string | null;
}

export interface EditCommand {
  action: "move" | "rotate" | "scale" | "replace" | "select" | "delete" | "unknown";
  target?: string | null;
  value?: string | null;
  params: Record<string, unknown>;
  transcript: string;
  confidence: number;
}

/** 把本地文件(RN 的 uri)包成 multipart 的一项 */
function filePart(uri: string, name: string, type: string) {
  // React Native 的 FormData 接受 { uri, name, type }
  return { uri, name, type } as unknown as Blob;
}

async function submit(path: string, form: FormData): Promise<string> {
  const res = await fetch(`${API_BASE}${path}`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`${path} 提交失败: ${res.status}`);
  const data = await res.json();
  return data.job_id as string;
}

/** 能力1：视频 → 3D。bbox 可选，格式 "x,y,w,h" */
export async function submitVideo(uri: string, bbox?: string): Promise<string> {
  const form = new FormData();
  form.append("file", filePart(uri, "clip.mp4", "video/mp4"));
  if (bbox) form.append("bbox", bbox);
  return submit("/api/video-to-3d", form);
}

/** 能力2：拍照 → 3D */
export async function submitPhoto(uri: string, bbox?: string): Promise<string> {
  const form = new FormData();
  form.append("file", filePart(uri, "photo.jpg", "image/jpeg"));
  if (bbox) form.append("bbox", bbox);
  return submit("/api/photo-to-3d", form);
}

/** 能力3：画画 → 3D。传线稿 PNG 的 data uri 或文件 uri */
export async function submitSketch(uri: string): Promise<string> {
  const form = new FormData();
  form.append("file", filePart(uri, "sketch.png", "image/png"));
  return submit("/api/sketch-to-3d", form);
}

/** 轮询任务直到终态，onProgress 每次回调进度 */
export async function pollJob(
  jobId: string,
  onProgress?: (job: Job) => void,
  intervalMs = 2000,
  timeoutMs = 300000,
): Promise<Job> {
  const start = Date.now();
  // 注意：宿主环境需提供计时器；RN/浏览器都有 setTimeout
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${API_BASE}/api/jobs/${jobId}`);
    if (!res.ok) throw new Error(`查询失败: ${res.status}`);
    const job = (await res.json()) as Job;
    onProgress?.(job);
    if (job.status === "succeeded" || job.status === "failed") return job;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("生成超时");
}

/** 语音编辑：把 ASR 文本解析成结构化指令 */
export async function voiceEdit(
  transcript: string,
  catalog?: string[],
): Promise<EditCommand> {
  const res = await fetch(`${API_BASE}/api/voice-edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript, catalog }),
  });
  if (!res.ok) throw new Error(`语音解析失败: ${res.status}`);
  return (await res.json()) as EditCommand;
}
