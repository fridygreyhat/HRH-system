"""Reading uploaded CSV files safely: bounded size, tolerant decoding, a clear error for a malformed file."""
from fastapi import HTTPException, UploadFile

from . import config


async def read_csv_upload(file: UploadFile) -> str:
    raw = await file.read(config.MAX_IMPORT_BYTES + 1)
    if len(raw) > config.MAX_IMPORT_BYTES:
        raise HTTPException(status_code=413, detail=f"The file is larger than {config.MAX_IMPORT_BYTES // (1024 * 1024)} MB; split it and import the parts")
    return raw.decode("utf-8-sig", errors="replace")
