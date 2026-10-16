import os
import re
import math
import time
import subprocess
import tempfile
from typing import Dict, Any, List, Optional, Callable
import imageio_ffmpeg

LAST_ERROR: str = ""

def get_ffmpeg() -> str:
    """Returns absolute path to ffmpeg executable."""
    return imageio_ffmpeg.get_ffmpeg_exe()

def format_duration(seconds: float) -> str:
    """Format seconds into HH:MM:SS or MM:SS."""
    if seconds <= 0:
        return "00:00"
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"

def format_bytes(bytes_count: int) -> str:
    """Format bytes to human readable string (KB, MB, GB)."""
    if bytes_count <= 0:
        return "0 B"
    units = ["B", "KB", "MB", "GB", "TB"]
    i = int(math.floor(math.log(bytes_count, 1024)))
    p = math.pow(1024, i)
    s = round(bytes_count / p, 2)
    return f"{s} {units[i]}"

def get_video_info(file_path: str) -> Dict[str, Any]:
    """Extract metadata from video file using FFmpeg."""
    ffmpeg = get_ffmpeg()
    cmd = [ffmpeg, "-hide_banner", "-i", file_path]
    
    proc = subprocess.run(cmd, stderr=subprocess.PIPE, stdout=subprocess.PIPE, text=True, errors="replace")
    output = proc.stderr

    info: Dict[str, Any] = {
        "file_path": file_path,
        "file_name": os.path.basename(file_path),
        "file_size": os.path.getsize(file_path) if os.path.exists(file_path) else 0,
        "file_size_formatted": format_bytes(os.path.getsize(file_path)) if os.path.exists(file_path) else "0 B",
        "duration": 0.0,
        "duration_formatted": "00:00",
        "width": 0,
        "height": 0,
        "resolution": "Desconocida",
        "fps": 30.0,
        "video_codec": "desconocido",
        "audio_codec": "ninguno",
        "audio_sample_rate": 44100,
        "has_audio": False,
        "has_video": False,
    }

    # Parse duration: "Duration: 00:01:23.45"
    dur_match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", output)
    if dur_match:
        hours = float(dur_match.group(1))
        minutes = float(dur_match.group(2))
        seconds = float(dur_match.group(3))
        total_sec = hours * 3600 + minutes * 60 + seconds
        info["duration"] = round(total_sec, 2)
        info["duration_formatted"] = format_duration(total_sec)

    # Parse video stream: Stream #0:0: Video: h264 (...), yuv420p(...), 1920x1080 [SAR 1:1 DAR 16:9], 30 fps...
    v_match = re.search(r"Stream #\d+:\d+(?:\[0x\w+\])?(?:\([a-z]+\))?:\s*Video:\s*([a-zA-Z0-9_\-]+)", output)
    if v_match:
        info["has_video"] = True
        info["video_codec"] = v_match.group(1).lower()

    # Parse resolution: 1920x1080
    res_match = re.search(r"(\d{2,5})x(\d{2,5})", output)
    if res_match:
        w = int(res_match.group(1))
        h = int(res_match.group(2))
        info["width"] = w
        info["height"] = h
        info["resolution"] = f"{w}x{h}"

    # Parse fps: "30 fps" or "29.97 fps" or "30.00 tbr"
    fps_match = re.search(r"(\d+(?:\.\d+)?)\s*fps", output)
    if fps_match:
        info["fps"] = float(fps_match.group(1))

    # Parse audio stream: Stream #0:1: Audio: aac ...
    a_match = re.search(r"Stream #\d+:\d+(?:\[0x\w+\])?(?:\([a-z]+\))?:\s*Audio:\s*([a-zA-Z0-9_\-]+)(?:,\s*(\d+)\s*Hz)?", output)
    if a_match:
        info["has_audio"] = True
        info["audio_codec"] = a_match.group(1).lower()
        if a_match.group(2):
            info["audio_sample_rate"] = int(a_match.group(2))

    return info

def generate_thumbnail(video_path: str, thumb_path: str, timestamp: float = 1.0) -> bool:
    """Generate thumbnail image at given timestamp."""
    try:
        ffmpeg = get_ffmpeg()
        thumb_dir = os.path.dirname(os.path.abspath(thumb_path))
        if thumb_dir:
            os.makedirs(thumb_dir, exist_ok=True)
        # Check video duration first
        info = get_video_info(video_path)
        dur = info.get("duration", 0)
        if dur > 0 and timestamp >= dur:
            timestamp = max(0.1, dur / 2.0)
            
        cmd = [
            ffmpeg, "-y",
            "-ss", str(timestamp),
            "-i", video_path,
            "-vframes", "1",
            "-vf", "scale=360:-2",
            "-q:v", "3",
            thumb_path
        ]
        res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return res.returncode == 0 and os.path.exists(thumb_path)
    except Exception as e:
        print(f"Error generating thumbnail for {video_path}: {e}")
        return False

