/**
 * 素材库(摘抄本)：存放已生成的 3D 组件。
 * demo 用内存 + 订阅；上线换 AsyncStorage/后端账号维度持久化。
 */
import { useSyncExternalStore } from "react";
import type { Job } from "../api/client";

export interface SavedItem {
  id: string;
  kind: Job["kind"];
  modelUrl: string;
  thumbnailUrl?: string | null;
  category?: string | null;
  createdAt: number;
}

let items: SavedItem[] = [];
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function addItem(item: SavedItem) {
  items = [item, ...items];
  emit();
}

export function removeItem(id: string) {
  items = items.filter((i) => i.id !== id);
  emit();
}

/** React 订阅：组件里 const list = useLibrary() */
export function useLibrary(): SavedItem[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => items,
    () => items,
  );
}
