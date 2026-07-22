import * as THREE from "./vendor/three.module.js";

const API_BASE = new URLSearchParams(location.search).get("api") || location.origin;

const PRESETS = [
  { id: "preset-sofa", name: "绿色绒面沙发", kind: "sofa", thumbnail: "./assets/gallery/sofa.jpg", color: "#5f7f52", size: [2.1, .82, .86] },
  { id: "preset-lamp", name: "暖光落地灯", kind: "lamp", thumbnail: "./assets/gallery/lamp.jpg", color: "#b78d45", size: [.52, 1.8, .52] },
  { id: "preset-plant", name: "多肉绿植", kind: "plant", thumbnail: "./assets/gallery/plant.jpg", color: "#6c8f62", size: [.7, .72, .7] },
  { id: "preset-armchair", name: "白色单人椅", kind: "armchair", thumbnail: "./assets/gallery/armchair.jpg", color: "#d8d1c2", size: [.9, .9, .88] },
  { id: "preset-cabinet", name: "藤编收纳柜", kind: "cabinet", thumbnail: "./assets/gallery/cabinet.jpg", color: "#9b7450", size: [1.55, 1.05, .42] },
  { id: "preset-chair", name: "细腿餐椅", kind: "chair", thumbnail: "./assets/gallery/chair.jpg", color: "#604636", size: [.72, .94, .72] }
];

const state = {
  activeTab: "image",
  selectedPreset: 0,
  lastImage: PRESETS[0].thumbnail,
  lastCamera: "",
  library: loadLibrary(),
  selectedRoomId: null,
  generationTimer: null
};

const els = {
  tabs: document.querySelectorAll(".tab"),
  panels: document.querySelectorAll(".panel"),
  statusPill: document.getElementById("statusPill"),
  toast: document.getElementById("toast"),
  imageDrop: document.getElementById("imageDrop"),
  imageInput: document.getElementById("imageInput"),
  imagePreview: document.getElementById("imagePreview"),
  imageTitle: document.getElementById("imageTitle"),
  imageProgress: document.getElementById("imageProgress"),
  promptInput: document.getElementById("promptInput"),
  generateImageBtn: document.getElementById("generateImageBtn"),
  loadPresetBtn: document.getElementById("loadPresetBtn"),
  fullscreenBtn: document.getElementById("fullscreenBtn"),
  cameraInput: document.getElementById("cameraInput"),
  cameraButton: document.getElementById("cameraButton"),
  cameraPreview: document.getElementById("cameraPreview"),
  generateCameraBtn: document.getElementById("generateCameraBtn"),
  sketchCanvas: document.getElementById("sketchCanvas"),
  sketchPrompt: document.getElementById("sketchPrompt"),
  generateSketchBtn: document.getElementById("generateSketchBtn"),
  clearSketchBtn: document.getElementById("clearSketchBtn"),
  seedLibraryBtn: document.getElementById("seedLibraryBtn"),
  libraryGrid: document.getElementById("libraryGrid"),
  roomCanvas: document.getElementById("roomCanvas"),
  roomZoomIn: document.getElementById("roomZoomIn"),
  roomZoomOut: document.getElementById("roomZoomOut"),
  roomRotate: document.getElementById("roomRotate"),
  roomDelete: document.getElementById("roomDelete"),
  voiceBtn: document.getElementById("voiceBtn"),
  voiceText: document.getElementById("voiceText")
};

const room = {
  renderer: null,
  scene: null,
  camera: null,
  group: null,
  raycaster: new THREE.Raycaster(),
  pointer: new THREE.Vector2(),
  drag: null,
  objects: new Map(),
  selected: null,
  target: new THREE.Vector3(0, 0, 0),
  orbit: { theta: Math.PI * .22, phi: .94, radius: 7.8 },
  orbitDrag: null
};

bootstrap();

function bootstrap() {
  if (!state.library.length) {
    state.library = PRESETS.slice(0, 5).map(toLibraryItem);
    saveLibrary();
  }

  wireTabs();
  wireImages();
  wireSketch();
  wireLibrary();
  initRoom();
  renderLibrary();
  showPreset(0);
  registerServiceWorker();
  updateStatus();
}

function wireTabs() {
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => activateTab(tab.dataset.tab));
  });
}

function activateTab(tabName) {
  state.activeTab = tabName;
  els.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === tabName));
  els.panels.forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === tabName));
  if (tabName === "room") {
    syncRoomWithLibrary();
    resizeRoom();
  }
}