def can_direct_copy(video_infos: List[Dict[str, Any]]) -> bool:
    """
    Strictly verify if all video clips have identical stream properties
    and can safely be merged losslessly via stream copy (-c copy).
    """
    if len(video_infos) <= 1:
        return True
    
    first = video_infos[0]
    first_vcodec = first.get("video_codec")
    first_w = first.get("width")
    first_h = first.get("height")
    first_fps = first.get("fps", 30.0)
    first_acodec = first.get("audio_codec")
    first_has_audio = first.get("has_audio")
    first_ar = first.get("audio_sample_rate", 44100)

    # If first has no video codec, can't copy
    if not first_vcodec or first_vcodec == "desconocido":
        return False

    for item in video_infos[1:]:
        if item.get("video_codec") != first_vcodec:
            return False
        if item.get("width") != first_w or item.get("height") != first_h:
            return False
        if abs(item.get("fps", 30.0) - first_fps) > 0.5:
            return False
        if item.get("has_audio") != first_has_audio:
            return False
        if first_has_audio:
            if item.get("audio_codec") != first_acodec:
                return False
            if item.get("audio_sample_rate") != first_ar:
                return False

    return True

def merge_videos_stream_copy(
    video_paths: List[str],
    output_path: str,
    progress_callback: Optional[Callable[[float, str], None]] = None
) -> bool:
    """Merge videos instantly using FFmpeg concat demuxer without re-encoding (Lossless)."""
    ffmpeg = get_ffmpeg()
    out_dir = os.path.dirname(os.path.abspath(output_path))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    # Create temporary concat list file
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8") as f:
        list_file = f.name
        for p in video_paths:
            abs_p = os.path.abspath(p).replace("\\", "/").replace("'", "'\\''")
            f.write(f"file '{abs_p}'\n")

    try:
        if progress_callback:
            progress_callback(10.0, "Iniciando unión ultrarrápida sin pérdida...")

        cmd = [
            ffmpeg, "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", list_file,
            "-c", "copy",
            "-avoid_negative_ts", "make_zero",
            "-fflags", "+genpts",
            output_path
        ]

        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace")
        
        # Verify output exists and is not empty
        if proc.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 1024:
            if progress_callback:
                progress_callback(100.0, "¡Unión completada!")
            return True
        global LAST_ERROR
        LAST_ERROR = f"Error en copia directa: {proc.stderr[-300:] if proc.stderr else 'código ' + str(proc.returncode)}"
        return False
    finally:
        if os.path.exists(list_file):
            try:
                os.remove(list_file)
            except Exception:
                pass

