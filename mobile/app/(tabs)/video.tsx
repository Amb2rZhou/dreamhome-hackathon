/** 能力1：从装修/探家视频里摘一件家具 → 3D。 */
import React, { useState, useCallback } from "react";
import { View, Text, Pressable, StyleSheet, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import GenerateFlow from "../../components/GenerateFlow";
import { submitVideo } from "../../api/client";
import { theme } from "../../components/theme";

export default function VideoScreen() {
  const [uri, setUri] = useState<string | null>(null);

  const pick = useCallback(async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      quality: 1,
    });
    if (!res.canceled) setUri(res.assets[0].uri);
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.body}>
        <Text style={styles.h}>视频摘抄</Text>
        <Text style={styles.p}>
          选一段装修/探家视频，我们自动挑最清晰的一帧、抠出家具，生成 3D 组件。
        </Text>

        <Pressable onPress={pick} style={styles.picker}>
          {uri ? (
            <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
          ) : (
            <Text style={styles.pickerText}>🎬 选择视频</Text>
          )}
        </Pressable>

        <GenerateFlow
          kind="video"
          disabled={!uri}
          submit={() => submitVideo(uri as string)}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  body: { padding: 20, gap: 14, flex: 1 },
  h: { fontSize: 22, fontWeight: "800", color: theme.ink },
  p: { color: theme.sub, lineHeight: 20 },
  picker: {
    height: 200,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.paper,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  pickerText: { color: theme.sub, fontSize: 16 },
  thumb: { width: "100%", height: "100%" },
});