function wireImages() {
  els.imageInput.addEventListener("change", () => readFileInput(els.imageInput, setImagePreview));
  els.cameraInput.addEventListener("change", () => readFileInput(els.cameraInput, setCameraPreview));
  els.cameraButton.addEventListener("click", () => els.cameraInput.click());

  ["dragenter", "dragover"].forEach((eventName) => {
    els.imageDrop.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.imageDrop.classList.add("is-dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    els.imageDrop.addEventListener(eventName, () => els.imageDrop.classList.remove("is-dragging"));
  });

  els.imageDrop.addEventListener("drop", (event) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file?.type.startsWith("image/")) {
      readFile(file, setImagePreview);
    }
  });

  window.addEventListener("paste", (event) => {
    const file = [...(event.clipboardData?.files || [])].find((item) => item.type.startsWith("image/"));
    if (file) {
      activateTab("image");
      readFile(file, setImagePreview);
    }
  });

  els.loadPresetBtn.addEventListener("click", () => showPreset((state.selectedPreset + 1) % PRESETS.length));
  els.generateImageBtn.addEventListener("click", () => generateFromImage("image"));
  els.generateCameraBtn.addEventListener("click", () => generateFromImage("camera"));
  els.fullscreenBtn.addEventListener("click", () => document.documentElement.requestFullscreen?.());
}

function readFileInput(input, done) {
  const file = input.files?.[0];
  if (file) readFile(file, done);
}

function readFile(file, done) {
  const reader = new FileReader();
  reader.onload = () => done(String(reader.result));
  reader.readAsDataURL(file);
}

function setImagePreview(src) {
  state.lastImage = src;
  els.imagePreview.src = src;
  els.imageDrop.classList.add("has-image");
  els.imageTitle.textContent = "已捕捉到一件新家具";
}

function setCameraPreview(src) {
  state.lastCamera = src;
  els.cameraPreview.src = src;
  els.cameraPreview.parentElement.classList.add("has-image");
}

function showPreset(index) {
  const preset = PRESETS[index];
  state.selectedPreset = index;
  state.lastImage = preset.thumbnail;
  els.imagePreview.src = preset.thumbnail;
  els.imageDrop.classList.add("has-image");
  els.imageTitle.textContent = preset.name;
  els.promptInput.value = promptForKind(preset.kind);
}

function promptForKind(kind) {
  const prompts = {
    sofa: "绿色绒面沙发，圆润靠背，适合客厅",
    lamp: "暖光落地灯，金属灯架，柔和灯罩",
    plant: "桌面绿植，陶瓷盆，叶片层次清晰",
    armchair: "白色软包单人椅，云朵感，适合阅读角",
    cabinet: "藤编收纳柜，木质框架，浅色居家风",
    chair: "细腿餐椅，木质结构，干净产品摄影"
  };
  return prompts[kind] || "一件干净背景下的单体家具";
}

async function generateFromImage(source) {
  const src = source === "camera" ? state.lastCamera : state.lastImage;
  if (!src) {
    toast("先放一张图片进来");
    return;
  }

  setProgress(0);
  const prompt = source === "camera" ? "现场拍摄家具，生成可摆放 3D 组件" : els.promptInput.value.trim();
  const preset = inferPreset(prompt, src);
  const button = source === "camera" ? els.generateCameraBtn : els.generateImageBtn;
  button.disabled = true;
  button.textContent = "生成中...";

  try {
    await runProgress();
    const backendResult = await tryBackendGeneration(src, prompt, source);
    const item = {
      ...toLibraryItem(preset),
      id: `dh-${Date.now()}`,
      name: nameFromPrompt(prompt, preset.name),
      thumbnail: backendResult?.thumbnailUrl || src,
      modelUrl: backendResult?.modelUrl || "",
      createdAt: Date.now(),
      source
    };
    upsertLibrary(item);
    addRoomObject(item);
    renderLibrary();
    activateTab("room");
    toast(backendResult ? "后端 fal 已生成 GLB 并入库" : "后端未连通，已加入演示组件");
  } catch (error) {
    toast(error.message || "生成失败，请换张图片再试");
  } finally {
    button.disabled = false;
    button.textContent = source === "camera" ? "从照片生成" : "生成 3D 组件";
  }
}

function setProgress(activeIndex) {
  [...els.imageProgress.children].forEach((item, index) => {
    item.classList.toggle("done", index < activeIndex);
    item.classList.toggle("active", index === activeIndex);
  });
}

