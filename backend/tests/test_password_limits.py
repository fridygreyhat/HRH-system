"""Password byte boundaries must fail safely, without silently truncating secrets."""
import pytest
from fastapi import HTTPException

from backend.core.security import hash_password, verify_password


@pytest.mark.parametrize("password", ["a" * 72, "é" * 36, "🔒" * 18])
def test_password_at_bcrypt_byte_limit_round_trips(password):
    hashed = hash_password(password)
    assert verify_password(password, hashed)


@pytest.mark.parametrize("password", ["a" * 73, "é" * 37, "🔒" * 19])
def test_oversize_password_gets_validation_error_without_leaking_password(password):
    with pytest.raises(HTTPException) as error:
        hash_password(password)
    assert error.value.status_code == 422
    assert password not in error.value.detail


def test_login_never_accepts_a_truncated_password():
    hashed = hash_password("a" * 72)
    assert not verify_password("a" * 72 + "different", hashed)
