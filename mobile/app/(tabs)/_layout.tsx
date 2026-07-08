import { Tabs } from "expo-router";
import { Text } from "react-native";
import { theme } from "../../components/theme";

/** emoji 当图标，省依赖；上线可换矢量图标库 */
function Icon({ emoji, color }: { emoji: string; color: string }) {
  return <Text style={{ fontSize: 20, color }}>{emoji}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.bg },
        headerTitleStyle: { color: theme.ink },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.sub,
        tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.line },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "摘抄本",
          tabBarIcon: ({ color }) => <Icon emoji="📖" color={color} />,
        }}
      />
      <Tabs.Screen
        name="video"
        options={{
          title: "视频",
          tabBarIcon: ({ color }) => <Icon emoji="🎬" color={color} />,
        }}
      />
      <Tabs.Screen
        name="photo"
        options={{
          title: "拍照",
          tabBarIcon: ({ color }) => <Icon emoji="📷" color={color} />,
        }}
      />
      <Tabs.Screen
        name="sketch"
        options={{
          title: "画画",
          tabBarIcon: ({ color }) => <Icon emoji="✏️" color={color} />,
        }}
      />
    </Tabs>
  );
}
