from decimal import Decimal

from app.models import Invoice


def total(invoice: Invoice) -> Decimal:
    return sum(line.amount for line in invoice.items)  # type: ignore[attr-defined]


def handle(event):
    # pylint: disable=broad-except
    try:
        return total(event.invoice)
    except Exception:
        return None
