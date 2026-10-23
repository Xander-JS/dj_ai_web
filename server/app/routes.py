"""Endpoints HTTP del microservicio."""

from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse

from app import config
from app.schemas import ExtractAudioRequest, HealthResponse
from app.services.extractor import ExtractionError, inspect_video, open_audio_stream, safe_filename

router = APIRouter(prefix="/api")


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok")


@router.post("/extract-audio")
async def extract_audio(body: ExtractAudioRequest) -> StreamingResponse:
    try:
        video = await run_in_threadpool(inspect_video, str(body.url))
        stream = await open_audio_stream(video)
    except ExtractionError as error:
        raise HTTPException(status_code=error.status_code, detail=error.message) from error

    filename = safe_filename(video.title)
    ascii_name = filename.encode("ascii", "ignore").decode() or "audio.mp3"
    ascii_name = ascii_name.replace('"', "")
    return StreamingResponse(
        stream,
        media_type=config.AUDIO_MEDIA_TYPE,
        headers={
            "Content-Disposition": (
                f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{quote(filename)}'
            ),
            "X-Audio-Duration": str(video.duration),
            "Cache-Control": "no-store",
        },
    )
