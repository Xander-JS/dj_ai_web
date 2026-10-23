"""Inspección y extracción de audio en memoria con yt-dlp + ffmpeg.

El audio nunca se escribe en disco: yt-dlp vuelca la pista de audio a stdout,
ffmpeg la transcodifica a MP3 estéreo desde stdin y su stdout se reenvía al
cliente por fragmentos.
"""

import asyncio
import os
import re
import sys
from collections.abc import AsyncIterator
from dataclasses import dataclass

from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

from app import config


class ExtractionError(Exception):
    """Error recuperable que se devuelve al cliente como 4xx/5xx."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True)
class VideoInfo:
    url: str
    title: str
    duration: int


_INSPECT_OPTIONS = {
    "quiet": True,
    "no_warnings": True,
    "noplaylist": True,
    "skip_download": True,
    "format": "bestaudio/best",
}


def inspect_video(url: str) -> VideoInfo:
    """Obtiene metadatos sin descargar nada y aplica el límite de duración."""
    try:
        with YoutubeDL(_INSPECT_OPTIONS) as ydl:
            info = ydl.extract_info(url, download=False)
    except DownloadError as error:
        raise ExtractionError(f"No se pudo leer el video: {error.msg or error}") from error

    if not info or info.get("_type") == "playlist":
        raise ExtractionError("La URL debe apuntar a un único video, no a una lista.")
    if info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming"):
        raise ExtractionError("No se admiten transmisiones en vivo.")

    duration = info.get("duration")
    if not duration:
        raise ExtractionError("No se pudo determinar la duración del video.")
    if duration > config.MAX_DURATION_SECONDS:
        raise ExtractionError(
            f"El video dura {int(duration)} s y supera el límite de "
            f"{config.MAX_DURATION_SECONDS} s (10 minutos)."
        )

    return VideoInfo(
        url=info.get("webpage_url") or url,
        title=info.get("title") or "audio",
        duration=int(duration),
    )


def safe_filename(title: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|\r\n]+', " ", title).strip()
    return (cleaned or "audio")[:120] + ".mp3"


async def _terminate(process: asyncio.subprocess.Process) -> None:
    if process.returncode is None:
        process.kill()
    await process.wait()


async def open_audio_stream(video: VideoInfo) -> AsyncIterator[bytes]:
    """Lanza la tubería yt-dlp | ffmpeg y devuelve un iterador de fragmentos MP3.

    Lee el primer fragmento antes de devolver el iterador para que los fallos
    de arranque se conviertan en un error HTTP en lugar de un 200 vacío.
    """
    read_fd, write_fd = os.pipe()
    try:
        downloader = await asyncio.create_subprocess_exec(
            sys.executable, "-m", "yt_dlp",
            "--quiet", "--no-warnings", "--no-playlist", "--no-part",
            "--no-cache-dir", "--no-progress",
            "-f", "bestaudio/best",
            "-o", "-",
            video.url,
            stdout=write_fd,
            stderr=asyncio.subprocess.DEVNULL,
        )
        encoder = await asyncio.create_subprocess_exec(
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-i", "pipe:0",
            "-vn",
            "-ac", str(config.AUDIO_CHANNELS),
            "-ar", str(config.AUDIO_SAMPLE_RATE),
            "-c:a", "libmp3lame",
            "-b:a", config.AUDIO_BITRATE,
            "-f", "mp3",
            "pipe:1",
            stdin=read_fd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
    except FileNotFoundError as error:
        raise ExtractionError("ffmpeg no está instalado en el servidor.", 500) from error
    finally:
        # Los procesos hijos conservan sus copias; el padre no las necesita.
        os.close(read_fd)
        os.close(write_fd)

    assert encoder.stdout is not None
    first_chunk = await encoder.stdout.read(config.CHUNK_SIZE)
    if not first_chunk:
        await _terminate(downloader)
        await _terminate(encoder)
        raise ExtractionError("No se pudo extraer el audio del video.", 502)

    async def iterate() -> AsyncIterator[bytes]:
        try:
            yield first_chunk
            while chunk := await encoder.stdout.read(config.CHUNK_SIZE):
                yield chunk
        finally:
            # También se ejecuta si el cliente cierra la conexión a mitad.
            await _terminate(downloader)
            await _terminate(encoder)

    return iterate()
