/**
 * 复用的"生成流"：拿到一个 submit()(返回 jobId)后，统一负责
 * 轮询进度 → 出 GLB → 预览 → 一键存进摘抄本。三个能力屏共用。
 */
import React, { useState, useCallback } from "react";
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { pollJob, type Job } from "../api/client";
import { addItem } from "./library";
import ModelViewer from "./ModelViewer";
import { theme } from "./theme";

type Phase = "idle" | "running" | "done" | "error";

export default function GenerateFlow({
  kind,
  submit,
  disabled,
}: {
  kind: Job["kind"];
  submit: () => Promise<string>; // 返回 jobId
  disabled?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [job, setJob] = useState<Job | null>(null);
  const [err, setErr] = useState<string>("");

  const run = useCallback(async () => {
    setPhase("running");
    setProgress(0);
    setErr("");
    setJob(null);
    try {
      const jobId = await submit();
      const finished = await pollJob(jobId, (j) => setProgress(j.progress));
      if (finished.status === "succeeded") {
        setJob(finished);
        setPhase("done");
      } else {
        setErr(finished.error ?? "生成失败");
        setPhase("error");
      }
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setPhase("error");
    }
  }, [submit]);

  const save = useCallback(() => {
    if (!job?.model_url) return;
    addItem({
      id: job.job_id,
      kind,
      modelUrl: job.model_url,
      thumbnailUrl: job.thumbnail_url,
      category: job.category,
      createdAt: job.job_id.length, // 占位，避免用 Date；真实时间由后端给
    });
  }, [job, kind]);

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={run}
        disabled={disabled || phase === "running"}
        style={[styles.btn, (disabled || phase === "running") && styles.btnOff]}
      >
        <Text style={styles.btnText}>
          {phase === "running" ? "生成中…" : "生成 3D 组件"}
        </Text>
      </Pressable>

      {phase === "running" && (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} />
          <Text style={styles.progress}>{progress}%</Text>
          <Text style={styles.sub}>3D 生成约需 30–120 秒</Text>
        </View>
      )}

      {phase === "error" && <Text style={styles.error}>⚠️ {err}</Text>}

      {phase === "done" && job && (
        <View style={styles.result}>
          <View style={styles.viewer}>
            <ModelViewer modelUrl={job.model_url} />
          </View>
          <Pressable onPress={save} style={styles.saveBtn}>
            <Text style={styles.saveText}>＋ 存进摘抄本</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  btn: {
    backgroundColor: theme.accent,
    paddingVertical: 14,
    borderRadius: theme.radius,
    alignItems: "center",
  },
  btnOff: { opacity: 0.4 },
  btnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  center: { alignItems: "center", gap: 6, paddingVertical: 12 },
  progress: { fontSize: 22, fontWeight: "700", color: theme.ink },
  sub: { color: theme.sub, fontSize: 12 },
  error: { color: "#b5462f", textAlign: "center" },
  result: { gap: 10 },
  viewer: { height: 320 },
  saveBtn: {
    borderWidth: 1,
    borderColor: theme.accent,
    borderRadius: theme.radius,
    paddingVertical: 12,
    alignItems: "center",
  },
  saveText: { color: theme.accent, fontWeight: "600" },
});
