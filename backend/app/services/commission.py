from __future__ import annotations

SALE_NORMAL = "normal"
SALE_COMMISSION = "commission"
MIN_WORDS = 1000
MAX_WORDS = 5_000_000


def commission_total(rate: float, word_count: int) -> float:
    return round(int(word_count) / 1000 * float(rate), 2)


def format_words(n: int) -> str:
    n = int(n or 0)
    if n >= 10000 and n % 10000 == 0:
        return f"{n // 10000} 万字"
    if n >= 10000:
        return f"{n / 10000:.1f}".rstrip("0").rstrip(".") + " 万字"
    return f"{n} 字"


def format_yuan_text(n: float) -> str:
    value = round(float(n) * 100) / 100
    if abs(value - int(value)) < 0.001:
        return f"¥{int(value)}"
    return f"¥{value}"


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
