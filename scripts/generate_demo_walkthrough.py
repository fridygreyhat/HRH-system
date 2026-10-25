"""Generate replay snapshots in a throwaway DB; never seed the real application DB."""
import os
from pathlib import Path
import subprocess
import sys
import uuid

import psycopg2
from psycopg2 import sql

ROOT = Path(__file__).resolve().parents[1]


def main():
    name = "hrh_demo_" + uuid.uuid4().hex[:16]
    env = {
        **os.environ, "HRH_TEST_DATABASE": name,
        "HRH_DEMO_EXPORT": str(ROOT / "backend/data/workflow_demos.json"),
    }
    try:
        return subprocess.call([
            sys.executable, "-m", "pytest", "-q",
            "backend/tests/test_generate_demo_walkthrough.py",
            "backend/tests/test_demo_walkthrough.py", "--tb=short", "--maxfail=1",
        ], cwd=ROOT, env=env)
    finally:
        connection = psycopg2.connect(
            os.environ["DATABASE_URL"].replace("postgresql+psycopg2://", "postgresql://"),
            dbname="postgres",
        )
        connection.autocommit = True
        try:
            with connection.cursor() as cursor:
                cursor.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(name)))
        finally:
            connection.close()


if __name__ == "__main__":
    raise SystemExit(main())
