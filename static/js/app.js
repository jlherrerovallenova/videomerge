// Video Merger Web Studio - 100% Client-Side Web Application
// Powered by WebAssembly (FFmpeg.wasm) & HTML5 Web APIs

(function () {
  let items = []; // { id, file, name, size, sizeFormatted, duration, durationFormatted, width, height, thumbUrl }
  let sortableInstance = null;
  let ffmpeg = null;
  let isFFmpegLoading = false;

  // DOM Elements
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
  const progressBar = document.getElementById("progressBar");
  const progressPct = document.getElementById("progressPct");
  const progressMessage = document.getElementById("progressMessage");

  const resultModal = document.getElementById("resultModal");
  const resultVideoPlayer = document.getElementById("resultVideoPlayer");
  const resDuration = document.getElementById("resDuration");
  const resResolution = document.getElementById("resResolution");
  const resSize = document.getElementById("resSize");
  const btnDownloadResult = document.getElementById("btnDownloadResult");
  const btnCloseResult = document.getElementById("btnCloseResult");

  const previewModal = document.getElementById("previewModal");
  const previewTitle = document.getElementById("previewTitle");
  const previewVideoPlayer = document.getElementById("previewVideoPlayer");
  const btnClosePreview = document.getElementById("btnClosePreview");

  // Utilities
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
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + " " + units[i];
  }

  // Load FFmpeg.wasm client-side engine
  async function getFFmpeg() {
    if (ffmpeg && ffmpeg.isLoaded()) return ffmpeg;

    if (isFFmpegLoading) {
      while (isFFmpegLoading) {
        await new Promise(r => setTimeout(r, 200));
      }
      return ffmpeg;
    }

    isFFmpegLoading = true;
    try {
      const { createFFmpeg } = FFmpeg;

      // Check if SharedArrayBuffer is available in this browser context
      const hasSharedArrayBuffer = typeof SharedArrayBuffer !== "undefined";
      
      // If SharedArrayBuffer is available, use multi-thread core, otherwise use single-thread core-st!
      // core-st does NOT need SharedArrayBuffer, guaranteeing it works on any browser/device!
      const corePath = hasSharedArrayBuffer
        ? "https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js"
        : "https://unpkg.com/@ffmpeg/core-st@0.11.1/dist/ffmpeg-core.js";

      console.log(`Cargando FFmpeg.wasm (${hasSharedArrayBuffer ? 'Multihilo' : 'Monohilo / Single-Thread core-st'})...`);

      ffmpeg = createFFmpeg({
        log: true,
        corePath: corePath
      });

      ffmpeg.setProgress(({ ratio }) => {
        if (ratio >= 0 && ratio <= 1) {
          const pct = Math.min(99, Math.max(5, Math.round(ratio * 100)));
          progressBar.style.width = `${pct}%`;
          progressPct.textContent = `${pct}%`;
        }
      });

      await ffmpeg.load();
      console.log("FFmpeg.wasm cargado con éxito en el navegador!");
      return ffmpeg;
    } catch (err) {
      console.warn("Fallo con primera opción de FFmpeg, intentando monohilo core-st como respaldo seguro...", err);
      try {
        const { createFFmpeg } = FFmpeg;
        ffmpeg = createFFmpeg({
          log: true,
          corePath: "https://unpkg.com/@ffmpeg/core-st@0.11.1/dist/ffmpeg-core.js"
        });
        await ffmpeg.load();
        return ffmpeg;
      } catch (err2) {
        throw new Error("No se pudo cargar el motor WebAssembly de FFmpeg: " + err2.message);
      }
    } finally {
      isFFmpegLoading = false;
    }
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

  // Fast Client-Side Metadata & Thumbnail Extraction using HTML5 Video + Canvas
  function extractVideoMetadata(file) {
    return new Promise((resolve) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;

      const objUrl = URL.createObjectURL(file);
      video.src = objUrl;

      video.onloadedmetadata = () => {
        const duration = video.duration || 0;
        const width = video.videoWidth || 1920;
        const height = video.videoHeight || 1080;

        // Seek to 1s or middle to capture thumbnail
        video.currentTime = Math.min(1.0, duration > 0 ? duration / 2 : 0.5);
      };

      video.onseeked = () => {
        try {
          const canvas = document.createElement("canvas");
          const w = 320;
          const h = Math.round((video.videoHeight / video.videoWidth) * 320) || 180;
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(video, 0, 0, w, h);
          const thumbUrl = canvas.toDataURL("image/jpeg", 0.7);

          resolve({
            duration: video.duration || 0,
            width: video.videoWidth || 0,
            height: video.videoHeight || 0,
            thumbUrl: thumbUrl,
            objUrl: objUrl
          });
        } catch (e) {
          resolve({
            duration: video.duration || 0,
            width: video.videoWidth || 0,
            height: video.videoHeight || 0,
            thumbUrl: "",
            objUrl: objUrl
          });
        }
      };

      video.onerror = () => {
        resolve({
          duration: 0,
          width: 0,
          height: 0,
          thumbUrl: "",
          objUrl: objUrl
        });
      };
    });
  }

  // Upload / Drop handler
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
    titleEl.textContent = "Procesando videos en el navegador...";

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith("video/") && !file.name.match(/\.(mp4|mov|mkv|avi|webm|m4v)$/i)) {
        continue;
      }

      const meta = await extractVideoMetadata(file);
      const item = {
        id: "v_" + Math.random().toString(36).substring(2, 9),
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
        objUrl: meta.objUrl
      };
      items.push(item);
    }

    titleEl.textContent = originalText;
    fileInput.value = "";
    renderList();

    // Pre-warm FFmpeg.wasm in background so user doesn't wait when clicking merge!
    getFFmpeg().catch(() => {});
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

    card.querySelector(".btn-delete-card").addEventListener("click", (e) => {
      e.stopPropagation();
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
    previewVideoPlayer.src = item.objUrl;
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

  // Read file as Uint8Array helper
  function readFileAsArray(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result));
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  // Core Merging Action inside Browser (Client-Side WebAssembly)
  btnStartMerge.addEventListener("click", async () => {
    if (items.length < 2) {
      alert("Por favor añade al menos 2 videos para unir.");
      return;
    }

    progressModal.classList.add("active");
    progressBar.style.width = "5%";
    progressPct.textContent = "5%";
    progressMessage.textContent = "Cargando motor WebAssembly en el navegador...";

    try {
      const ff = await getFFmpeg();
      progressMessage.textContent = "Cargando videos en la memoria del navegador...";
      progressBar.style.width = "15%";
      progressPct.textContent = "15%";

      // Write files to virtual FS
      const inputNames = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const ext = item.name.split('.').pop() || 'mp4';
        const virtualName = `input_${i}.${ext}`;
        inputNames.push(virtualName);

        progressMessage.textContent = `Preparando video ${i + 1} de ${items.length}...`;
        const data = await readFileAsArray(item.file);
        ff.FS('writeFile', virtualName, data);
      }

      const isCompress = compressToggle.checked;
      const mode = mergeMode.value;
      const preset = qualityPreset.value; // lossless (18), balanced (23), compact (28)

      // Try Direct Copy (Lossless Concat Demuxer) first if not compressing
      let useDirect = false;
      if (mode === "direct" || (mode === "auto" && !isCompress)) {
        useDirect = true;
      }

      let success = false;
      const outputVirtualFile = "output_merged.mp4";

      if (useDirect) {
        progressMessage.textContent = "Uniendo videos al instante sin pérdida (Copia directa)...";
        progressBar.style.width = "40%";

        // Write concat list file
        let listContent = "";
        for (const name of inputNames) {
          listContent += `file '${name}'\n`;
        }
        ff.FS('writeFile', 'concat_list.txt', listContent);

        try {
          await ff.run('-f', 'concat', '-safe', '0', '-i', 'concat_list.txt', '-c', 'copy', '-y', outputVirtualFile);
          success = true;
        } catch (e) {
          console.warn("Direct copy failed, falling back to smart re-encode...", e);
          success = false;
        }
      }

      // If direct copy wasn't selected or failed due to different resolutions/codecs
      if (!success) {
        progressMessage.textContent = "Optimizando y uniendo videos con alta calidad...";
        progressBar.style.width = "30%";

        // Determine CRF
        let crf = "23";
        if (preset === "lossless") crf = "18";
        else if (preset === "compact") crf = "28";

        // Build filter_complex
        const num = items.length;
        let filterParts = [];
        let concatInputs = "";

        // Target resolution
        let targetW = 1280;
        let targetH = 720;
        if (targetRes.value === "1080p") {
          targetW = 1920; targetH = 1080;
        } else if (targetRes.value === "auto") {
          // Find max
          targetW = Math.max(...items.map(i => i.width || 1280));
          targetH = Math.max(...items.map(i => i.height || 720));
          if (targetW % 2 !== 0) targetW += 1;
          if (targetH % 2 !== 0) targetH += 1;
        }

        for (let i = 0; i < num; i++) {
          filterParts.push(`[${i}:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30[v${i}]`);
          concatInputs += `[v${i}][${i}:a?]`;
        }
        filterParts.push(`${concatInputs}concat=n=${num}:v=1:a=1[outv][outa]`);

        const ffmpegArgs = [];
        for (const name of inputNames) {
          ffmpegArgs.push('-i', name);
        }

        ffmpegArgs.push(
          '-filter_complex', filterParts.join(';'),
          '-map', '[outv]',
          '-map', '[outa]',
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-crf', crf,
          '-c:a', 'aac',
          '-b:a', '128k',
          '-movflags', '+faststart',
          '-y', outputVirtualFile
        );

        await ff.run(...ffmpegArgs);
      }

      // Read output from WebAssembly Virtual Filesystem
      progressMessage.textContent = "Finalizando y preparando descarga...";
      progressBar.style.width = "95%";

      const outputData = ff.FS('readFile', outputVirtualFile);
      const outBlob = new Blob([outputData.buffer], { type: "video/mp4" });
      const outUrl = URL.createObjectURL(outBlob);

      // Clean virtual FS
      for (const name of inputNames) {
        try { ff.FS('unlink', name); } catch (e) {}
      }
      try { ff.FS('unlink', 'concat_list.txt'); } catch (e) {}
      try { ff.FS('unlink', outputVirtualFile); } catch (e) {}

      // Calculate total original duration
      let totalDuration = items.reduce((acc, curr) => acc + (curr.duration || 0), 0);

      // Setup result
      progressBar.style.width = "100%";
      progressPct.textContent = "100%";
      progressModal.classList.remove("active");

      resultVideoPlayer.src = outUrl;
      const downloadName = (outputFilename.value.trim() || "video_unido.mp4").replace(/\.mp4$/i, '') + ".mp4";
      btnDownloadResult.href = outUrl;
      btnDownloadResult.download = downloadName;

      resDuration.textContent = formatDuration(totalDuration);
      resResolution.textContent = items[0].resolution || "HD";
      resSize.textContent = formatBytes(outBlob.size);

      resultModal.classList.add("active");
      resultVideoPlayer.play().catch(() => {});

    } catch (err) {
      console.error(err);
      progressModal.classList.remove("active");
      alert("Error al unir los videos: " + err.message);
    }
  });

  // Initial
  renderList();
  updateSettingsVisibility();
})();
