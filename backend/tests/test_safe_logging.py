from app.core.logging import redact


def test_log_redaction_removes_authentication_secrets():
    message = "Bearer secret-token-value password=my-password https://example.com/reset?token=secret-value"
    result = redact(message)
    assert "secret-token-value" not in result
    assert "my-password" not in result
    assert "secret-value" not in result
