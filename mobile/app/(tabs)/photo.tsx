/** 能力2：线下逛店拍一张家具 → 3D。拍照或从相册选。 */
import React, { useState, useCallback } from "react";
import { View, Text, Pressable, StyleSheet, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import GenerateFlow from "../../components/GenerateFlow";
import { submitPhoto } from "../../api/client";
import { theme } from "../../components/theme";

export default function PhotoScreen() {
  const [uri, setUri] = useState<string | null>(null);

  const take = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchCameraAsync({ quality: 1 });
    if (!res.canceled) setUri(res.assets[0].uri);
  }, []);

  const pick = useCallback(async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });
    if (!res.canceled) setUri(res.assets[0].uri);
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.body}>
        <Text style={styles.h}>拍照摘抄</Text>
        <Text style={styles.p}>对着喜欢的家具拍一张，自动去背景，生成 3D 组件。</Text>

        <View style={styles.preview}>
          {uri ? (
            <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
          ) : (
            <Text style={styles.pickerText}>📷 还没有照片</Text>
          )}
        </View>

        <View style={styles.row}>
          <Pressable onPress={take} style={[styles.smallBtn, styles.smallBtnFill]}>
            <Text style={styles.smallBtnFillText}>拍照</Text>
          </Pressable>
          <Pressable onPress={pick} style={styles.smallBtn}>
            <Text style={styles.smallBtnText}>相册选</Text>
          </Pressable>
        </View>

        <GenerateFlow
          kind="photo"
          disabled={!uri}
          submit={() => submitPhoto(uri as string)}
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
  preview: {
    height: 220,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.paper,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  thumb: { width: "100%", height: "100%" },
  pickerText: { color: theme.sub, fontSize: 16 },
  row: { flexDirection: "row", gap: 12 },
  smallBtn: {
    flex: 1,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.accent,
    paddingVertical: 12,
    alignItems: "center",
  },
  smallBtnText: { color: theme.accent, fontWeight: "600" },
  smallBtnFill: { backgroundColor: theme.accent, borderColor: theme.accent },
  smallBtnFillText: { color: "#fff", fontWeight: "600" },
});
