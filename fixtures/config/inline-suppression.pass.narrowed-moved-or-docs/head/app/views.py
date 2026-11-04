from app.db import query

NOTE = """
Lines this long carry # noqa: E501 in this module.
"""


def report(request):
    rows = query("SELECT id, name, email, created_at, updated_at FROM users ORDER BY created_at DESC")  # noqa: E501
    return rows
