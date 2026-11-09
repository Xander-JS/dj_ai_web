"""Punto de entrada del microservicio de extracción de audio de SYSTEM DJ."""

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import config
from app.routes import router
from app.mix_plan import router as mix_router

app = FastAPI(title="SYSTEM DJ · Audio Extraction Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
    expose_headers=["Content-Disposition", "X-Audio-Duration"],
)

app.include_router(router)
app.include_router(mix_router)


if __name__ == "__main__":
    uvicorn.run("app.main:app", host=config.HOST, port=config.PORT, reload=True)
