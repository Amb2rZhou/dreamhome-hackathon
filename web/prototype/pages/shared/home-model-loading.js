const MODEL_BACKED_SOURCE_TYPES = new Set(['video_rebuild', 'case_copy', 'space_assembly']);

export function isModelBackedHome(project) {
  return MODEL_BACKED_SOURCE_TYPES.has(project?.source?.type);
}

export function inferRuntimePrimitive(item = {}) {
  const hints = [item.name, ...(Array.isArray(item.tags) ? item.tags : [])]
    .filter(Boolean)
    .join(' ');

  if (/床/.test(hints)) return 'bed';
  if (/沙发|坐垫/.test(hints)) return 'sofa';
  if (/椅|凳/.test(hints)) return 'chair';
  if (/灯/.test(hints)) return 'lamp';
  if (/桌|茶几/.test(hints)) return 'table';
  if (/柜|架|收纳/.test(hints)) return 'cabinet';
  return 'plant';
}