function runProgress() {
  clearInterval(state.generationTimer);
  return new Promise((resolve) => {
    let step = 0;
    setProgress(step);
    state.generationTimer = setInterval(() => {
      step += 1;
      setProgress(Math.min(step, 3));
      if (step >= 4) {
        clearInterval(state.generationTimer);
        resolve();
      }
    }, 520);
  });
}

async function tryBackendGeneration(imageUrl, prompt, source) {
  try {
    els.statusPill.textContent = "正在压缩照片";
    const imageDataUrl = await imageSourceToDataUrl(imageUrl);
    els.statusPill.textContent = "提交 Fal 队列中";
    const submit = await fetch(`${API_BASE}/api/photo-to-3d`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_data_url: imageDataUrl, prompt })
    });
    if (!submit.ok) {
      const payload = await submit.json().catch(() => ({}));
      throw new Error(payload.error || "提交3D生成失败");
    }
    const job = await submit.json();
    if (!job.job_id) throw new Error("服务端没有返回任务编号");

    for (let i = 0; i < 120; i += 1) {
      await wait(2000);
      const result = await fetch(`${API_BASE}/api/jobs/${job.job_id}`);
      if (!result.ok) throw new Error("读取3D生成状态失败");
      const payload = await result.json();
      if (payload.status === "failed") {
        throw new Error(payload.error || "后端生成失败");
      }
      els.statusPill.textContent = `后端生成 ${payload.progress || 0}%`;
      if (payload.status === "succeeded" && payload.model_url) {
        return {
          modelUrl: payload.model_url,
          thumbnailUrl: payload.thumbnail_url,
          provider: payload.provider
        };
      }
    }
    throw new Error("3D生成超时，请稍后重试");
  } catch (error) {
    throw error;
  } finally {
    updateStatus();
  }
}

async function imageSourceToDataUrl(src) {
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  await image.decode();
  const maxSide = 1024;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.86);
}

async function imageSourceToFile(src, filename) {
  const response = await fetch(src);
  const blob = await response.blob();
  const type = blob.type || "image/jpeg";
  return new File([blob], filename, { type });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inferPreset(prompt, src) {
  const text = prompt.toLowerCase();
  const match = PRESETS.find((preset) => text.includes(preset.kind) || prompt.includes(kindName(preset.kind)));
  if (match) return match;
  if (src === PRESETS[state.selectedPreset].thumbnail) return PRESETS[state.selectedPreset];
  return PRESETS[Math.floor(Math.random() * PRESETS.length)];
}

function nameFromPrompt(prompt, fallback) {
  const clean = prompt.replace(/[，。,.]/g, " ").trim().split(/\s+/).slice(0, 2).join("");
  return clean || fallback;
}

function kindName(kind) {
  return {
    sofa: "沙发",
    lamp: "灯",
    plant: "绿植",
    armchair: "单人椅",
    cabinet: "柜",
    chair: "椅"
  }[kind] || "家具";
}

function wireSketch() {
  const canvas = els.sketchCanvas;
  const ctx = canvas.getContext("2d");
  let drawing = false;

  resetSketch();
  canvas.addEventListener("pointerdown", (event) => {
    drawing = true;
    canvas.setPointerCapture(event.pointerId);
    const point = canvasPoint(event);
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    const point = canvasPoint(event);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  });
  canvas.addEventListener("pointerup", () => {
    drawing = false;
  });

  els.clearSketchBtn.addEventListener("click", resetSketch);
  els.generateSketchBtn.addEventListener("click", async () => {
    await runProgress();
    const item = {
      ...toLibraryItem(PRESETS[3]),
      id: `sketch-${Date.now()}`,
      name: nameFromPrompt(els.sketchPrompt.value, "手绘单人椅"),
      thumbnail: canvas.toDataURL("image/png"),
      source: "sketch",
      createdAt: Date.now()
    };
    upsertLibrary(item);
    addRoomObject(item);
    renderLibrary();
    activateTab("room");
    toast("手绘组件已加入 3D 空间");
  });

  function resetSketch() {
    ctx.fillStyle = "#fffdf8";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#2f352c";
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(180, 290);
    ctx.bezierCurveTo(210, 170, 410, 160, 455, 290);
    ctx.moveTo(225, 300);
    ctx.lineTo(205, 390);
    ctx.moveTo(410, 300);
    ctx.lineTo(440, 390);
  }

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * canvas.width / rect.width,
      y: (event.clientY - rect.top) * canvas.height / rect.height
    };
  }
}

