self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("dreamhome-v2").then((cache) =>
      cache.addAll([
        "./",
        "./index.html",
        "./styles.css",
        "./app.js",
        "./vendor/three.module.js",
        "./assets/gallery/sofa.jpg",
        "./assets/gallery/lamp.jpg",
        "./assets/gallery/plant.jpg",
        "./assets/gallery/armchair.jpg",
        "./assets/gallery/cabinet.jpg"
      ])
    )
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
