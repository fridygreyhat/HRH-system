"""Reading uploaded CSV files safely: bounded size, tolerant decoding."""
from fastapi import HTTPException, UploadFile

from . import config


def read_upload_bytes(file: UploadFile) -> bytes:
    raw = file.file.read(config.MAX_IMPORT_BYTES + 1)
    if len(raw) > config.MAX_IMPORT_BYTES:
        raise HTTPException(status_code=413, detail=f"The file is larger than {config.MAX_IMPORT_BYTES // (1024 * 1024)} MB; split it and import the parts")
    return raw


def read_csv_upload(file: UploadFile) -> str:
    raw = read_upload_bytes(file)
    return raw.decode("utf-8-sig", errors="replace").replace("\x00", "")  # the database cannot store NUL characters
