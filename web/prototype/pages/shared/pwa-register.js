if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['127.0.0.1', 'localhost'].includes(location.hostname))) {
  window.addEventListener('load', () => {
    const workerUrl = new URL('../../service-worker.js', import.meta.url);
    const scope = new URL('../../', import.meta.url).pathname;
    navigator.serviceWorker.register(workerUrl, { scope }).catch(() => {});
  });
}
