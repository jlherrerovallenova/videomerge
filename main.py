import os
import uuid
import time
import shutil
import asyncio
import threading
import subprocess
import webbrowser
from typing import List, Dict, Any, Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import merger

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
OUTPUT_DIR = os.path.join(BASE_DIR, "output")
STATIC_DIR = os.path.join(BASE_DIR, "static")

os.makedirs(UPLOADS_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)

app = FastAPI(title="Video Merger Studio")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# In-memory store for items and jobs
# video_items: { id: { id, original_name, path, thumb_path, info } }
video_items: Dict[str, Dict[str, Any]] = {}
# jobs: { job_id: { id, status, progress, message, output_filename, output_path, result_info, error } }
jobs: Dict[str, Dict[str, Any]] = {}

class MergeRequest(BaseModel):
    video_ids: List[str]
    mode: str = "auto"          # auto, direct, reencode
    compress: bool = False      # true if user requested compression
    preset: str = "balanced"    # lossless, high, balanced, compact
    codec: str = "h264"         # h264, hevc
    target_res: str = "auto"    # auto, 1080p, 720p
    output_name: Optional[str] = None

@app.get("/", response_class=HTMLResponse)
async def get_index():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse("<h1>Video Merger Studio</h1><p>Archivo index.html no encontrado.</p>")

