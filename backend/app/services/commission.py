from __future__ import annotations

SALE_NORMAL = "normal"
SALE_COMMISSION = "commission"


def normalize_sale_mode(value: str | None) -> str:
    return SALE_COMMISSION if (value or "").strip() == SALE_COMMISSION else SALE_NORMAL


def is_commission_mode(value: str | None) -> bool:
    return normalize_sale_mode(value) == SALE_COMMISSION


def split_price(price: float) -> tuple[float, float]:
    """Split a price into deposit + balance in cents so the two halves always sum to the list price."""
    cents = int(round(float(price) * 100))
    if cents < 2:
        return 0.0, 0.0
    deposit = cents // 2
    balance = cents - deposit
    return deposit / 100.0, balance / 100.0
