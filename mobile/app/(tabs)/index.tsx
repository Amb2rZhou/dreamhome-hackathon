/** 摘抄本 = 已摘抄的 3D 组件素材库。空态引导去三个能力页摘抄。 */
import React from "react";
import { View, Text, FlatList, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link } from "expo-router";
import { useLibrary } from "../../components/library";
import ModelViewer from "../../components/ModelViewer";
import { theme } from "../../components/theme";

const KIND_LABEL: Record<string, string> = {
  video: "视频摘抄",
  photo: "拍照摘抄",
  sketch: "手绘摘抄",
};

export default function Home() {
  const items = useLibrary();

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>家的灵感摘抄本</Text>
        <Text style={styles.sub}>看见喜欢的，摘抄下来，变成你梦想之家的一件</Text>
      </View>

      {items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>🛋️</Text>
          <Text style={styles.emptyText}>还没有摘抄。去三个入口摘一件吧：</Text>
          <View style={styles.entries}>
            <Entry href="/video" emoji="🎬" label="从视频里摘" />
            <Entry href="/photo" emoji="📷" label="拍下来摘" />
            <Entry href="/sketch" emoji="✏️" label="画出来摘" />
          </View>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          numColumns={2}
          columnWrapperStyle={{ gap: 12 }}
          contentContainerStyle={styles.grid}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardViewer}>
                <ModelViewer modelUrl={item.modelUrl} />
              </View>
              <Text style={styles.cardCat} numberOfLines={1}>
                {item.category ?? KIND_LABEL[item.kind] ?? "组件"}
              </Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function Entry({ href, emoji, label }: { href: string; emoji: string; label: string }) {
  return (
    <Link href={href as any} asChild>
      <Pressable style={styles.entry}>
        <Text style={styles.entryEmoji}>{emoji}</Text>
        <Text style={styles.entryLabel}>{label}</Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  header: { padding: 20, paddingBottom: 12 },
  title: { fontSize: 24, fontWeight: "800", color: theme.ink },
  sub: { color: theme.sub, marginTop: 4 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  emptyEmoji: { fontSize: 48 },
  emptyText: { color: theme.sub },
  entries: { flexDirection: "row", gap: 12, marginTop: 8 },
  entry: {
    backgroundColor: theme.surface,
    borderColor: theme.line,
    borderWidth: 1,
    borderRadius: theme.radius,
    paddingVertical: 16,
    paddingHorizontal: 14,
    alignItems: "center",
    gap: 6,
  },
  entryEmoji: { fontSize: 24 },
  entryLabel: { color: theme.ink, fontSize: 12 },
  grid: { padding: 20, gap: 12 },
  card: { flex: 1, gap: 6 },
  cardViewer: {
    height: 150,
    borderRadius: theme.radius,
    overflow: "hidden",
    backgroundColor: theme.paper,
  },
  cardCat: { color: theme.ink, fontSize: 13, fontWeight: "500" },
});
