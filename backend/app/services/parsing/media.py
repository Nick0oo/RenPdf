"""Bounded local media decoding. Timeline boundaries come from FFmpeg, not an LLM."""

import json
import math
import os
import shutil
import subprocess
from pathlib import Path

from app.core.config import settings
from app.services.models.contracts import MediaInput, ProviderError
from app.services.storage.local import LocalStorage


def run_media_tool(executable: str, arguments: list[str], timeout: int = 120) -> bytes:
    resolved = shutil.which(executable)
    if not resolved and os.name == "nt" and executable in {"ffmpeg", "ffprobe"}:
        candidate = (
            Path(os.environ.get("LOCALAPPDATA", ""))
            / "Microsoft"
            / "WinGet"
            / "Links"
            / (executable + ".exe")
        )
        if candidate.is_file():
            resolved = str(candidate)
        else:
            packages = (
                Path(os.environ.get("LOCALAPPDATA", ""))
                / "Microsoft"
                / "WinGet"
                / "Packages"
            )
            installed = next(
                packages.glob(f"Gyan.FFmpeg_*/ffmpeg*/bin/{executable}.exe"), None
            )
            if installed:
                resolved = str(installed)
    if not resolved:
        raise ProviderError(
            "MEDIA_RUNTIME_MISSING",
            "Instala FFmpeg y FFprobe para procesar audio y video.",
        )
    try:
        result = subprocess.run(
            [resolved, *arguments],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            timeout=timeout,
            check=False,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    except subprocess.TimeoutExpired:
        raise ProviderError(
            "MEDIA_TIMEOUT", "El archivo excedió el tiempo de conversión permitido."
        ) from None
    if result.returncode:
        raise ProviderError(
            "INVALID_MEDIA", "No se pudo decodificar el archivo de audio o video."
        )
    return result.stdout


def inspect_media(path: Path) -> dict:
    with path.open("rb") as stream:
        header = stream.read(32)
    if not (
        header.startswith((b"ID3", b"fLaC", b"OggS", b"\x1aE\xdf\xa3"))
        or header[:4] == b"RIFF"
        and header[8:12] == b"WAVE"
        or len(header) > 8
        and header[4:8] == b"ftyp"
        or len(header) > 1
        and header[0] == 255
        and header[1] & 224 == 224
    ):
        raise ValueError("UNSUPPORTED_SOURCE_FORMAT")
    output = run_media_tool(
        settings.FFPROBE_PATH,
        [
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-show_entries",
            "format=duration,format_name:stream=codec_type,codec_name:stream_disposition=attached_pic",
            "-of",
            "json",
            str(path),
        ],
        timeout=20,
    )
    try:
        data = json.loads(output)
        declared = data["format"].get("duration")
        if declared is None:
            # Browser MediaRecorder WebM often has no container duration. Measure
            # real packet endpoints locally, bounded by upload size and timeout.
            packets = run_media_tool(
                settings.FFPROBE_PATH,
                [
                    "-v",
                    "error",
                    "-protocol_whitelist",
                    "file,pipe",
                    "-read_intervals",
                    f"%+{settings.MAX_MEDIA_DURATION_SECONDS + 1}",
                    "-show_packets",
                    "-show_entries",
                    "packet=pts_time,duration_time",
                    "-of",
                    "csv=p=0",
                    str(path),
                ],
                timeout=30,
            )
            endpoints = []
            for line in packets.decode().splitlines():
                values = line.split(",")
                if len(values) >= 2 and values[0] != "N/A":
                    endpoints.append(
                        float(values[0])
                        + (float(values[1]) if values[1] != "N/A" else 0)
                    )
            duration = max(endpoints, default=0)
        else:
            duration = float(declared)
        if not math.isfinite(duration) or duration <= 0:
            raise ValueError("INVALID_MEDIA_DURATION")
        if duration > settings.MAX_MEDIA_DURATION_SECONDS:
            raise ValueError("MEDIA_DURATION_LIMIT")
        streams = data.get("streams", [])
        video = any(
            s.get("codec_type") == "video"
            and not s.get("disposition", {}).get("attached_pic")
            for s in streams
        )
        audio = any(s.get("codec_type") == "audio" for s in streams)
        if not audio and not video:
            raise ValueError("EMPTY_MEDIA")
        container = data["format"]["format_name"]
        if not set(container.split(",")) & {
            "mp3",
            "wav",
            "flac",
            "ogg",
            "mov",
            "mp4",
            "m4a",
            "3gp",
            "matroska",
            "webm",
        }:
            raise ValueError("UNSUPPORTED_SOURCE_FORMAT")
        kind = "video" if video else "audio"
        mime = (
            "video/webm"
            if video and "webm" in container
            else "video/mp4"
            if video
            else "audio/wav"
            if "wav" in container
            else "audio/flac"
            if "flac" in container
            else "audio/ogg"
            if "ogg" in container
            else "audio/mp4"
            if "mov" in container
            else "audio/webm"
            if "webm" in container
            else "audio/mpeg"
        )
        return {
            "source_type": kind,
            "mime_type": mime,
            "duration_seconds": duration,
            "has_audio": audio,
            "container": container,
        }
    except KeyError, TypeError, json.JSONDecodeError:
        raise ValueError("INVALID_MEDIA") from None


def playback_key(document_id, source_type: str) -> str:
    return f"media/{document_id}/playback.{'mp4' if source_type == 'video' else 'mp3'}"


def prepare_playback(document) -> None:
    storage = LocalStorage()
    target = storage.path(playback_key(document.id, document.source_type))
    if target.is_file():
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name("preparing" + target.suffix)
    arguments = [
        "-v",
        "error",
        "-nostdin",
        "-y",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        str(storage.path(document.storage_key)),
    ]
    if document.source_type == "video":
        arguments += [
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-vf",
            "scale=640:360:force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "27",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
        ]
    else:
        arguments += [
            "-vn",
            "-c:a",
            "libmp3lame",
            "-ar",
            "24000",
            "-ac",
            "1",
            "-b:a",
            "64k",
        ]
    try:
        run_media_tool(
            settings.FFMPEG_PATH,
            [
                *arguments,
                "-t",
                str(settings.MAX_MEDIA_DURATION_SECONDS + 1),
                "-threads",
                "2",
                str(temporary),
            ],
            timeout=600,
        )
        observed = inspect_media(temporary)["duration_seconds"]
        # Small MP3/AAC encoder padding must not shift the original timeline.
        if (
            not document.duration_seconds
            or abs(observed - document.duration_seconds) > 0.25
        ):
            document.duration_seconds = observed
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)


