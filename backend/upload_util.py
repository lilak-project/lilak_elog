"""Stream an UploadFile to disk in bounded chunks.

`await upload.read()` buffers the WHOLE file in RAM and any size check runs only
after — so a large upload can balloon (or OOM) the single-worker backend before the
limit fires, and the blocking write stalls the event loop. This reads in <=CHUNK
pieces, enforces the cap as it goes, deletes the partial file if the cap is
exceeded, and keeps only one chunk in memory at a time.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException, UploadFile

CHUNK = 1024 * 1024  # 1 MB


async def save_upload_streaming(upload: UploadFile, dest, max_size: int,
                                too_large_detail: str = "File exceeds the size limit") -> int:
    """Write `upload` to `dest` chunk-by-chunk, aborting with 413 (and removing the
    partial file) once the running total exceeds `max_size`. Returns bytes written."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    try:
        with open(dest, "wb") as f:
            while True:
                chunk = await upload.read(CHUNK)
                if not chunk:
                    break
                size += len(chunk)
                if size > max_size:
                    raise HTTPException(status_code=413, detail=too_large_detail)
                f.write(chunk)
    except BaseException:
        dest.unlink(missing_ok=True)     # never leave a partial / oversized file behind
        raise
    return size
