// Generated from asm_bedroom_3a2749b355d9. Keep canonical asset ids and
// meter-space target sizes aligned with the backend space-assembly projection.
const roomId = 'room_bedroom';
const homeId = 'home_demo_bedroom_3a2749b355d9';
const placement = (id, assetId, mount, position, rotationY, size) => ({
  id,
  homeId,
  assetId,
  roomId,
  position: { x: position[0], y: position[1], z: position[2] },
  rotation: { x: 0, y: rotationY, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  sourceScale: { x: 1, y: 1, z: 1 },
  customSize: { width: size[0], height: size[1], depth: size[2] },
  mount,
  visible: true,
});

export const DEFAULT_BEDROOM_HOME = {
  schemaVersion: 3,
  id: homeId,
  name: '复古暖棕卧室',
  source: {
    type: 'space_assembly',
    assemblyId: 'asm_bedroom_3a2749b355d9',
    imagePostId: 'imgpost_ba7a0419c9ca155a',
  },
  realScene: {
    room: { w: 3.6, d: 5.4, h: 2.8 },
    balcony: null,
    extras: [],
    cfg: {
      light: 'warm_day',
      view: 'soft_daylight',
      estimated: true,
      windows: [{ id: 'window_left_1', wall: 'left', type: 'tall', style: 'sheer', center: -1.15, width: 1.25, height: 2.05, sill: 0.25 }],
      camera: { position: [0, 2, 4.9], target: [0, 0.9, -0.4], fov_deg: 48 },
    },
  },
  envelope: { width: 3.6, depth: 5.4 },
  walls: [
    { id: 'wall_back', axis: 'x', at: -2.7, from: -1.8, to: 1.8, role: 'exterior' },
    { id: 'wall_front', axis: 'x', at: 2.7, from: -1.8, to: 1.8, role: 'exterior' },
    { id: 'wall_left', axis: 'z', at: -1.8, from: -2.7, to: 2.7, role: 'exterior' },
    { id: 'wall_right', axis: 'z', at: 1.8, from: -2.7, to: 2.7, role: 'exterior' },
  ],
  rooms: [{ id: roomId, name: '卧室', label: '复古暖棕卧室', type: 'bedroom', zone: 'private', x: 0, z: 0, width: 3.6, depth: 5.4 }],
  windowSlots: [{ id: 'window_left_1', roomId, edge: 'west', occupied: true, width: 1.25, height: 2.05, position: { x: -1.76, y: 1.28, z: -1.15, rotationY: 1.5707963268 } }],
  finishes: {
    floor: { material: 'light_oak', color: '#C7A77A' },
    wall: { material: 'warm_textured_plaster', color: '#8D5D46' },
    accent_wall: { wall_id: 'wall_right', material: 'fabric_panel', color: '#C3A47F' },
  },
  daylight: 'warm_day',
  placements: [
    placement('plc_bed', 'ast_240c9a5c1586', 'floor', [0.73, 0, 0.22], 1.5707963268, [2.15, 0.85, 1.75]),
    placement('plc_armchair', 'ast_4c747bd203f6', 'floor', [-1.18, 0, -1.12], 0.3490658504, [0.95, 0.85, 0.9]),
    placement('plc_tall_cabinet', 'ast_9f0025ead5db', 'floor', [0, 0, -2.42], 0, [0.65, 1.85, 0.42]),
    placement('plc_rug', 'ast_97844e55748d', 'floor', [0, 0.01, 0.35], 0, [3.2, 0.02, 3.9]),
    placement('plc_coffee_table', 'ast_e6f9788d4101', 'floor', [-0.55, 0, 1.85], 0, [1.05, 0.58, 1.05]),
    placement('plc_ornament_white', 'ast_26d5964ad0ab', 'surface', [-0.77, 0.59, 1.78], -0.1745329252, [0.22, 0.4, 0.22]),
    placement('plc_ornament_color', 'ast_0f84e275ae15', 'surface', [-0.37, 0.59, 1.88], 0.2094395102, [0.24, 0.55, 0.24]),
    placement('plc_plant', 'ast_c3e4fcb6e414', 'surface', [0.02, 1.86, -2.42], 0, [0.4, 0.55, 0.4]),
    placement('plc_ceiling_light', 'ast_2f33e0f44197', 'ceiling', [0, 2.72, -0.25], 0, [1, 0.4, 1]),
    placement('plc_wall_sconce', 'ast_e894f0881c57', 'wall', [1.72, 1.55, -0.25], -1.5707963268, [0.5, 0.75, 0.5]),
    placement('plc_art_large', 'ast_f6439396bdae', 'wall', [-1.76, 1.35, 0.15], 1.5707963268, [0.75, 1.05, 0.03]),
    placement('plc_art_portrait', 'ast_9ed9391bccce', 'wall', [-0.58, 1.55, -2.66], 0, [0.5, 0.65, 0.05]),
  ],
  relationships: [
    ['contained_by', 'plc_bed', roomId], ['contained_by', 'plc_armchair', roomId], ['contained_by', 'plc_tall_cabinet', roomId],
    ['contained_by', 'plc_rug', roomId], ['contained_by', 'plc_coffee_table', roomId], ['attached_to', 'plc_ceiling_light', 'surface_ceiling'],
    ['attached_to', 'plc_wall_sconce', 'wall_right'], ['attached_to', 'plc_art_large', 'wall_left'], ['attached_to', 'plc_art_portrait', 'wall_back'],
    ['supported_by', 'plc_ornament_white', 'plc_coffee_table'], ['supported_by', 'plc_ornament_color', 'plc_coffee_table'],
    ['supported_by', 'plc_plant', 'plc_tall_cabinet'], ['layered_under', 'plc_rug', 'plc_bed'], ['layered_under', 'plc_rug', 'plc_armchair'],
    ['layered_under', 'plc_rug', 'plc_coffee_table'], ['adjacent_to', 'plc_bed', 'wall_right'], ['adjacent_to', 'plc_tall_cabinet', 'wall_back'],
    ['adjacent_to', 'plc_armchair', 'wall_left'], ['faces', 'plc_armchair', 'plc_bed'],
  ].map(([type, subject, object]) => ({ type, subject, object })),
};
