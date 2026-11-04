from decimal import Decimal

from app.models import Invoice

# Docs: a # type: ignore here would hide the whole module from mypy.


def total(invoice: Invoice) -> Decimal:  # pylint: disable=invalid-name
    return sum(line.amount for line in invoice.lines)  # type: ignore[attr-defined]
