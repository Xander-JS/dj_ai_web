"""Modelos de entrada y salida de la API."""

from pydantic import BaseModel, HttpUrl, field_validator

from app.config import ALLOWED_HOSTS


class ExtractAudioRequest(BaseModel):
    url: HttpUrl

    @field_validator("url")
    @classmethod
    def must_be_youtube(cls, value: HttpUrl) -> HttpUrl:
        if value.scheme not in ("http", "https") or (value.host or "").lower() not in ALLOWED_HOSTS:
            raise ValueError("La URL debe ser un enlace válido de YouTube.")
        return value


class HealthResponse(BaseModel):
    status: str
