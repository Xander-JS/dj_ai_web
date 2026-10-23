"""Configuración del microservicio de extracción de audio."""

import os

HOST = os.getenv("AUDIO_SERVICE_HOST", "localhost")
PORT = int(os.getenv("AUDIO_SERVICE_PORT", "8000"))

# Orígenes de desarrollo de Vite permitidos por CORS (separados por comas).
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "AUDIO_SERVICE_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]

# Límite de duración para evitar desbordar la RAM al decodificar en el navegador.
MAX_DURATION_SECONDS = 600

# Formato de salida compatible con la Web Audio API.
AUDIO_BITRATE = "192k"
AUDIO_SAMPLE_RATE = 44100
AUDIO_CHANNELS = 2
AUDIO_MEDIA_TYPE = "audio/mpeg"

CHUNK_SIZE = 64 * 1024

ALLOWED_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
}