def merge_videos_reencode(
    video_infos: List[Dict[str, Any]],
    output_path: str,
    quality_preset: str = "balanced", # lossless, high, balanced, compact
    codec: str = "h264",              # h264, hevc
    target_res: str = "auto",         # auto, 1080p, 720p
    progress_callback: Optional[Callable[[float, str], None]] = None
) -> bool:
    """
    Merge videos with rock-solid re-encoding, resolution scaling & padding,
    guaranteed audio track synchronization & normalization, and CRF compression.
    """
    ffmpeg = get_ffmpeg()
    out_dir = os.path.dirname(os.path.abspath(output_path))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    num_videos = len(video_infos)

    if num_videos == 0:
        return False

    # Determine target resolution
    if target_res == "1080p":
        target_w, target_h = 1920, 1080
    elif target_res == "720p":
        target_w, target_h = 1280, 720
    else:
        # Auto: find the maximum resolution among all clips, or default 1920x1080
        max_w = max((v.get("width", 0) for v in video_infos), default=1920)
        max_h = max((v.get("height", 0) for v in video_infos), default=1080)
        # Ensure dimensions are strictly even numbers
        target_w = max_w if max_w > 0 else 1920
        target_h = max_h if max_h > 0 else 1080
        if target_w % 2 != 0:
            target_w += 1
        if target_h % 2 != 0:
            target_h += 1

    # Calculate total duration for progress
    total_duration = sum(v.get("duration", 0) for v in video_infos)
    if total_duration <= 0:
        total_duration = 1.0

    # Compression preset settings
    if codec == "hevc":
        vcodec_param = "libx265"
        crf_map = {"lossless": 18, "high": 21, "balanced": 25, "compact": 30}
        preset_speed = "veryfast"
        chunk_ext = ".mp4"
    else:
        vcodec_param = "libx264"
        crf_map = {"lossless": 17, "high": 20, "balanced": 23, "compact": 28}
        preset_speed = "veryfast"
        chunk_ext = ".mp4"

    crf = crf_map.get(quality_preset, 23)

    temp_dir = tempfile.mkdtemp(prefix="vmerge_chunks_")
    chunk_paths = []

    try:
        if progress_callback:
            progress_callback(5.0, f"Iniciando optimización por bloques de {num_videos} videos...")

        # Step 1: Normalize each clip individually with real-time continuous progress
        vf = (
            f"scale=w={target_w}:h={target_h}:force_original_aspect_ratio=decrease:force_divisible_by=2,"
            f"pad=w={target_w}:h={target_h}:x=(ow-iw)/2:y=(oh-ih)/2:color=black,"
            f"setsar=1,fps=30"
        )

        for i, v in enumerate(video_infos):
            chunk_file = os.path.join(temp_dir, f"chunk_{i:04d}{chunk_ext}")
            chunk_paths.append(chunk_file)

            dur = max(0.5, float(v.get("duration", 1.0)))
            total_us = dur * 1_000_000

            base_pct = 5.0 + (i / num_videos) * 85.0
            clip_weight = 85.0 / num_videos

            cmd = [ffmpeg, "-y", "-i", v["file_path"]]

            if v.get("has_audio", False):
                cmd.extend([
                    "-map", "0:v:0",
                    "-map", "0:a:0",
                    "-sn", "-dn",
                    "-vf", vf,
                    "-c:v", vcodec_param,
                    "-preset", preset_speed,
                    "-crf", str(crf),
                    "-pix_fmt", "yuv420p",
                    "-c:a", "aac",
                    "-b:a", "192k",
                    "-ar", "44100",
                    "-ac", "2",
                    "-avoid_negative_ts", "make_zero",
                    "-fflags", "+genpts",
                    "-progress", "pipe:1",
                    chunk_file
                ])
            else:
                cmd.extend([
                    "-f", "lavfi", "-i", f"anullsrc=channel_layout=stereo:sample_rate=44100:d={dur}",
                    "-map", "0:v:0",
                    "-map", "1:a:0",
                    "-sn", "-dn",
                    "-vf", vf,
                    "-c:v", vcodec_param,
                    "-preset", preset_speed,
                    "-crf", str(crf),
                    "-pix_fmt", "yuv420p",
                    "-c:a", "aac",
                    "-b:a", "192k",
                    "-ar", "44100",
                    "-ac", "2",
                    "-shortest",
                    "-avoid_negative_ts", "make_zero",
                    "-fflags", "+genpts",
                    "-progress", "pipe:1",
                    chunk_file
                ])

            with tempfile.TemporaryFile() as err_file:
                proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=err_file,
                    text=True,
                    errors="replace",
                    bufsize=1
                )

                # Read real-time progress continuous stream
                last_tick = time.time()
                if proc.stdout:
                    for line in proc.stdout:
                        line_str = line.strip()
                        if line_str.startswith("out_time_us="):
                            try:
                                curr_us = int(line_str.split("=")[1])
                                ratio = min(1.0, max(0.0, curr_us / total_us))
                                curr_pct = base_pct + ratio * clip_weight
                                # Throttle updates to ~4 times per second
                                now = time.time()
                                if now - last_tick > 0.25 and progress_callback:
                                    last_tick = now
                                    progress_callback(
                                        round(curr_pct, 1),
                                        f"Procesando video {i + 1} de {num_videos} ({int(curr_pct)}%)..."
                                    )
                            except Exception:
                                pass

                proc.wait()
                if proc.returncode != 0 or not os.path.exists(chunk_file) or os.path.getsize(chunk_file) < 512:
                    err_file.seek(0)
                    err_out = err_file.read().decode("utf-8", errors="replace")
                    print(f"Error normalizando chunk {i}: {err_out}")
                    global LAST_ERROR
                    LAST_ERROR = f"Error en video {i + 1}: {err_out[-250:] if err_out else 'fallo en FFmpeg'}"
                    return False

        # Step 2: Assemble all normalized chunks instantly with stream copy
        if progress_callback:
            progress_callback(92.0, "Ensamblando video final ultrarrápido...")

        list_file = os.path.join(temp_dir, "chunks_list.txt")
        with open(list_file, "w", encoding="utf-8") as f:
            for cp in chunk_paths:
                clean_p = os.path.abspath(cp).replace("\\", "/").replace("'", "'\\''")
                f.write(f"file '{clean_p}'\n")

        concat_cmd = [
            ffmpeg, "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", list_file,
            "-c", "copy",
            "-movflags", "+faststart",
            output_path
        ]

        res = subprocess.run(concat_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, errors="replace")

        if res.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 1024:
            if progress_callback:
                progress_callback(100.0, "¡Video unido y optimizado con éxito!")
            return True
        else:
            print(f"Error concatenando chunks: {res.stderr}")
            LAST_ERROR = f"Error ensamblando video final: {res.stderr[-250:] if res.stderr else 'fallo en FFmpeg'}"
            return False

    finally:
        if os.path.exists(temp_dir):
            try:
                import shutil
                shutil.rmtree(temp_dir, ignore_errors=True)
            except Exception:
                pass


