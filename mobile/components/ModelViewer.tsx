/**
 * 跨平台 GLB 预览：用 Google <model-viewer> 塞进 WebView。
 * iOS/Android/Web 一套，自带旋转/缩放手势和 AR 按钮(手机上"摆进真实房间")。
 * Web 端直接渲染原生 <model-viewer>；原生端用 WebView 包一个最小 HTML。
 */
import React from "react";
import { Platform, StyleSheet, View, Text } from "react-native";
import { WebView } from "react-native-webview";

function html(modelUrl: string) {
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<script type="module" src="https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js"></script>
<style>html,body{margin:0;height:100%;background:#f5f3ee}model-viewer{width:100%;height:100%}</style>
</head><body>
<model-viewer src="${modelUrl}" camera-controls auto-rotate ar
  ar-modes="webxr scene-viewer quick-look" shadow-intensity="1"
  exposure="1" environment-image="neutral"></model-viewer>
</body></html>`;
}

export default function ModelViewer({ modelUrl }: { modelUrl?: string | null }) {
  if (!modelUrl) {
    return (
      <View style={[styles.box, styles.center]}>
        <Text style={styles.hint}>还没有模型</Text>
      </View>
    );
  }

  // Web：注入原生自定义元素，避免 WebView 套 WebView
  if (Platform.OS === "web") {
    return (
      <View style={styles.box}>
        {/* @ts-ignore model-viewer 是自定义元素 */}
        <model-viewer
          src={modelUrl}
          camera-controls
          auto-rotate
          ar
          style={{ width: "100%", height: "100%" }}
        />
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <WebView
        originWhitelist={["*"]}
        source={{ html: html(modelUrl) }}
        style={{ backgroundColor: "#f5f3ee" }}
        allowsInlineMediaPlayback
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, borderRadius: 16, overflow: "hidden", backgroundColor: "#f5f3ee" },
  center: { alignItems: "center", justifyContent: "center" },
  hint: { color: "#9a927f" },
});
