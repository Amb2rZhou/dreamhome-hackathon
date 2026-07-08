/** 能力3：边画边生成 3D + 语音编辑。 */
import React, { useRef, useState, useCallback } from "react";
import {
  View, Text, Pressable, StyleSheet, PanResponder, GestureResponderEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { captureRef } from "react-native-view-shot";
import GenerateFlow from "../../components/GenerateFlow";
import VoiceInput from "../../components/VoiceInput";
import { submitSketch } from "../../api/client";
import { theme } from "../../components/theme";

export default function SketchScreen() {
  const [paths, setPaths] = useState<string[]>([]);
  const cur = useRef<string>("");
  const canvasRef = useRef<View>(null);
  const [, force] = useState(0);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e: GestureResponderEvent) => {
        const { locationX, locationY } = e.nativeEvent;
        cur.current = `M${locationX.toFixed(1)},${locationY.toFixed(1)}`;
        force((n) => n + 1);
      },
      onPanResponderMove: (e: GestureResponderEvent) => {
        const { locationX, locationY } = e.nativeEvent;
        cur.current += ` L${locationX.toFixed(1)},${locationY.toFixed(1)}`;
        force((n) => n + 1);
      },
      onPanResponderRelease: () => {
        setPaths((p) => [...p, cur.current]);
        cur.current = "";
      },
    }),
  ).current;

  const clear = useCallback(() => {
    setPaths([]);
    cur.current = "";
  }, []);

  // 把画布截成 PNG，返回本地 uri，交给 submitSketch
  const submit = useCallback(async () => {
    const uri = await captureRef(canvasRef, { format: "png", quality: 1 });
    return submitSketch(uri);
  }, []);

  const allPaths = cur.current ? [...paths, cur.current] : paths;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.body}>
        <View style={styles.headRow}>
          <Text style={styles.h}>画画摘抄</Text>
          <Pressable onPress={clear}>
            <Text style={styles.clear}>清空</Text>
          </Pressable>
        </View>
        <Text style={styles.p}>随手画个家具轮廓，生成 3D。画干净的单体线稿效果最好。</Text>

        <View ref={canvasRef} collapsable={false} style={styles.canvas} {...pan.panHandlers}>
          <Svg style={StyleSheet.absoluteFill}>
            {allPaths.map((d, i) => (
              <Path key={i} d={d} stroke={theme.ink} strokeWidth={3} fill="none" />
            ))}
          </Svg>
          {allPaths.length === 0 && (
            <Text style={styles.canvasHint}>在这里画</Text>
          )}
        </View>

        <GenerateFlow kind="sketch" disabled={paths.length === 0} submit={submit} />

        <VoiceInput catalog={["sofa", "chair", "table", "lamp"]} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  body: { padding: 20, gap: 12, flex: 1 },
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  h: { fontSize: 22, fontWeight: "800", color: theme.ink },
  clear: { color: theme.accent, fontWeight: "600" },
  p: { color: theme.sub, lineHeight: 20 },
  canvas: {
    height: 260,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  canvasHint: { color: theme.sub },
});
