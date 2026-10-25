"""Read-only simulation assets. Never reads or mutates live financial records."""
import json
from pathlib import Path

DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "workflow_demos.json"


def walkthrough():
    with DATA_PATH.open(encoding="utf-8") as source:
        return json.load(source)


def sample_proof_pdf() -> bytes:
    """A valid, conspicuously marked sample, not a bank or mobile-money receipt."""
    lines = [
        "TANZANIA HRH - SIMULATED DEMO",
        "NOT PROOF OF A REAL PAYMENT",
        "No money was transferred. No bank or wallet was contacted.",
        "This sample demonstrates payment-evidence upload only.",
    ]
    content = "BT /F1 16 Tf 45 750 Td " + " ".join(
        f"({line}) Tj 0 -36 Td" for line in lines
    ) + " ET"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        f"<< /Length {len(content.encode())} >>\nstream\n{content}\nendstream".encode(),
    ]
    output = b"%PDF-1.4\n"
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(output))
        output += f"{index} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(output)
    output += f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode()
    output += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:])
    return output + f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
