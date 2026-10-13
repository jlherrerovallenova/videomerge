// Video Merger Studio - Smart Hybrid Engine (Native Python + WebAssembly Fallback)
// Optimized for zero-error video merging, audio-video synchronization, and maximum performance.

(function () {
  let items = []; // Array of video items { id, serverId, file, name, size, sizeFormatted, duration, durationFormatted, width, height, resolution, thumbUrl, streamUrl }
  let sortableInstance = null;
  let isServerMode = false;
  let isMerging = false;

  // FFmpeg WebAssembly state (for offline/standalone fallback)
  let ffmpegWasm = null;
  let isFFmpegLoading = false;

  // DOM Elements
  const engineBadge = document.getElementById("engineBadge");
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

  const resultModal = document.getElementById("resultModal");
  const resultVideoPlayer = document.getElementById("resultVideoPlayer");
  const resDuration = document.getElementById("resDuration");
  const resResolution = document.getElementById("resResolution");
  const resSize = document.getElementById("resSize");
  const btnDownloadResult = document.getElementById("btnDownloadResult");
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
      const res = await fetch("/api/backend-info", { method: "GET", cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.status === "ok") {
          isServerMode = true;
          if (engineBadge) {
            engineBadge.className = "badge badge-emerald";
            engineBadge.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg> Motor Nativo FFmpeg 7 (Alta Velocidad)`;
          }
          if (btnOpenFolder) {
            btnOpenFolder.style.display = "inline-flex";
          }
          console.log("Servidor FastAPI y motor FFmpeg nativo detectados y activos.");
          return true;
        }
      }
    } catch (e) {
      // Backend not available (static or offline file)
    }
    isServerMode = false;
    if (engineBadge) {
      engineBadge.className = "badge badge-emerald";
      engineBadge.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg> Motor WebAssembly (En Navegador)`;
    }
    console.log("Ejecutando en modo WebAssembly cliente.");
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

    if (isServerMode) {
      // Upload to Python backend
      const formData = new FormData();
      for (const file of validFiles) {
        formData.append("files", file);
      }

      try {
        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData
        });
        const data = await res.json();
        if (data.success && data.items) {
          for (const srvItem of data.items) {
            const item = {
              id: "v_" + Math.random().toString(36).substring(2, 9),
              serverId: srvItem.id,
              file: null,
              name: srvItem.original_name,
              size: srvItem.info.file_size || 0,
              sizeFormatted: srvItem.info.file_size_formatted || "0 B",
              duration: srvItem.info.duration || 0,
              durationFormatted: srvItem.info.duration_formatted || "00:00",
              width: srvItem.info.width || 0,
              height: srvItem.info.height || 0,
              resolution: srvItem.info.resolution || "HD",
              thumbUrl: srvItem.thumb_url,
              streamUrl: srvItem.stream_url,
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
      btnStartMerge.disabled = true;
    } else {
      emptyState.style.display = "none";
      btnStartMerge.disabled = items.length < 2;

      items.forEach((item, index) => {
        const card = createCard(item, index);
        videoList.appendChild(card);
      });
      initSortable();
    }

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
        fetch(`/api/items/${item.serverId}`, { method: "DELETE" }).catch(() => {});
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
        fetch("/api/clear", { method: "POST" }).catch(() => {});
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

  // Open Windows Output Folder
  if (btnOpenFolder) {
    btnOpenFolder.addEventListener("click", async () => {
      try {
        const res = await fetch("/api/open-folder", { method: "POST" });
        const data = await res.json();
        if (!data.success) {
          alert("No se pudo abrir la carpeta automáticamente: " + (data.error || ""));
        }
      } catch (e) {
        alert("Función disponible al ejecutar con iniciar_app.bat");
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

  // Read file as Uint8Array helper (for Wasm fallback)
  function readFileAsArray(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result));
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  // WebAssembly Engine Loader with Fast Local Fallback & Resilience
  async function getFFmpegWasm(forceReload = false) {
    if (forceReload && ffmpegWasm) {
      try {
        if (typeof ffmpegWasm.exit === "function") ffmpegWasm.exit();
      } catch (e) {}
      ffmpegWasm = null;
    }
    if (ffmpegWasm && ffmpegWasm.isLoaded()) return ffmpegWasm;

    if (isFFmpegLoading) {
      while (isFFmpegLoading) {
        await new Promise(r => setTimeout(r, 200));
      }
      if (ffmpegWasm && ffmpegWasm.isLoaded()) return ffmpegWasm;
    }

    isFFmpegLoading = true;
    try {
      const { createFFmpeg } = FFmpeg;
      const hasSharedArrayBuffer = typeof SharedArrayBuffer !== "undefined";

      let corePath = "";
      if (window.location.protocol.startsWith("http")) {
        corePath = hasSharedArrayBuffer
          ? "/static/js/ffmpeg-core.js"
          : "https://unpkg.com/@ffmpeg/core-st@0.11.1/dist/ffmpeg-core.js";
      } else {
        corePath = hasSharedArrayBuffer
          ? "https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js"
          : "https://unpkg.com/@ffmpeg/core-st@0.11.1/dist/ffmpeg-core.js";
      }

      ffmpegWasm = createFFmpeg({
        log: false,
        corePath: corePath
      });

      ffmpegWasm.setProgress(({ ratio }) => {
        if (ratio >= 0 && ratio <= 1) {
          const pct = Math.min(99, Math.max(5, Math.round(ratio * 100)));
          if (progressBar) progressBar.style.width = `${pct}%`;
          if (progressPct) progressPct.textContent = `${pct}%`;
        }
      });

      await ffmpegWasm.load();
      return ffmpegWasm;
    } catch (err) {
      console.warn("Fallback de ffmpeg-core vía CDN:", err);
      const { createFFmpeg } = FFmpeg;
      ffmpegWasm = createFFmpeg({
        log: false,
        corePath: "https://unpkg.com/@ffmpeg/core-st@0.11.1/dist/ffmpeg-core.js"
      });
      await ffmpegWasm.load();
      return ffmpegWasm;
    } finally {
      isFFmpegLoading = false;
    }
  }

  // MAIN MERGE ACTION (Addy Osmani High-Performance Chunked Engine)
  btnStartMerge.addEventListener("click", async () => {
    if (isMerging) return;
    if (items.length < 2) {
      alert("Por favor añade al menos 2 videos para unir.");
      return;
    }

    isMerging = true;
    btnStartMerge.disabled = true;

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

    // PATH 1: NATIVE PYTHON BACKEND (High-Speed & Error-Free)
    if (isServerMode && items.every(i => i.serverId)) {
      try {
        const payload = {
          video_ids: items.map(i => i.serverId),
          mode: mergeMode.value,
          compress: compressToggle.checked,
          preset: qualityPreset.value,
          codec: "h264",
          target_res: targetRes.value,
          output_name: customName
        };

        const res = await fetch("/api/merge", {
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
          await new Promise(r => setTimeout(r, 400));
          const jobRes = await fetch(`/api/job/${job_id}`);
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

        currentOutputUrl = job.output_url;
        currentOutputBlob = null;

        resultVideoPlayer.src = job.stream_url;
        resDuration.textContent = job.result_info ? job.result_info.duration_formatted : formatDuration(items.reduce((a, b) => a + (b.duration || 0), 0));
        resResolution.textContent = job.result_info ? job.result_info.resolution : "Full HD";
        resSize.textContent = job.result_info ? job.result_info.file_size_formatted : "Optimizado";

        resultModal.classList.add("active");
        resultVideoPlayer.play().catch(() => {});

      } catch (err) {
        console.error("Error en servidor backend:", err);
        progressModal.classList.remove("active");
        alert("Error al unir videos: " + (err.message || err));
      } finally {
        isMerging = false;
        btnStartMerge.disabled = items.length < 2;
      }
      return;
    }

    // PATH 2: BROWSER WEBASSEMBLY ENGINE (Addy Osmani High-Performance Chunked Architecture)
    let ff = null;
    const filesToCleanup = new Set();
    const outputVirtualFile = "output_merged.mp4";

    try {
      if (modalProgressTitle) modalProgressTitle.textContent = "Procesando en el Navegador (WebAssembly)...";
      if (progressMessage) progressMessage.textContent = "Cargando motor de procesamiento WebAssembly...";
      if (progressBar) progressBar.style.width = "5%";
      if (progressPct) progressPct.textContent = "5%";

      ff = await getFFmpegWasm();

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

      // STRATEGY 1: FAST-PATH DIRECT STREAM COPY (Addy Osmani: "Fast by default")
      // If user chose direct mode, or auto mode without compression: try instant stream copy
      const tryDirect = (mode === "direct") || (mode === "auto" && !isCompress);
      if (tryDirect) {
        try {
          if (progressMessage) progressMessage.textContent = "Intentando unión instantánea sin pérdida (Copia directa)...";
          if (progressBar) progressBar.style.width = "15%";
          if (progressPct) progressPct.textContent = "15%";
          await new Promise(r => setTimeout(r, 20));

          const directInputNames = [];
          for (let i = 0; i < num; i++) {
            const item = items[i];
            const ext = (item.name.split('.').pop() || 'mp4').toLowerCase();
            const vName = `direct_${i}.${ext}`;
            directInputNames.push(vName);
            filesToCleanup.add(vName);

            const fileData = await readFileAsArray(item.file);
            ff.FS('writeFile', vName, fileData);
          }

          // Build concat demuxer list
          const concatListContent = directInputNames.map(n => `file '${n}'`).join('\n');
          ff.FS('writeFile', 'concat_direct.txt', new TextEncoder().encode(concatListContent));
          filesToCleanup.add('concat_direct.txt');

          await ff.run(
            '-f', 'concat',
            '-safe', '0',
            '-i', 'concat_direct.txt',
            '-c', 'copy',
            '-movflags', '+faststart',
            '-y', outputVirtualFile
          );
          filesToCleanup.add(outputVirtualFile);

          const checkData = ff.FS('readFile', outputVirtualFile);
          if (checkData && checkData.length > 2048) {
            mergeSucceeded = true;
          }
        } catch (directErr) {
          console.warn("Copia directa no compatible con estos videos. Usando optimización por bloques...", directErr);
          mergeSucceeded = false;
        } finally {
          // If direct copy failed, clean up direct inputs before starting chunked pipeline to free memory
          if (!mergeSucceeded) {
            for (const f of filesToCleanup) {
              try { ff.FS('unlink', f); } catch (e) {}
            }
            filesToCleanup.clear();
          }
        }
      }

      // STRATEGY 2: CHUNKED NORMALIZATION PIPELINE (Addy Osmani: Divide & Conquer / O(1) Memory)
      // Normalizes each clip sequentially into a temporary TS chunk.
      // At any given moment, only ONE clip is in memory, preventing WebAssembly OOM and tab freezes!
      if (!mergeSucceeded) {
        const chunkNames = [];
        const vf = `scale=w=${targetW}:h=${targetH}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=w=${targetW}:h=${targetH}:x=(ow-iw)/2:y=(oh-ih)/2:color=black,setsar=1,fps=30`;

        for (let i = 0; i < num; i++) {
          const item = items[i];
          const ext = (item.name.split('.').pop() || 'mp4').toLowerCase();
          const inVirtual = `chunk_in_${i}.${ext}`;
          const chunkVirtual = `chunk_${i}.ts`;
          chunkNames.push(chunkVirtual);
          filesToCleanup.add(chunkVirtual);

          const pct = Math.round(5 + (i / num) * 85);
          if (progressMessage) progressMessage.textContent = `Procesando y normalizando video ${i + 1} de ${num} (${pct}%)...`;
          if (progressBar) progressBar.style.width = `${pct}%`;
          if (progressPct) progressPct.textContent = `${pct}%`;

          // Yield to main thread for smooth DOM updates and responsive UI
          await new Promise(r => setTimeout(r, 25));

          // 1. Write ONLY current clip into MEMFS
          const fileData = await readFileAsArray(item.file);
          ff.FS('writeFile', inVirtual, fileData);
          filesToCleanup.add(inVirtual);

          // 2. Normalize single clip
          const transcodeArgs = [
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
            '-y', chunkVirtual
          ];

          await ff.run(...transcodeArgs);

          // 3. Immediately delete raw input from MEMFS to free linear memory (O(1) footprint)
          try {
            ff.FS('unlink', inVirtual);
            filesToCleanup.delete(inVirtual);
          } catch (e) {}

          // Yield to main thread again
          await new Promise(r => setTimeout(r, 25));
        }

        // 4. Assemble all normalized TS chunks losslessly with stream copy
        if (progressMessage) progressMessage.textContent = "Ensamblando video final ultrarrápido... (92%)";
        if (progressBar) progressBar.style.width = "92%";
        if (progressPct) progressPct.textContent = "92%";
        await new Promise(r => setTimeout(r, 25));

        const tsListContent = chunkNames.map(n => `file '${n}'`).join('\n');
        ff.FS('writeFile', 'chunks_list.txt', new TextEncoder().encode(tsListContent));
        filesToCleanup.add('chunks_list.txt');

        await ff.run(
          '-f', 'concat',
          '-safe', '0',
          '-i', 'chunks_list.txt',
          '-c', 'copy',
          '-movflags', '+faststart',
          '-y', outputVirtualFile
        );
        filesToCleanup.add(outputVirtualFile);
      }

      // Read output file
      if (progressMessage) progressMessage.textContent = "Finalizando y preparando descarga...";
      if (progressBar) progressBar.style.width = "96%";
      if (progressPct) progressPct.textContent = "96%";

      const outputData = ff.FS('readFile', outputVirtualFile);
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
        try { ff.FS('unlink', f); } catch (e) {}
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
      progressModal.classList.remove("active");
      // Clean up virtual files
      for (const f of filesToCleanup) {
        try { if (ff) ff.FS('unlink', f); } catch (e) {}
      }
      await getFFmpegWasm(true); // Reset Wasm instance
      alert("Error al unir videos: " + (err.message || err));
    } finally {
      isMerging = false;
      btnStartMerge.disabled = items.length < 2;
    }
  });

  // Initialize
  checkBackend().then(() => {
    renderList();
    updateSettingsVisibility();
  });
})();
