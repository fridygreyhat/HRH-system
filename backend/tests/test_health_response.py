from unittest.mock import Mock

from backend.main import health_check


def test_database_failure_is_unavailable_without_leaking_connection_details():
    db = Mock()
    db.execute.side_effect = RuntimeError("private connection diagnostics")
    response = health_check(db)
    assert response.status_code == 503
    assert b"private connection diagnostics" not in response.body
    assert b'"database":"unavailable"' in response.body


def test_healthy_database_retains_existing_health_contract():
    assert health_check(Mock()) == {"status": "healthy", "database": "connected"}
