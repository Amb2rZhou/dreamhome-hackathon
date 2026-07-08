/**
 * 语音输入：Web 端用浏览器 SpeechRecognition 直接听写；
 * 原生端 demo 阶段用文字输入模拟 ASR 结果(接 @react-native-voice 需 dev build)。
 * 拿到文本后调后端 /api/voice-edit 解析成结构化指令。
 */
import React, { useState, useCallback } from "react";
import { View, Text, TextInput, Pressable, Platform, StyleSheet } from "react-native";
import { voiceEdit, type EditCommand } from "../api/client";
import { theme } from "./theme";

export default function VoiceInput({
  catalog,
  onCommand,
}: {
  catalog?: string[];
  onCommand?: (cmd: EditCommand) => void;
}) {
  const [text, setText] = useState("");
  const [cmd, setCmd] = useState<EditCommand | null>(null);
  const [listening, setListening] = useState(false);

  const parse = useCallback(
    async (t: string) => {
      const value = t.trim();
      if (!value) return;
      const result = await voiceEdit(value, catalog);
      setCmd(result);
      onCommand?.(result);
    },
    [catalog, onCommand],
  );

  // Web：浏览器原生听写
  const listen = useCallback(() => {
    if (Platform.OS !== "web") return;
    const SR =
      (globalThis as any).SpeechRecognition ||
      (globalThis as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = "zh-CN";
    rec.onresult = (e: any) => {
      const t = e.results[0][0].transcript;
      setText(t);
      parse(t);
    };
    rec.onend = () => setListening(false);
    setListening(true);
    rec.start();
  }, [parse]);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>语音编辑</Text>
      <View style={styles.row}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder='例如"把沙发靠窗放" "椅子转个方向" "放大一点"'
          placeholderTextColor={theme.sub}
          style={styles.input}
          onSubmitEditing={() => parse(text)}
        />
        {Platform.OS === "web" ? (
          <Pressable onPress={listen} style={styles.mic}>
            <Text style={styles.micText}>{listening ? "🔴" : "🎤"}</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => parse(text)} style={styles.mic}>
            <Text style={styles.micText}>解析</Text>
          </Pressable>
        )}
      </View>

      {cmd && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>解析结果</Text>
          <Text style={styles.cardLine}>动作：{cmd.action}</Text>
          {cmd.target ? <Text style={styles.cardLine}>对象：{cmd.target}</Text> : null}
          {cmd.value ? <Text style={styles.cardLine}>参数：{cmd.value}</Text> : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  label: { fontWeight: "700", color: theme.ink },
  row: { flexDirection: "row", gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radius,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: theme.ink,
    backgroundColor: theme.surface,
  },
  mic: {
    width: 52,
    borderRadius: theme.radius,
    backgroundColor: theme.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  micText: { fontSize: 18, color: theme.accent, fontWeight: "600" },
  card: {
    backgroundColor: theme.paper,
    borderRadius: theme.radius,
    padding: 12,
    gap: 4,
  },
  cardTitle: { fontWeight: "700", color: theme.ink, marginBottom: 2 },
  cardLine: { color: theme.sub },
});