function wireLibrary() {
  els.seedLibraryBtn.addEventListener("click", () => {
    PRESETS.forEach((preset) => upsertLibrary(toLibraryItem(preset)));
    renderLibrary();
    syncRoomWithLibrary();
    toast("预置组件已补齐");
  });
}

function renderLibrary() {
  els.libraryGrid.innerHTML = "";
  state.library.forEach((item) => {
    const card = document.createElement("article");
    card.className = "library-item";
    card.innerHTML = `
      <img src="${item.thumbnail}" alt="${item.name}">
      <div class="library-body">
        <b>${item.name}</b>
        <span class="library-meta">${kindName(item.kind)} · ${item.modelUrl ? "GLB 已就绪" : "本地演示组件"}</span>
        <button class="ghost" type="button">摆进房间</button>
      </div>
    `;
    card.querySelector("button").addEventListener("click", () => {
      addRoomObject(item);
      activateTab("room");
      toast(`${item.name} 已摆进房间`);
    });
    els.libraryGrid.appendChild(card);
  });
}

function loadLibrary() {
  try {
    return JSON.parse(localStorage.getItem("dreamhome-library") || "[]");
  } catch {
    return [];
  }
}

function saveLibrary() {
  localStorage.setItem("dreamhome-library", JSON.stringify(state.library.slice(0, 30)));
}

function upsertLibrary(item) {
  state.library = [item, ...state.library.filter((existing) => existing.id !== item.id)].slice(0, 30);
  saveLibrary();
}

function toLibraryItem(preset) {
  return {
    id: preset.id,
    name: preset.name,
    kind: preset.kind,
    thumbnail: preset.thumbnail,
    color: preset.color,
    size: preset.size,
    modelUrl: "",
    source: "preset",
    createdAt: Date.now()
  };
}

function initRoom() {
  room.renderer = new THREE.WebGLRenderer({ canvas: els.roomCanvas, antialias: true, alpha: true });
  room.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  room.renderer.shadowMap.enabled = true;
  room.scene = new THREE.Scene();
  room.scene.background = new THREE.Color("#e9e4d9");
  room.camera = new THREE.PerspectiveCamera(48, 1, .1, 100);
  room.group = new THREE.Group();
  room.scene.add(room.group);

  const hemi = new THREE.HemisphereLight(0xfffbf1, 0x6b796a, 2.2);
  room.scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(4, 7, 5);
  sun.castShadow = true;
  room.scene.add(sun);

  buildRoomShell();
  wireRoomEvents();
  syncRoomWithLibrary();
  resizeRoom();
  animateRoom();
  window.addEventListener("resize", resizeRoom);
}

function buildRoomShell() {
  const floorShape = new THREE.Shape();
  floorShape.moveTo(-3.2, -2.1);
  floorShape.lineTo(2.7, -2.1);
  floorShape.lineTo(3.2, .8);
  floorShape.lineTo(1.4, 2.2);
  floorShape.lineTo(-3.2, 1.8);
  floorShape.lineTo(-3.2, -2.1);

  const floorGeo = new THREE.ShapeGeometry(floorShape);
  const floor = new THREE.Mesh(
    floorGeo,
    new THREE.MeshStandardMaterial({ color: "#d8c8ae", roughness: .82, side: THREE.DoubleSide })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  room.group.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: "#f5efe4", roughness: .76, side: THREE.FrontSide });
  addWall(0, 1.78, 6.5, 1.9, 0, wallMat);
  addWall(-3.2, -.15, 4.05, 1.9, Math.PI / 2, wallMat);

  const windowFrame = new THREE.Mesh(
    new THREE.BoxGeometry(1.25, .72, .04),
    new THREE.MeshStandardMaterial({ color: "#87a6b6", roughness: .45 })
  );
  windowFrame.position.set(-3.18, 1.12, -.45);
  windowFrame.rotation.y = Math.PI / 2;
  room.group.add(windowFrame);
}

function addWall(x, z, width, height, rotationY, material) {
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  wall.position.set(x, height / 2, z);
  wall.rotation.y = rotationY;
  room.group.add(wall);
}

function syncRoomWithLibrary() {
  if (room.objects.size) return;
  state.library.slice(0, 3).forEach((item, index) => {
    addRoomObject(item, new THREE.Vector3(-1.4 + index * 1.35, 0, -.5 + index * .45));
  });
}

