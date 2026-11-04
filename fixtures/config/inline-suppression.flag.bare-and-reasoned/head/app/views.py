from app.db import query


def report(request):
    rows = query("SELECT id, name, email, created_at, updated_at FROM users ORDER BY created_at")  # noqa
    return rows


def main():  # pragma: no cover  # CLI entry point, run by hand
    print(report(None))
