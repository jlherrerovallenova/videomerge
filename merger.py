import os
import re
import math
import subprocess
import tempfile
import threading
from typing import Dict, Any, List, Optional, Callable
import imageio_ffmpeg

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

    # Parse fps: "30 fps" or "29.97 fps"
    fps_match = re.search(r"(\d+(?:\.\d+)?)\s*fps", output)
    if fps_match:
        info["fps"] = float(fps_match.group(1))

    # Parse audio stream: Stream #0:1: Audio: aac ...
    a_match = re.search(r"Stream #\d+:\d+(?:\[0x\w+\])?(?:\([a-z]+\))?:\s*Audio:\s*([a-zA-Z0-9_\-]+)", output)
    if a_match:
        info["has_audio"] = True
        info["audio_codec"] = a_match.group(1).lower()

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
            "-vf", "scale=360:-1",
            "-q:v", "3",
            thumb_path
        ]
        res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return res.returncode == 0 and os.path.exists(thumb_path)
    except Exception as e:
        print(f"Error generating thumbnail for {video_path}: {e}")
        return False

def can_direct_copy(video_infos: List[Dict[str, Any]]) -> bool:
    """Check if all video clips can be joined losslessly via stream copy (-c copy)."""
    if len(video_infos) <= 1:
        return True
    
    first = video_infos[0]
    first_vcodec = first.get("video_codec")
    first_w = first.get("width")
    first_h = first.get("height")
    first_acodec = first.get("audio_codec")
    first_has_audio = first.get("has_audio")

    # If first has no video codec, can't copy
    if not first_vcodec or first_vcodec == "desconocido":
        return False

    for item in video_infos[1:]:
        if item.get("video_codec") != first_vcodec:
            return False
        if item.get("width") != first_w or item.get("height") != first_h:
            return False
        if item.get("has_audio") != first_has_audio:
            return False
        if first_has_audio and item.get("audio_codec") != first_acodec:
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
            # Escape path for concat demuxer (must be absolute)
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
            output_path
        ]

        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace")
        
        if progress_callback:
            progress_callback(100.0, "¡Unión completada!")

        return proc.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 0
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
    Merge videos with smart re-encoding, resolution scaling & padding,
    handling missing audio gracefully, and compressing according to user preference.
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
        # Ensure dimensions are even numbers (ffmpeg requirement)
        target_w = max_w if max_w % 2 == 0 else max_w + 1
        target_h = max_h if max_h % 2 == 0 else max_h + 1
        if target_w == 0 or target_h == 0:
            target_w, target_h = 1920, 1080

    # Calculate total duration for progress
    total_duration = sum(v.get("duration", 0) for v in video_infos)
    if total_duration <= 0:
        total_duration = 1.0

    # Compression preset settings
    # CRF: lower = better quality / larger file; higher = smaller file.
    # h264: 18 (visually lossless), 22 (balanced/high), 28 (compact/light)
    # hevc: 20 (visually lossless), 25 (balanced), 30 (compact)
    if codec == "hevc":
        vcodec_param = "libx265"
        crf_map = {"lossless": 18, "high": 21, "balanced": 25, "compact": 30}
        preset_speed = "medium"
    else:
        vcodec_param = "libx264"
        crf_map = {"lossless": 17, "high": 20, "balanced": 23, "compact": 28}
        preset_speed = "medium"

    crf = crf_map.get(quality_preset, 23)

    # Check if any clip has audio
    any_audio = any(v.get("has_audio", False) for v in video_infos)

    # Build FFmpeg command inputs
    cmd = [ffmpeg, "-y"]
    
    # We will pass each video as an input
    for v in video_infos:
        cmd.extend(["-i", v["file_path"]])

    # Build filter_complex string
    # For each input:
    # 1. Scale with aspect ratio maintained, pad with black bars to target_w:target_h, setsar=1
    # 2. Audio: if clip has audio, resample to 44100Hz stereo. If not, generate silent audio stream!
    filter_parts = []
    
    for i, v in enumerate(video_infos):
        # Video filter: scale and pad
        v_label = f"[v{i}]"
        v_filter = (
            f"[{i}:v]scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,"
            f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30{v_label}"
        )
        filter_parts.append(v_filter)

        # Audio filter:
        if any_audio:
            a_label = f"[a{i}]"
            if v.get("has_audio", False):
                a_filter = f"[{i}:a]aformat=sample_rates=44100:channel_layouts=stereo{a_label}"
            else:
                # Generate silence for this clip's duration
                dur = max(0.1, v.get("duration", 1.0))
                a_filter = f"anullsrc=channel_layout=stereo:sample_rate=44100:d={dur}{a_label}"
            filter_parts.append(a_filter)

    # Concat filter
    concat_inputs = ""
    for i in range(num_videos):
        concat_inputs += f"[v{i}]"
        if any_audio:
            concat_inputs += f"[a{i}]"

    a_flag = 1 if any_audio else 0
    concat_filter = f"{concat_inputs}concat=n={num_videos}:v=1:a={a_flag}[outv]"
    if any_audio:
        concat_filter += "[outa]"
    filter_parts.append(concat_filter)

    filter_complex_str = ";".join(filter_parts)

    cmd.extend([
        "-filter_complex", filter_complex_str,
        "-map", "[outv]"
    ])

    if any_audio:
        cmd.extend([
            "-map", "[outa]",
            "-c:a", "aac",
            "-b:a", "192k"
        ])

    cmd.extend([
        "-c:v", vcodec_param,
        "-preset", preset_speed,
        "-crf", str(crf),
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-progress", "pipe:1",
        output_path
    ])

    if progress_callback:
        progress_callback(5.0, "Procesando videos y optimizando calidad...")

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        errors="replace"
    )

    # Read progress from stdout
    total_us = total_duration * 1_000_000

    def monitor_progress():
        if not process.stdout:
            return
        for line in process.stdout:
            line = line.strip()
            if line.startswith("out_time_ms="):
                try:
                    out_us = int(line.split("=")[1])
                    pct = min(98.0, max(5.0, (out_us / total_us) * 95.0))
                    if progress_callback:
                        progress_callback(round(pct, 1), f"Comprimiendo y uniendo videos... ({int(pct)}%)")
                except (ValueError, IndexError):
                    pass

    t = threading.Thread(target=monitor_progress, daemon=True)
    t.start()

    _, stderr_text = process.communicate()
    t.join(timeout=2.0)

    if process.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 0:
        if progress_callback:
            progress_callback(100.0, "¡Video unido y comprimido con éxito!")
        return True
    else:
        print("FFmpeg Error:", stderr_text[-1000:] if stderr_text else "Unknown error")
        return False
