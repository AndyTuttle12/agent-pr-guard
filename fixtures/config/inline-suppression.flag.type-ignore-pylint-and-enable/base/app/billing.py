from decimal import Decimal

from app.models import Invoice


def total(invoice: Invoice) -> Decimal:
    return sum(line.amount for line in invoice.lines)


def handle(event):
    return total(event.invoice)