def segment_key(document_id, version_id, ordinal: int, source_type: str) -> str:
    return f"media/{document_id}/{version_id}/{ordinal:05d}.{'mp4' if source_type == 'video' else 'mp3'}"


def has_audio_signal(key: str) -> bool:
    """Detect only digital silence; quiet real recordings still reach the model."""
    pcm = run_media_tool(
        settings.FFMPEG_PATH,
        [
            "-v",
            "error",
            "-nostdin",
            "-protocol_whitelist",
            "file,pipe",
            "-i",
            str(LocalStorage().path(key)),
            "-t",
            "31",
            "-vn",
            "-ac",
            "1",
            "-ar",
            "8000",
            "-f",
            "s16le",
            "pipe:1",
        ],
        timeout=30,
    )
    return any(pcm)


def extract_segment(
    document, version_id, ordinal: int, start: float, end: float
) -> tuple[str, MediaInput]:
    storage = LocalStorage()
    key = segment_key(document.id, version_id, ordinal, document.source_type)
    target = storage.path(key)
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.is_file():
        arguments = [
            "-v",
            "error",
            "-nostdin",
            "-y",
            "-protocol_whitelist",
            "file,pipe",
            "-ss",
            str(start),
            "-i",
            str(storage.path(playback_key(document.id, document.source_type))),
            "-t",
            str(round(end - start, 6)),
        ]
        if document.source_type == "video":
            arguments += [
                "-map",
                "0:v:0",
                "-map",
                "0:a:0?",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-crf",
                "28",
                "-c:a",
                "aac",
                "-movflags",
                "+faststart",
            ]
        else:
            arguments += [
                "-vn",
                "-ar",
                "24000",
                "-ac",
                "1",
                "-c:a",
                "libmp3lame",
                "-b:a",
                "64k",
            ]
        temporary = target.with_name("preparing" + target.suffix)
        try:
            run_media_tool(
                settings.FFMPEG_PATH, [*arguments, "-threads", "2", str(temporary)]
            )
            if temporary.stat().st_size > 12 * 1024 * 1024:
                raise ProviderError(
                    "MEDIA_SEGMENT_SIZE", "Un segmento excedió el tamaño permitido."
                )
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
    return key, MediaInput(
        data=target.read_bytes(),
        mime_type="video/mp4" if document.source_type == "video" else "audio/mpeg",
    )
