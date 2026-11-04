from decimal import Decimal

from app.models import Invoice


def total(invoice: Invoice) -> Decimal:  # pylint: disable=all
    return sum(line.amount for line in invoice.lines)  # type: ignore