function addRoomObject(item, position) {
  if (!room.scene) return;
  const mesh = makeFurniture(item);
  const id = `${item.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  mesh.userData = { id, item };
  mesh.position.copy(position || randomRoomPosition());
  mesh.traverse((child) => {
    child.castShadow = true;
    child.receiveShadow = true;
    child.userData.id = id;
    child.userData.item = item;
  });
  room.group.add(mesh);
  room.objects.set(id, mesh);
  selectRoomObject(mesh);
}

function makeFurniture(item) {
  const group = new THREE.Group();
  const color = new THREE.Color(item.color || "#8a7a61");
  const mat = new THREE.MeshStandardMaterial({ color, roughness: .68, metalness: .05 });
  const dark = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(.68), roughness: .72 });
  const size = item.size || [1, 1, 1];

  if (item.kind === "sofa") {
    box(group, [size[0], .42, size[2]], [0, .32, 0], mat);
    box(group, [size[0], .78, .22], [0, .62, .32], mat);
    box(group, [.18, .48, size[2]], [-size[0] / 2, .46, 0], mat);
    box(group, [.18, .48, size[2]], [size[0] / 2, .46, 0], mat);
  } else if (item.kind === "lamp") {
    cylinder(group, .04, 1.35, [0, .72, 0], dark);
    cylinder(group, .28, .34, [0, 1.5, 0], mat);
    cylinder(group, .22, .05, [0, .04, 0], dark);
    const bulb = new THREE.PointLight(0xffd79a, 1.5, 2.4);
    bulb.position.set(0, 1.38, 0);
    group.add(bulb);
  } else if (item.kind === "plant") {
    cylinder(group, .28, .36, [0, .18, 0], dark);
    for (let i = 0; i < 9; i += 1) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(.16, 18, 12), mat);
      leaf.scale.set(.7, .28, 1.45);
      leaf.position.set(Math.cos(i) * .22, .5 + (i % 3) * .05, Math.sin(i) * .22);
      leaf.rotation.set(.5, i, .35);
      group.add(leaf);
    }
  } else if (item.kind === "cabinet") {
    box(group, [size[0], size[1], size[2]], [0, size[1] / 2, 0], mat);
    box(group, [.03, size[1] * .82, size[2] + .02], [0, size[1] / 2, 0], dark);
    for (let i = -1; i <= 1; i += 2) cylinder(group, .035, .22, [i * .48, .11, .16], dark);
  } else {
    box(group, [size[0], .18, size[2]], [0, .56, 0], mat);
    box(group, [size[0], .58, .16], [0, .94, .28], mat);
    for (let x of [-.26, .26]) for (let z of [-.24, .24]) cylinder(group, .035, .58, [x, .28, z], dark);
  }

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(.58, .66, 48),
    new THREE.MeshBasicMaterial({ color: "#f0c15a", side: THREE.DoubleSide, transparent: true, opacity: 0 })
  );
  ring.name = "selectionRing";
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = .012;
  group.add(ring);
  return group;
}

function box(group, dims, pos, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...dims), material);
  mesh.position.set(...pos);
  group.add(mesh);
}

function cylinder(group, radius, height, pos, material) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 24), material);
  mesh.position.set(...pos);
  group.add(mesh);
}

function randomRoomPosition() {
  return new THREE.Vector3((Math.random() - .5) * 3.8, 0, (Math.random() - .45) * 2.5);
}

function selectRoomObject(mesh) {
  if (room.selected) {
    const ring = room.selected.getObjectByName("selectionRing");
    if (ring) ring.material.opacity = 0;
  }
  room.selected = mesh;
  state.selectedRoomId = mesh?.userData.id || null;
  if (mesh) {
    const ring = mesh.getObjectByName("selectionRing");
    if (ring) ring.material.opacity = .95;
  }
}

function wireRoomEvents() {
  els.roomCanvas.addEventListener("pointerdown", onRoomPointerDown);
  els.roomCanvas.addEventListener("pointermove", onRoomPointerMove);
  els.roomCanvas.addEventListener("pointerup", onRoomPointerUp);
  els.roomCanvas.addEventListener("pointerleave", onRoomPointerUp);

  els.roomZoomIn.addEventListener("click", () => scaleSelected(1.12));
  els.roomZoomOut.addEventListener("click", () => scaleSelected(.9));
  els.roomRotate.addEventListener("click", () => rotateSelected(Math.PI / 4));
  els.roomDelete.addEventListener("click", deleteSelected);
  els.voiceBtn.addEventListener("click", startVoice);
}

function onRoomPointerDown(event) {
  const hit = pickRoomObject(event);
  if (hit) {
    selectRoomObject(hit);
    room.drag = { id: hit.userData.id };
  } else {
    room.orbitDrag = { x: event.clientX, theta: room.orbit.theta };
  }
}

function onRoomPointerMove(event) {
  if (room.drag && room.selected) {
    const point = floorPoint(event);
    if (point) {
      room.selected.position.x = THREE.MathUtils.clamp(point.x, -2.7, 2.6);
      room.selected.position.z = THREE.MathUtils.clamp(point.z, -1.8, 1.45);
    }
  } else if (room.orbitDrag) {
    room.orbit.theta = room.orbitDrag.theta - (event.clientX - room.orbitDrag.x) * .008;
  }
}

function onRoomPointerUp() {
  room.drag = null;
  room.orbitDrag = null;
}

function pickRoomObject(event) {
  setPointer(event);
  room.raycaster.setFromCamera(room.pointer, room.camera);
  const hits = room.raycaster.intersectObjects([...room.objects.values()], true);
  if (!hits.length) return null;
  let obj = hits[0].object;
  while (obj.parent && !room.objects.has(obj.userData.id)) obj = obj.parent;
  return room.objects.get(obj.userData.id) || null;
}

function floorPoint(event) {
  setPointer(event);
  room.raycaster.setFromCamera(room.pointer, room.camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const point = new THREE.Vector3();
  return room.raycaster.ray.intersectPlane(plane, point);
}

function setPointer(event) {
  const rect = els.roomCanvas.getBoundingClientRect();
  room.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  room.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function scaleSelected(amount) {
  if (!room.selected) return;
  room.selected.scale.multiplyScalar(amount);
}

function rotateSelected(amount) {
  if (!room.selected) return;
  room.selected.rotation.y += amount;
}

function deleteSelected() {
  if (!room.selected) return;
  room.group.remove(room.selected);
  room.objects.delete(room.selected.userData.id);
  selectRoomObject(null);
}

function startVoice() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    els.voiceText.textContent = "这个浏览器暂不支持语音识别，已演示一条命令：沙发右移并旋转";
    applyVoiceCommand("右移 旋转");
    return;
  }
  const recognition = new Recognition();
  recognition.lang = "zh-CN";
  recognition.interimResults = false;
  recognition.onresult = (event) => {
    const text = event.results[0][0].transcript;
    els.voiceText.textContent = text;
    applyVoiceCommand(text);
  };
  recognition.onerror = () => {
    els.voiceText.textContent = "语音服务不可用，试试文字关键词：放大、左移、删除";
  };
  recognition.start();
  els.voiceText.textContent = "正在听...";
}

function applyVoiceCommand(text) {
  if (!room.selected) {
    const first = room.objects.values().next().value;
    if (first) selectRoomObject(first);
  }
  if (!room.selected) return;
  if (/放大|大一点|scale/i.test(text)) scaleSelected(1.15);
  if (/缩小|小一点/i.test(text)) scaleSelected(.88);
  if (/左|窗边/.test(text)) room.selected.position.x -= .35;
  if (/右/.test(text)) room.selected.position.x += .35;
  if (/前|靠近/.test(text)) room.selected.position.z -= .35;
  if (/后|远/.test(text)) room.selected.position.z += .35;
  if (/转|旋转|rotate/i.test(text)) rotateSelected(Math.PI / 4);
  if (/删|移除|delete/i.test(text)) deleteSelected();
}

function resizeRoom() {
  if (!room.renderer) return;
  const width = Math.max(1, els.roomCanvas.clientWidth);
  const height = Math.max(1, els.roomCanvas.clientHeight);
  room.renderer.setSize(width, height, false);
  room.camera.aspect = width / height;
  room.camera.updateProjectionMatrix();
}

function animateRoom() {
  requestAnimationFrame(animateRoom);
  const { theta, phi, radius } = room.orbit;
  room.camera.position.set(
    Math.sin(theta) * Math.cos(phi) * radius,
    Math.sin(phi) * radius,
    Math.cos(theta) * Math.cos(phi) * radius
  );
  room.camera.lookAt(room.target);
  room.renderer.render(room.scene, room.camera);
}

function updateStatus() {
  fetch(`${API_BASE}/api/health`)
    .then((r) => r.ok ? r.json() : null)
    .then((data) => {
      els.statusPill.textContent = data ? `后端：${data.provider}` : "离线预置可演示";
    })
    .catch(() => {
      els.statusPill.textContent = "离线预置可演示";
    });
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove("show"), 2300);
}
