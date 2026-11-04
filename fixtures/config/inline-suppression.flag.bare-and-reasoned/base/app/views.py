from app.db import query


def report(request):
    rows = query("SELECT id, name, email, created_at, updated_at FROM users ORDER BY created_at")  # noqa: E501
    return rows


def main():
    print(report(None))
