"""Local EmbeddingGemma 2 encoders. Install explicitly; never download at request time."""

import base64
import io
import os
import threading
from contextlib import asynccontextmanager, contextmanager

import av
import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer

MODEL = "embeddinggemma-2-native"
MODEL_REVISION = "914f7f89142e33e77833254d9c9b90c3cef7303b"
gate = threading.Condition()
active = False
query_waiters = 0
encoder = None
revision = ""


@contextmanager
def inference_lane(query):
    """Let text queries pass between clips while a background batch is indexing."""
    global active, query_waiters
    with gate:
        if query:
            query_waiters += 1
        while active or (query_waiters and not query):
            gate.wait()
        if query:
            query_waiters -= 1
        active = True
    try:
        yield
    finally:
        with gate:
            active = False
            gate.notify_all()


@asynccontextmanager
async def lifespan(_app):
    global encoder, revision
    from huggingface_hub import snapshot_download

    folder = snapshot_download(
        "google/embeddinggemma-2", revision=MODEL_REVISION, local_files_only=True
    )
    revision = os.path.basename(folder) + ":float32:av-1fps-image280-v1"
    torch.set_num_threads(2)
    encoder = SentenceTransformer(
        folder, device="cpu", model_kwargs={"torch_dtype": torch.float32}
    )
    yield


app = FastAPI(lifespan=lifespan)


class Item(BaseModel):
    text: str = Field(default="", max_length=24000)
    image: str | None = None
    media: str | None = None
    mime_type: str | None = None


class Request(BaseModel):
    model: str
    inputs: list[Item] = Field(min_length=1, max_length=4)
    dimensions: int = 768
    query: bool = False


def decode(item):
    content = {}
    if item.text:
        content["text"] = item.text
    if item.image:
        content["image"] = Image.open(
            io.BytesIO(base64.b64decode(item.image, validate=True))
        ).convert("RGB")
    if item.media:
        data = base64.b64decode(item.media, validate=True)
        if len(data) > 12 * 1024 * 1024:
            raise ValueError("clip too large")
        # PyAV works on Windows without Torchcodec/FFmpeg DLL discovery.
        if item.mime_type == "video/mp4":
            frames, next_second = [], 0
            with av.open(io.BytesIO(data)) as container:
                for frame in container.decode(video=0):
                    if frame.time is not None and frame.time >= next_second:
                        frames.append(frame.to_image())
                        next_second += 1
                        if len(frames) >= 30:
                            break
            if not frames:
                raise ValueError("empty video")
            content["video"] = frames
        with av.open(io.BytesIO(data)) as container:
            if container.streams.audio:
                resampler = av.AudioResampler(format="fltp", layout="mono", rate=16000)
                samples = []
                for frame in container.decode(audio=0):
                    samples.extend(
                        value.to_ndarray().reshape(-1)
                        for value in resampler.resample(frame)
                    )
                samples.extend(
                    value.to_ndarray().reshape(-1) for value in resampler.resample(None)
                )
                if samples:
                    waveform = np.concatenate(samples).astype(np.float32)
                    if len(waveform) > 31 * 16000:
                        raise ValueError("clip duration exceeded")
                    content["audio"] = waveform
    if not content:
        raise ValueError("empty input")
    return content


@app.get("/v1/models")
def models():
    return {"data": [{"id": MODEL, "version": revision}]}


@app.post("/embed")
def embed(body: Request):
    if body.model != MODEL or body.dimensions not in {128, 256, 512, 768}:
        raise HTTPException(422, "Unsupported model or dimensions")
    try:
        values = [decode(item) for item in body.inputs]
        # A single encode call produces independent vectors, one per source.
        vectors = []
        for value in values:
            with inference_lane(body.query), torch.inference_mode():
                vector = encoder.encode(
                    [value],
                    batch_size=1,
                    normalize_embeddings=True,
                    show_progress_bar=False,
                    truncate_dim=body.dimensions,
                    prompt_name="query" if body.query else "document",
                    processing_kwargs={
                        "image": {"max_soft_tokens": 280},
                        "video": {"fps": None, "max_soft_tokens": 70},
                    },
                )
                vectors.append(vector[0].tolist())
        return {"embeddings": vectors, "version": revision}
    except (ValueError, av.error.FFmpegError):
        raise HTTPException(422, "Invalid media input") from None