@app.post("/api/upload")
async def upload_videos(files: List[UploadFile] = File(...)):
    """Upload one or multiple video files, extract metadata and generate thumbnails."""
    added_items = []
    
    for upload in files:
        if not upload.filename:
            continue
            
        ext = os.path.splitext(upload.filename)[1].lower()
        valid_exts = [".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".ts", ".flv", ".wmv"]
        if ext not in valid_exts:
            # Skip invalid video files
            continue

        item_id = str(uuid.uuid4())[:8]
        safe_name = f"{item_id}_{upload.filename}"
        file_path = os.path.join(UPLOADS_DIR, safe_name)
        thumb_path = os.path.join(UPLOADS_DIR, f"{item_id}_thumb.jpg")

        # Save uploaded file
        with open(file_path, "wb") as f:
            shutil.copyfileobj(upload.file, f)

        # Extract metadata
        info = merger.get_video_info(file_path)

        # Generate thumbnail
        merger.generate_thumbnail(file_path, thumb_path, timestamp=1.0)

        item = {
            "id": item_id,
            "original_name": upload.filename,
            "file_name": safe_name,
            "file_path": file_path,
            "thumb_url": f"/api/thumbnail/{item_id}",
            "stream_url": f"/api/stream/{item_id}",
            "info": info
        }
        video_items[item_id] = item
        added_items.append(item)

    return JSONResponse({"success": True, "items": added_items})

@app.get("/api/thumbnail/{item_id}")
async def get_thumbnail(item_id: str):
    thumb_path = os.path.join(UPLOADS_DIR, f"{item_id}_thumb.jpg")
    if os.path.exists(thumb_path):
        return FileResponse(thumb_path, media_type="image/jpeg")
    raise HTTPException(status_code=404, detail="Thumbnail no encontrado")

@app.get("/api/stream/{item_id}")
async def stream_video(item_id: str):
    """Serve video for in-browser playback."""
    if item_id not in video_items:
        raise HTTPException(status_code=404, detail="Video no encontrado")
    file_path = video_items[item_id]["file_path"]
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    return FileResponse(file_path, media_type="video/mp4")

@app.delete("/api/items/{item_id}")
async def delete_item(item_id: str):
    if item_id in video_items:
        item = video_items.pop(item_id)
        for p in [item.get("file_path"), os.path.join(UPLOADS_DIR, f"{item_id}_thumb.jpg")]:
            if p and os.path.exists(p):
                try:
                    os.remove(p)
                except Exception:
                    pass
        return {"success": True}
    return {"success": False, "error": "Item not found"}

@app.post("/api/clear")
async def clear_all():
    global video_items
    for item_id, item in list(video_items.items()):
        for p in [item.get("file_path"), os.path.join(UPLOADS_DIR, f"{item_id}_thumb.jpg")]:
            if p and os.path.exists(p):
                try:
                    os.remove(p)
                except Exception:
                    pass
    video_items.clear()
    return {"success": True}

def run_merge_job(job_id: str, req: MergeRequest):
    """Background worker for video concatenation."""
    job = jobs[job_id]
    try:
        def update_progress(pct: float, msg: str):
            job["progress"] = pct
            job["message"] = msg

        # Collect video files in the specified order
        ordered_infos = []
        ordered_paths = []
        for vid in req.video_ids:
            if vid in video_items:
                item = video_items[vid]
                ordered_infos.append(item["info"])
                ordered_paths.append(item["file_path"])

        if len(ordered_paths) < 2:
            job["status"] = "failed"
            job["error"] = "Se necesitan al menos 2 videos para unir."
            return

        # Prepare output filename
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        if req.output_name and req.output_name.strip():
            base_name = req.output_name.strip()
            if not base_name.lower().endswith(".mp4"):
                base_name += ".mp4"
            out_filename = base_name
        else:
            out_filename = f"video_unido_{timestamp}.mp4"

        output_path = os.path.join(OUTPUT_DIR, out_filename)
        job["output_filename"] = out_filename
        job["output_path"] = output_path
        job["output_url"] = f"/api/download/{out_filename}"
        job["stream_url"] = f"/api/preview-result/{out_filename}"

        # Decide whether to direct copy or re-encode
        use_direct = False
        if req.mode == "direct":
            use_direct = True
        elif req.mode == "auto":
            # If user didn't ask to compress, and clips are strictly compatible, use direct copy!
            if not req.compress and req.target_res == "auto" and merger.can_direct_copy(ordered_infos):
                use_direct = True

        success = False
        if use_direct:
            update_progress(10.0, "Uniendo videos al instante sin pérdida (Copia directa)...")
            success = merger.merge_videos_stream_copy(
                ordered_paths,
                output_path,
                progress_callback=update_progress
            )
            
            # Validate output if direct copy succeeded
            if success and os.path.exists(output_path):
                check_info = merger.get_video_info(output_path)
                total_exp_dur = sum(v.get("duration", 0) for v in ordered_infos)
                # If output duration is significantly truncated, direct copy failed silently
                if total_exp_dur > 2.0 and check_info.get("duration", 0) < total_exp_dur * 0.75:
                    print("Direct copy output was truncated. Falling back to re-encoding...")
                    success = False

            # If direct copy failed or produced invalid file, fallback to re-encode automatically
            if not success:
                update_progress(20.0, "Ajustando y sincronizando pistas para garantizar 100% compatibilidad...")
                success = merger.merge_videos_reencode(
                    ordered_infos,
                    output_path,
                    quality_preset="lossless" if not req.compress else req.preset,
                    codec=req.codec,
                    target_res=req.target_res,
                    progress_callback=update_progress
                )
        else:
            preset = req.preset if req.compress else "lossless"
            update_progress(10.0, f"Optimizando y uniendo {len(ordered_paths)} videos...")
            success = merger.merge_videos_reencode(
                ordered_infos,
                output_path,
                quality_preset=preset,
                codec=req.codec,
                target_res=req.target_res,
                progress_callback=update_progress
            )

        if success and os.path.exists(output_path) and os.path.getsize(output_path) > 1024:
            result_info = merger.get_video_info(output_path)
            job["status"] = "completed"
            job["progress"] = 100.0
            job["message"] = "¡Video unido exitosamente!"
            job["result_info"] = result_info
        else:
            job["status"] = "failed"
            job["error"] = "Error al procesar la unión de videos. Por favor revisa los formatos de entrada."

    except Exception as e:
        job["status"] = "failed"
        job["error"] = str(e)

@app.get("/api/backend-info")
async def backend_info():
    """Diagnostic endpoint to confirm Python FastAPI backend is online."""
    return {"status": "ok", "engine": "python-native", "ffmpeg": True}

@app.post("/api/merge")
async def start_merge(req: MergeRequest, background_tasks: BackgroundTasks):
    if len(req.video_ids) < 2:
        raise HTTPException(status_code=400, detail="Debes seleccionar al menos 2 videos para unir.")

    job_id = str(uuid.uuid4())[:8]
    jobs[job_id] = {
        "id": job_id,
        "status": "processing",
        "progress": 0.0,
        "message": "Iniciando proceso...",
        "output_filename": None,
        "output_path": None,
        "output_url": None,
        "stream_url": None,
        "result_info": None,
        "error": None
    }

    background_tasks.add_task(run_merge_job, job_id, req)
    return {"job_id": job_id}

@app.get("/api/job/{job_id}")
async def get_job_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Trabajo no encontrado")
    return jobs[job_id]

@app.get("/api/download/{filename}")
async def download_output(filename: str):
    if not filename.lower().endswith(".mp4"):
        filename += ".mp4"
    file_path = os.path.join(OUTPUT_DIR, filename)
    if os.path.exists(file_path):
        return FileResponse(
            file_path,
            filename=filename,
            media_type="video/mp4",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
    raise HTTPException(status_code=404, detail="Archivo no encontrado")

@app.get("/api/preview-result/{filename}")
async def preview_output(filename: str):
    file_path = os.path.join(OUTPUT_DIR, filename)
    if os.path.exists(file_path):
        return FileResponse(file_path, media_type="video/mp4")
    raise HTTPException(status_code=404, detail="Archivo no encontrado")

@app.post("/api/open-folder")
async def open_output_folder():
    """Open output folder in Windows Explorer."""
    try:
        subprocess.run(["explorer.exe", OUTPUT_DIR])
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}

def open_browser():
    time.sleep(1.2)
    webbrowser.open("http://127.0.0.1:8000")

if __name__ == "__main__":
    import uvicorn
    # Open browser automatically on launch
    threading.Thread(target=open_browser, daemon=True).start()
    print("Iniciando Video Merger Studio en http://127.0.0.1:8000 ...")
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)
