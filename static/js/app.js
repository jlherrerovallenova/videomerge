// Video Merger Studio - Smart Hybrid Engine (Native Python + WebAssembly Fallback)
// Optimized for zero-error video merging, audio-video synchronization, and maximum performance.

(function () {
  const API_BASE = (window.location.protocol === "file:" ? "http://127.0.0.1:8000" : "");
  let items = []; // Array of video items { id, serverId, file, name, size, sizeFormatted, duration, durationFormatted, width, height, resolution, thumbUrl, streamUrl }
  let sortableInstance = null;
  let isServerMode = false;
  let isMerging = false;

  // FFmpeg WebAssembly state (for offline/standalone fallback)
  let ffmpegWasm = null;
  let isFFmpegLoading = false;

  // DOM Elements
  const engineBadge = document.getElementById("engineBadge");
  const backendBanner = document.getElementById("backendBanner");
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const videoList = document.getElementById("videoList");
  const emptyState = document.getElementById("emptyState");
  const badgeCount = document.getElementById("badgeCount");

  const btnSortName = document.getElementById("btnSortName");
  const btnReverseOrder = document.getElementById("btnReverseOrder");
  const btnClearAll = document.getElementById("btnClearAll");

  const statVideosCount = document.getElementById("statVideosCount");
  const statDuration = document.getElementById("statDuration");
  const statSize = document.getElementById("statSize");

  const mergeMode = document.getElementById("mergeMode");
  const compressToggle = document.getElementById("compressToggle");
  const presetGroup = document.getElementById("presetGroup");
  const qualityPreset = document.getElementById("qualityPreset");
  const targetRes = document.getElementById("targetRes");
  const outputFilename = document.getElementById("outputFilename");
  const btnStartMerge = document.getElementById("btnStartMerge");

  // Modals
  const progressModal = document.getElementById("progressModal");
  const modalProgressTitle = document.getElementById("modalProgressTitle");
  const progressSubTitle = document.getElementById("progressSubTitle");
  const progressBar = document.getElementById("progressBar");
  const progressPct = document.getElementById("progressPct");
  const progressMessage = document.getElementById("progressMessage");
  const btnCloseProgress = document.getElementById("btnCloseProgress");
  const btnDismissProgressError = document.getElementById("btnDismissProgressError");

  function showProgressError(errorMessage) {
    if (modalProgressTitle) modalProgressTitle.textContent = "Error en la unión";
    if (progressSubTitle) progressSubTitle.textContent = "Error";
    if (progressBar) progressBar.style.backgroundColor = "#ef4444";
    if (progressMessage) {
      progressMessage.textContent = errorMessage;
      progressMessage.style.color = "#f87171";
    }
    if (btnCloseProgress) btnCloseProgress.style.display = "inline-flex";
    if (btnDismissProgressError) btnDismissProgressError.style.display = "block";
  }

  function resetProgressModal() {
    progressModal.classList.remove("active");
    if (progressBar) {
      progressBar.style.backgroundColor = "";
      progressBar.style.width = "0%";
    }
    if (progressPct) progressPct.textContent = "0%";
    if (progressMessage) {
      progressMessage.style.color = "";
      progressMessage.textContent = "Iniciando proceso...";
    }
    if (btnCloseProgress) btnCloseProgress.style.display = "none";
    if (btnDismissProgressError) btnDismissProgressError.style.display = "none";
  }

  if (btnCloseProgress) btnCloseProgress.addEventListener("click", resetProgressModal);
  if (btnDismissProgressError) btnDismissProgressError.addEventListener("click", resetProgressModal);

  function updateMergeButtonState() {
    if (isMerging) {
      btnStartMerge.disabled = true;
      btnStartMerge.classList.add("btn-disabled");
    } else {
      btnStartMerge.disabled = false;
      if (items.length < 2) {
        btnStartMerge.classList.add("btn-disabled");
      } else {
        btnStartMerge.classList.remove("btn-disabled");
      }
    }
  }

  const resultModal = document.getElementById("resultModal");
  const resultVideoPlayer = document.getElementById("resultVideoPlayer");
  const resDuration = document.getElementById("resDuration");
  const resResolution = document.getElementById("resResolution");
  const resSize = document.getElementById("resSize");
  const btnDownloadResult = document.getElementById("btnDownloadResult");
  const btnShareResult = document.getElementById("btnShareResult");
  const btnOpenFolder = document.getElementById("btnOpenFolder");
  const btnCloseResult = document.getElementById("btnCloseResult");

  const previewModal = document.getElementById("previewModal");
  const previewTitle = document.getElementById("previewTitle");
  const previewVideoPlayer = document.getElementById("previewVideoPlayer");
  const btnClosePreview = document.getElementById("btnClosePreview");

  // Current Result State
  let currentOutputBlob = null;
  let currentOutputUrl = null;
  let currentDownloadName = "video_unido.mp4";

  // Formatting Utilities
  function formatDuration(sec) {
    if (!sec || isNaN(sec) || sec <= 0) return "00:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const h = Math.floor(m / 60);
    const remM = m % 60;
    if (h > 0) {
      return `${h}:${remM < 10 ? '0' : ''}${remM}:${s < 10 ? '0' : ''}${s}`;
    }
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + " " + units[i];
  }

  function sanitizeFilename(name) {
    if (!name || !name.trim()) return "video_unido.mp4";
    let clean = name.trim().replace(/[\\/:*?"<>|]/g, "_");
    clean = clean.replace(/\.(mp4|mov|mkv|avi|webm|m4v|ts|flv|wmv)$/i, "");
    clean = clean.replace(/\.+$/, "");
    if (!clean) clean = "video_unido";
    return clean + ".mp4";
  }

  // Detect Backend Engine
  async function checkBackend() {
    try {
      const res = await fetch(API_BASE + "/api/backend-info", { method: "GET", cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.status === "ok") {
          isServerMode = true;
          if (engineBadge) {
            engineBadge.className = "badge badge-emerald";
            engineBadge.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg> Servidor FFmpeg Activo`;
          }
          if (btnOpenFolder && !/iPad|iPhone|iPod|Android/.test(navigator.userAgent)) {
            btnOpenFolder.style.display = "inline-flex";
          }
          if (backendBanner) {
            backendBanner.style.display = "none";
          }
          console.log("Servidor backend detectado y activo.");
          return true;
        }
      }
    } catch (e) {
      // Backend not available (offline file or server not started)
    }
    isServerMode = false;
    if (engineBadge) {
      engineBadge.className = "badge badge-indigo";
      engineBadge.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg> Motor WebAssembly (En Navegador / iPad)`;
    }
    if (backendBanner) {
      backendBanner.style.display = "none";
    }
    console.log("Ejecutando en modo WebAssembly en navegador.");
    return false;
  }

  // Initialize Drag & Drop sorting with SortableJS
  function initSortable() {
    if (sortableInstance) sortableInstance.destroy();
    sortableInstance = new Sortable(videoList, {
      animation: 200,
      handle: ".drag-handle",
      filter: ".empty-state",
      ghostClass: "sortable-ghost",
      onEnd: () => {
        syncOrderFromDOM();
        updateStats();
        updateOrderBadges();
      }
    });
  }

  // HTML5 Client-Side Metadata & Thumbnail Fallback (Addy Osmani Memory & Performance Optimization)
  function extractVideoMetadata(file) {
    return new Promise((resolve) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;

      const objUrl = URL.createObjectURL(file);
      video.src = objUrl;

      let resolved = false;
      const finish = (meta) => {
        if (!resolved) {
          resolved = true;
          // Release video decode resources immediately to prevent memory leaks
          try {
            video.pause();
            video.removeAttribute("src");
            video.load();
          } catch (e) {}
          resolve(meta);
        }
      };

      video.onloadedmetadata = () => {
        const duration = video.duration || 0;
        video.currentTime = Math.min(1.0, duration > 0 ? duration / 2 : 0.5);
      };

      video.onseeked = () => {
        try {
          const canvas = document.createElement("canvas");
          const w = 320;
          const h = Math.round((video.videoHeight / (video.videoWidth || 1)) * 320) || 180;
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(video, 0, 0, w, h);

          // Use Blob URL instead of heavy base64 to minimize V8 JS heap memory pressure
          canvas.toBlob((blob) => {
            const thumbUrl = blob ? URL.createObjectURL(blob) : "";
            const hasAudio = Boolean(
              video.mozHasAudio ||
              video.webkitAudioDecodedByteCount ||
              (video.audioTracks && video.audioTracks.length > 0)
            );

            finish({
              duration: video.duration || 0,
              width: video.videoWidth || 1920,
              height: video.videoHeight || 1080,
              thumbUrl: thumbUrl,
              objUrl: objUrl,
              hasAudio: hasAudio
            });
          }, "image/jpeg", 0.7);
        } catch (e) {
          finish({
            duration: video.duration || 0,
            width: video.videoWidth || 1920,
            height: video.videoHeight || 1080,
            thumbUrl: "",
            objUrl: objUrl,
            hasAudio: true
          });
        }
      };

      video.onerror = () => {
        finish({
          duration: 0,
          width: 1920,
          height: 1080,
          thumbUrl: "",
          objUrl: objUrl,
          hasAudio: true
        });
      };

      // Timeout fallback
      setTimeout(() => {
        finish({
          duration: video.duration || 0,
          width: video.videoWidth || 1920,
          height: video.videoHeight || 1080,
          thumbUrl: "",
          objUrl: objUrl,
          hasAudio: true
        });
      }, 2500);
    });
  }

  // Upload and File Intake
  dropzone.addEventListener("click", () => fileInput.click());

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("drag-over");
  });

  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("drag-over");
  });

  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag-over");
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  });

  fileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
  });

  async function handleFiles(files) {
    const titleEl = dropzone.querySelector(".upload-text-title");
    const originalText = titleEl.textContent;
    titleEl.textContent = "Procesando y analizando videos...";

    const validFiles = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type.startsWith("video/") || file.name.match(/\.(mp4|mov|mkv|avi|webm|m4v|ts|flv|wmv)$/i)) {
        validFiles.push(file);
      }
    }

    if (validFiles.length === 0) {
      titleEl.textContent = originalText;
      return;
    }

    if (!isServerMode) {
      await checkBackend();
    }

    if (isServerMode) {
      // Upload to Python backend
      const formData = new FormData();
      for (const file of validFiles) {
        formData.append("files", file);
      }

      try {
        const res = await fetch(API_BASE + "/api/upload", {
          method: "POST",
          body: formData
        });
        const data = await res.json();
        if (data.success && data.items) {
          for (let idx = 0; idx < data.items.length; idx++) {
            const srvItem = data.items[idx];
            const originalFile = validFiles[idx] || null;
            const item = {
              id: "v_" + Math.random().toString(36).substring(2, 9),
              serverId: srvItem.id,
              file: originalFile,
              name: srvItem.original_name,
              size: srvItem.info.file_size || 0,
              sizeFormatted: srvItem.info.file_size_formatted || "0 B",
              duration: srvItem.info.duration || 0,
              durationFormatted: srvItem.info.duration_formatted || "00:00",
              width: srvItem.info.width || 0,
              height: srvItem.info.height || 0,
              resolution: srvItem.info.resolution || "HD",
              thumbUrl: API_BASE + srvItem.thumb_url,
              streamUrl: API_BASE + srvItem.stream_url,
              hasAudio: srvItem.info.has_audio
            };
            items.push(item);
          }
        }
      } catch (err) {
        console.warn("Fallo en subida a backend, usando procesamiento local:", err);
        // Fallback to local intake
        for (const file of validFiles) {
          const meta = await extractVideoMetadata(file);
          items.push({
            id: "v_" + Math.random().toString(36).substring(2, 9),
            serverId: null,
            file: file,
            name: file.name,
            size: file.size,
            sizeFormatted: formatBytes(file.size),
            duration: meta.duration,
            durationFormatted: formatDuration(meta.duration),
            width: meta.width,
            height: meta.height,
            resolution: `${meta.width}x${meta.height}`,
            thumbUrl: meta.thumbUrl,
            streamUrl: meta.objUrl,
            hasAudio: true
          });
        }
      }
    } else {
      // Browser WebAssembly mode
      for (const file of validFiles) {
        const meta = await extractVideoMetadata(file);
        items.push({
          id: "v_" + Math.random().toString(36).substring(2, 9),
          serverId: null,
          file: file,
          name: file.name,
          size: file.size,
          sizeFormatted: formatBytes(file.size),
          duration: meta.duration,
          durationFormatted: formatDuration(meta.duration),
          width: meta.width,
          height: meta.height,
          resolution: `${meta.width}x${meta.height}`,
          thumbUrl: meta.thumbUrl,
          streamUrl: meta.objUrl,
          hasAudio: true
        });
      }
    }

    titleEl.textContent = originalText;
    fileInput.value = "";
    renderList();
  }

  // Render list
  function renderList() {
    videoList.innerHTML = "";

    if (items.length === 0) {
      videoList.appendChild(emptyState);
      emptyState.style.display = "flex";
    } else {
      emptyState.style.display = "none";

      items.forEach((item, index) => {
        const card = createCard(item, index);
        videoList.appendChild(card);
      });
      initSortable();
    }
    updateMergeButtonState();

    updateStats();
    updateOrderBadges();
  }

  function createCard(item, index) {
    const card = document.createElement("div");
    card.className = "video-card";
    card.dataset.id = item.id;

    card.innerHTML = `
      <div class="drag-handle" title="Arrastra para reordenar">
        <span>⋮⋮</span>
        <span class="order-badge">#${index + 1}</span>
      </div>

      <div class="card-thumbnail-wrapper" title="Ver vista previa">
        <img class="card-thumbnail" src="${item.thumbUrl || ''}" alt="${item.name}">
        <div class="card-duration">${item.durationFormatted}</div>
        <div class="card-play-overlay">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>
        </div>
      </div>

      <div class="card-info">
        <div class="card-name" title="${item.name}">${item.name}</div>
        <div class="card-meta-tags">
          <span class="meta-pill">${item.resolution}</span>
          <span class="meta-pill">${item.sizeFormatted}</span>
          <span class="meta-pill" style="color: #34d399;">Listo</span>
        </div>
      </div>

      <div class="card-actions">
        <button class="btn-icon btn-move-up" title="Mover arriba">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"></polyline></svg>
        </button>
        <button class="btn-icon btn-move-down" title="Mover abajo">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>
        <button class="btn-icon btn-danger btn-delete-card" title="Eliminar de la lista">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    `;

    card.querySelector(".card-thumbnail-wrapper").addEventListener("click", () => {
      openPreview(item);
    });

    card.querySelector(".btn-move-up").addEventListener("click", (e) => {
      e.stopPropagation();
      moveItem(index, -1);
    });

    card.querySelector(".btn-move-down").addEventListener("click", (e) => {
      e.stopPropagation();
      moveItem(index, 1);
    });

    card.querySelector(".btn-delete-card").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (isServerMode && item.serverId) {
        fetch(`${API_BASE}/api/items/${item.serverId}`, { method: "DELETE" }).catch(() => {});
      }
      // Revoke Object URLs to prevent browser memory leaks (Addy Osmani)
      if (item.streamUrl && item.streamUrl.startsWith("blob:")) {
        try { URL.revokeObjectURL(item.streamUrl); } catch (err) {}
      }
      if (item.thumbUrl && item.thumbUrl.startsWith("blob:")) {
        try { URL.revokeObjectURL(item.thumbUrl); } catch (err) {}
      }
      items = items.filter(i => i.id !== item.id);
      renderList();
    });

    return card;
  }

  function moveItem(index, offset) {
    const newIdx = index + offset;
    if (newIdx < 0 || newIdx >= items.length) return;
    const [moved] = items.splice(index, 1);
    items.splice(newIdx, 0, moved);
    renderList();
  }

  function syncOrderFromDOM() {
    const cards = videoList.querySelectorAll(".video-card");
    const ordered = [];
    cards.forEach(card => {
      const found = items.find(i => i.id === card.dataset.id);
      if (found) ordered.push(found);
    });
    items = ordered;
  }

  function updateOrderBadges() {
    const cards = videoList.querySelectorAll(".video-card");
    cards.forEach((card, idx) => {
      const badge = card.querySelector(".order-badge");
      if (badge) badge.textContent = `#${idx + 1}`;
    });
  }

  function updateStats() {
    const count = items.length;
    badgeCount.textContent = `${count} ${count === 1 ? 'video' : 'videos'}`;
    statVideosCount.textContent = count;

    let totalDuration = 0;
    let totalBytes = 0;
    items.forEach(i => {
      totalDuration += i.duration || 0;
      totalBytes += i.size || 0;
    });

    statDuration.textContent = formatDuration(totalDuration);
    statSize.textContent = formatBytes(totalBytes);
    btnStartMerge.disabled = count < 2;
  }

  // Bulk actions
  btnSortName.addEventListener("click", () => {
    items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    renderList();
  });

  btnReverseOrder.addEventListener("click", () => {
    items.reverse();
    renderList();
  });

  btnClearAll.addEventListener("click", () => {
    if (items.length === 0) return;
    if (confirm("¿Deseas vaciar la lista de videos?")) {
      if (isServerMode) {
        fetch(API_BASE + "/api/clear", { method: "POST" }).catch(() => {});
      }
      items.forEach(item => {
        if (item.streamUrl && item.streamUrl.startsWith("blob:")) {
          try { URL.revokeObjectURL(item.streamUrl); } catch (err) {}
        }
        if (item.thumbUrl && item.thumbUrl.startsWith("blob:")) {
          try { URL.revokeObjectURL(item.thumbUrl); } catch (err) {}
        }
      });
      items = [];
      renderList();
    }
  });

  // Settings visibility
  function updateSettingsVisibility() {
    const isCompress = compressToggle.checked;
    const isReencode = mergeMode.value === "reencode";
    presetGroup.style.display = (isCompress || isReencode) ? "flex" : "none";
  }

  compressToggle.addEventListener("change", updateSettingsVisibility);
  mergeMode.addEventListener("change", updateSettingsVisibility);

  // Preview Modal
  function openPreview(item) {
    previewTitle.textContent = item.name;
    previewVideoPlayer.src = item.streamUrl || item.thumbUrl;
    previewModal.classList.add("active");
    previewVideoPlayer.play().catch(() => {});
  }

  function closePreview() {
    previewVideoPlayer.pause();
    previewVideoPlayer.src = "";
    previewModal.classList.remove("active");
  }

  btnClosePreview.addEventListener("click", closePreview);
  previewModal.addEventListener("click", (e) => {
    if (e.target === previewModal) closePreview();
  });

  // Result Modal
  function closeResult() {
    resultVideoPlayer.pause();
    resultVideoPlayer.src = "";
    resultModal.classList.remove("active");
  }

  btnCloseResult.addEventListener("click", closeResult);
  resultModal.addEventListener("click", (e) => {
    if (e.target === resultModal) closeResult();
  });

  // Open Output Folder (Desktop only)
  if (btnOpenFolder) {
    btnOpenFolder.addEventListener("click", async () => {
      try {
        const res = await fetch(API_BASE + "/api/open-folder", { method: "POST" });
        const data = await res.json();
        if (!data.success) {
          alert("No se pudo abrir la carpeta automáticamente: " + (data.error || ""));
        }
      } catch (e) {
        alert("Función disponible únicamente en el equipo donde se ejecuta el servidor.");
      }
    });
  }

  // Reliable Universal Download Trigger
  function triggerDownload(blobOrUrl, filename) {
    const cleanFilename = sanitizeFilename(filename || currentDownloadName || "video_unido.mp4");
    const isBlob = blobOrUrl instanceof Blob;
    const downloadUrl = isBlob ? URL.createObjectURL(blobOrUrl) : blobOrUrl;

    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = cleanFilename;
    a.setAttribute("download", cleanFilename);
    a.rel = "noopener";
    
    a.style.position = "fixed";
    a.style.top = "0";
    a.style.left = "0";
    a.style.width = "1px";
    a.style.height = "1px";
    a.style.opacity = "0.01";
    document.body.appendChild(a);

    try {
      a.click();
    } catch (e) {
      window.open(downloadUrl, "_blank");
    }

    setTimeout(() => {
      if (a.parentNode) document.body.removeChild(a);
      if (isBlob) {
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 30000);
      }
    }, 1000);
  }

  btnDownloadResult.addEventListener("click", (e) => {
    e.preventDefault();
    if (currentOutputUrl) {
      triggerDownload(currentOutputUrl, currentDownloadName);
    } else if (currentOutputBlob) {
      triggerDownload(currentOutputBlob, currentDownloadName);
    } else {
      alert("El video procesado aún no está listo.");
    }
  });

  // Native Share Sheet (Ideal for iPad / Safari to save directly to Photos)
  if (btnShareResult) {
    if (navigator.share) {
      btnShareResult.style.display = "inline-flex";
    }
    btnShareResult.addEventListener("click", async () => {
      try {
        const filename = sanitizeFilename(currentDownloadName || "video_unido.mp4");
        let fileToShare = null;

        if (currentOutputBlob) {
          fileToShare = new File([currentOutputBlob], filename, { type: "video/mp4" });
        } else if (currentOutputUrl) {
          const fetchRes = await fetch(currentOutputUrl);
          const blob = await fetchRes.blob();
          fileToShare = new File([blob], filename, { type: "video/mp4" });
        }

        if (fileToShare && navigator.canShare && navigator.canShare({ files: [fileToShare] })) {
          await navigator.share({
            files: [fileToShare],
            title: filename
          });
        } else if (navigator.share) {
          await navigator.share({
            title: filename,
            url: currentOutputUrl || window.location.href
          });
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          console.warn("Compartir cancelado o no disponible:", err);
        }
      }
    });
  }

  // Read file as Uint8Array helper (for Wasm fallback)
  function readFileAsArray(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result));
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  // WebAssembly Engine Loader - 100% Local Self-Hosted & Robust
  let wasmCore = null;
  let wasmLoading = false;
  let wasmProgressCallback = null;
  let wasmCurrentDuration = 1.0;

  async function getWasmEngine() {
    if (wasmCore) return wasmCore;
    if (wasmLoading) {
      while (wasmLoading) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (wasmCore) return wasmCore;
    }

    wasmLoading = true;
    try {
      if (typeof window.createFFmpegCore === "undefined") {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = new URL("static/js/ffmpeg-core.js", window.location.href).href;
          s.onload = resolve;
          s.onerror = () => reject(new Error("No se pudo cargar ffmpeg-core.js. Verifica que los archivos estáticos existan."));
          document.head.appendChild(s);
        });
      }

      const core = await window.createFFmpegCore({
        locateFile: (path, prefix) => {
          if (path.endsWith("ffmpeg-core.wasm")) {
            return new URL("static/js/ffmpeg-core.wasm", window.location.href).href;
          }
          return prefix + path;
        },
        print: (msg) => {
          console.log("[Wasm FFmpeg]", msg);
        },
        printErr: (msg) => {
          if (wasmProgressCallback && typeof msg === "string") {
            const m = msg.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
            if (m) {
              const sec = parseFloat(m[1]) * 3600 + parseFloat(m[2]) * 60 + parseFloat(m[3]);
              const ratio = Math.min(1.0, Math.max(0.0, sec / (wasmCurrentDuration || 1.0)));
              wasmProgressCallback(ratio);
            }
          }
        }
      });

      wasmCore = {
        core: core,
        FS: core.FS,
        async run(args, duration = 1.0, onProgress = null) {
          wasmCurrentDuration = duration > 0 ? duration : 1.0;
          wasmProgressCallback = onProgress;
          const fullArgs = ["ffmpeg", "-nostdin", "-y", ...args];
          const argc = fullArgs.length;
          const argv = core._malloc((argc + 1) * 4);
          const ptrs = [];
          for (let i = 0; i < argc; i++) {
            const len = core.lengthBytesUTF8(fullArgs[i]) + 1;
            const ptr = core._malloc(len);
            core.stringToUTF8(fullArgs[i], ptr, len);
            core.setValue(argv + i * 4, ptr, 'i32');
            ptrs.push(ptr);
          }
          core.setValue(argv + argc * 4, 0, 'i32');

          try {
            core._main(argc, argv);
          } catch (err) {
            if (err && (err.status === 0 || (err.name === 'ExitStatus' && err.status === 0))) {
              // Status 0: Clean exit
            } else {
              throw err;
            }
          } finally {
            for (const p of ptrs) {
              try { core._free(p); } catch (e) {}
            }
            try { core._free(argv); } catch (e) {}
            wasmProgressCallback = null;
          }
        }
      };

      return wasmCore;
    } catch (err) {
      wasmCore = null;
      throw new Error("No se pudo iniciar el motor WebAssembly en el navegador: " + (err.message || err));
    } finally {
      wasmLoading = false;
    }
  }

  // MAIN MERGE ACTION (Addy Osmani High-Performance Chunked Engine)
  btnStartMerge.addEventListener("click", async () => {
    if (isMerging) return;
    if (items.length < 2) {
      alert("Por favor añade al menos 2 videos a la lista para poder unirlos.");
      return;
    }

    isMerging = true;
    updateMergeButtonState();

    resetProgressModal();
    progressModal.classList.add("active");
    if (progressBar) progressBar.style.width = "5%";
    if (progressPct) progressPct.textContent = "5%";
    if (modalProgressTitle) {
      modalProgressTitle.textContent = isServerMode ? "Procesando videos con FFmpeg Nativo..." : "Procesando en el Navegador (WebAssembly)...";
    }
    if (progressSubTitle) progressSubTitle.textContent = "Procesando";
    if (progressMessage) progressMessage.textContent = "Iniciando proceso de unión...";

    const customName = sanitizeFilename(outputFilename.value);
    currentDownloadName = customName;

    // Refresh backend connectivity to prioritize high-speed Python engine if available
    if (!isServerMode) {
      await checkBackend();
    }

    // PATH 1: NATIVE PYTHON BACKEND (High-Speed & Error-Free)
    if (isServerMode) {
      try {
        // Upload any items that were added while offline
        const unuploaded = items.filter(i => !i.serverId && i.file);
        if (unuploaded.length > 0) {
          if (progressMessage) progressMessage.textContent = `Transfiriendo ${unuploaded.length} archivos al motor nativo...`;
          const formData = new FormData();
          for (const it of unuploaded) {
            formData.append("files", it.file);
          }
          const upRes = await fetch(API_BASE + "/api/upload", { method: "POST", body: formData });
          const upData = await upRes.json();
          if (upData.success && upData.items) {
            for (let idx = 0; idx < upData.items.length; idx++) {
              unuploaded[idx].serverId = upData.items[idx].id;
            }
          }
        }

        const validIds = items.map(i => i.serverId).filter(Boolean);
        if (validIds.length < 2) {
          throw new Error("No se pudieron registrar suficientes videos en el servidor.");
        }

        const payload = {
          video_ids: validIds,
          mode: mergeMode.value,
          compress: compressToggle.checked,
          preset: qualityPreset.value,
          codec: "h264",
          target_res: targetRes.value,
          output_name: customName
        };

        const res = await fetch(API_BASE + "/api/merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || "Error al iniciar trabajo de unión.");
        }

        const { job_id } = await res.json();

        // Poll job status
        let job = null;
        while (true) {
          await new Promise(r => setTimeout(r, 350));
          const jobRes = await fetch(`${API_BASE}/api/job/${job_id}`);
          if (!jobRes.ok) throw new Error("Error consultando estado del proceso.");
          job = await jobRes.json();

          const pct = Math.min(99, Math.max(5, Math.round(job.progress || 0)));
          if (progressBar) progressBar.style.width = `${pct}%`;
          if (progressPct) progressPct.textContent = `${pct}%`;
          if (progressMessage) progressMessage.textContent = job.message || "Procesando...";

          if (job.status === "completed" || job.status === "failed") {
            break;
          }
        }

        if (job.status === "failed") {
          throw new Error(job.error || "El proceso de unión falló en el servidor.");
        }

        // Finished successfully
        if (progressBar) progressBar.style.width = "100%";
        if (progressPct) progressPct.textContent = "100%";
        progressModal.classList.remove("active");

        currentOutputUrl = API_BASE + job.output_url;
        currentOutputBlob = null;

        resultVideoPlayer.src = API_BASE + job.stream_url;
        resDuration.textContent = job.result_info ? job.result_info.duration_formatted : formatDuration(items.reduce((a, b) => a + (b.duration || 0), 0));
        resResolution.textContent = job.result_info ? job.result_info.resolution : "Full HD";
        resSize.textContent = job.result_info ? job.result_info.file_size_formatted : "Optimizado";

        resultModal.classList.add("active");
        resultVideoPlayer.play().catch(() => {});

      } catch (err) {
        console.error("Error en servidor backend:", err);
        showProgressError("Error al unir videos: " + (err.message || err));
        alert("Error al unir videos: " + (err.message || err));
      } finally {
        isMerging = false;
        updateMergeButtonState();
      }
      return;
    }

    // PATH 2: BROWSER WEBASSEMBLY ENGINE (Sequential O(1) Memory Architecture)
    let wasm = null;
    const filesToCleanup = new Set();
    const outputVirtualFile = "output_merged.mp4";

    try {
      if (modalProgressTitle) modalProgressTitle.textContent = "Procesando en el Navegador (WebAssembly)...";
      if (progressMessage) progressMessage.textContent = "Cargando motor de procesamiento WebAssembly...";
      if (progressBar) progressBar.style.width = "5%";
      if (progressPct) progressPct.textContent = "5%";

      wasm = await getWasmEngine();

      const num = items.length;
      const isCompress = compressToggle.checked;
      const mode = mergeMode.value;
      const preset = qualityPreset.value;

      // Determine target resolution
      let targetW = 1280;
      let targetH = 720;
      if (targetRes.value === "1080p") {
        targetW = 1920; targetH = 1080;
      } else if (targetRes.value === "auto") {
        targetW = Math.max(...items.map(i => i.width || 1280));
        targetH = Math.max(...items.map(i => i.height || 720));
        if (targetW % 2 !== 0) targetW += 1;
        if (targetH % 2 !== 0) targetH += 1;
      }

      let crf = "23";
      if (preset === "lossless") crf = "18";
      else if (preset === "high") crf = "21";
      else if (preset === "compact") crf = "28";

      let mergeSucceeded = false;

      // STRATEGY 1: DIRECT STREAM COPY (When mode is direct and clips match)
      if (mode === "direct") {
        try {
          if (progressMessage) progressMessage.textContent = "Intentando unión instantánea sin pérdida (Copia directa)...";
          if (progressBar) progressBar.style.width = "10%";
          if (progressPct) progressPct.textContent = "10%";
          await new Promise(r => setTimeout(r, 20));

          const directNames = [];
          for (let i = 0; i < num; i++) {
            const inName = `direct_in_${i}.mp4`;
            directNames.push(inName);
            const fileData = await readFileAsArray(items[i].file);
            wasm.FS.writeFile(inName, fileData);
            filesToCleanup.add(inName);
          }

          const directList = directNames.map(n => `file '${n}'`).join('\n') + '\n';
          wasm.FS.writeFile('direct_list.txt', new TextEncoder().encode(directList));
          filesToCleanup.add('direct_list.txt');

          await wasm.run([
            '-f', 'concat',
            '-safe', '0',
            '-i', 'direct_list.txt',
            '-c', 'copy',
            '-movflags', '+faststart',
            outputVirtualFile
          ]);
          filesToCleanup.add(outputVirtualFile);

          const checkData = wasm.FS.readFile(outputVirtualFile);
          if (checkData && checkData.length > 2048) {
            mergeSucceeded = true;
          }
        } catch (directErr) {
          console.warn("Copia directa no soportada para estos clips. Pasando a normalización por bloques...", directErr);
          mergeSucceeded = false;
        } finally {
          if (!mergeSucceeded) {
            for (const f of filesToCleanup) {
              try { wasm.FS.unlink(f); } catch (e) {}
            }
            filesToCleanup.clear();
          }
        }
      }

      // STRATEGY 2: ROCK-SOLID CHUNKED NORMALIZATION (100% Guaranteed Compatibility & Audio Sync)
      if (!mergeSucceeded) {
        const chunkNames = [];
        const vf = `scale=w=${targetW}:h=${targetH}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=w=${targetW}:h=${targetH}:x=(ow-iw)/2:y=(oh-ih)/2:color=black,setsar=1,fps=30`;
        const totalWeight = 85.0;
        const chunkWeight = totalWeight / num;

        for (let i = 0; i < num; i++) {
          const item = items[i];
          const ext = (item.name.split('.').pop() || 'mp4').toLowerCase();
          const inVirtual = `chunk_in_${i}.${ext}`;
          const chunkVirtual = `chunk_${i}.ts`;
          chunkNames.push(chunkVirtual);
          filesToCleanup.add(chunkVirtual);

          const basePct = 5 + i * chunkWeight;
          if (progressMessage) progressMessage.textContent = `Optimizando video ${i + 1} de ${num} (${Math.round(basePct)}%)...`;
          if (progressBar) progressBar.style.width = `${Math.round(basePct)}%`;
          if (progressPct) progressPct.textContent = `${Math.round(basePct)}%`;
          await new Promise(r => setTimeout(r, 20));

          // 1. Write current input file into MEMFS
          const fileData = await readFileAsArray(item.file);
          wasm.FS.writeFile(inVirtual, fileData);
          filesToCleanup.add(inVirtual);

          // 2. Transcode chunk to uniform MPEG-TS (ultrafast libx264 + aac 44100Hz stereo)
          const dur = Math.max(0.5, item.duration || 1.0);
          await wasm.run([
            '-i', inVirtual,
            '-vf', vf,
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-crf', crf,
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-ar', '44100',
            '-ac', '2',
            '-f', 'mpegts',
            chunkVirtual
          ], dur, (ratio) => {
            const currentPct = Math.min(90, Math.round(basePct + ratio * chunkWeight));
            if (progressBar) progressBar.style.width = `${currentPct}%`;
            if (progressPct) progressPct.textContent = `${currentPct}%`;
          });

          // 3. Delete raw input file immediately to free memory (O(1) memory footprint)
          try {
            wasm.FS.unlink(inVirtual);
            filesToCleanup.delete(inVirtual);
          } catch (e) {}

          await new Promise(r => setTimeout(r, 20));
        }

        // 4. Assemble all normalized chunks into final MP4 instantly with stream copy
        if (progressMessage) progressMessage.textContent = "Ensamblando video final ultrarrápido... (92%)";
        if (progressBar) progressBar.style.width = "92%";
        if (progressPct) progressPct.textContent = "92%";
        await new Promise(r => setTimeout(r, 20));

        const tsListContent = chunkNames.map(n => `file '${n}'`).join('\n') + '\n';
        wasm.FS.writeFile('chunks_list.txt', new TextEncoder().encode(tsListContent));
        filesToCleanup.add('chunks_list.txt');

        await wasm.run([
          '-f', 'concat',
          '-safe', '0',
          '-i', 'chunks_list.txt',
          '-c', 'copy',
          '-movflags', '+faststart',
          outputVirtualFile
        ]);
        filesToCleanup.add(outputVirtualFile);
      }

      // Read output file
      if (progressMessage) progressMessage.textContent = "Finalizando y preparando descarga...";
      if (progressBar) progressBar.style.width = "96%";
      if (progressPct) progressPct.textContent = "96%";

      const outputData = wasm.FS.readFile(outputVirtualFile);
      if (!outputData || outputData.length < 1024) {
        throw new Error("El archivo resultante no se generó correctamente o está vacío.");
      }

      const safeBuffer = new Uint8Array(outputData.length);
      safeBuffer.set(outputData);
      const outBlob = new Blob([safeBuffer.buffer], { type: "video/mp4" });
      const outUrl = URL.createObjectURL(outBlob);

      currentOutputBlob = outBlob;
      currentOutputUrl = outUrl;

      // Clean up all virtual files from MEMFS
      for (const f of filesToCleanup) {
        try { wasm.FS.unlink(f); } catch (e) {}
      }
      filesToCleanup.clear();

      let totalDuration = items.reduce((acc, curr) => acc + (curr.duration || 0), 0);

      if (progressBar) progressBar.style.width = "100%";
      if (progressPct) progressPct.textContent = "100%";
      progressModal.classList.remove("active");

      resultVideoPlayer.src = outUrl;
      resDuration.textContent = formatDuration(totalDuration);
      resResolution.textContent = `${targetW}x${targetH}`;
      resSize.textContent = formatBytes(outBlob.size);

      resultModal.classList.add("active");
      resultVideoPlayer.play().catch(() => {});

    } catch (err) {
      console.error("Error al unir videos con WebAssembly:", err);
      for (const f of filesToCleanup) {
        try { if (wasm && wasm.FS) wasm.FS.unlink(f); } catch (e) {}
      }
      wasmCore = null; // Reset wasm core on error so next retry creates fresh instance

      showProgressError("Error al unir videos: " + (err.message || err));
      alert("Error al unir videos: " + (err.message || err));
    } finally {
      isMerging = false;
      updateMergeButtonState();
    }
  });

  // Initialize
  checkBackend().then(() => {
    renderList();
    updateSettingsVisibility();
  });
})();
