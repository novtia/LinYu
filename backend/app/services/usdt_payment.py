from __future__ import annotations

import json
import logging
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import urlencode

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models import Order, OrderPayment, PaymentChannel, UsdtInvoice
from ..payment.providers.usdt import (
    USDT_CHAINS_BY_ID,
    UsdtConfig,
    enabled_valid_chains,
    normalize_address_key,
)
from ..payment.service import parse_config
from .commission import is_commission_mode
from .delivery import random_id
from .fulfillment import fulfill_order

logger = logging.getLogger("lingxia.usdt")

TRANSFER_TOPIC0 = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

# 订单过期后继续保留尾数冷却与延迟到账宽限期（分钟），避免临界点转账撞单或漏单
COOLDOWN_GRACE = timedelta(minutes=10)
TX_EARLY_SKEW_SEC = 45

# 每条 EVM 链的大致每秒出块数（用于冷启动按最老待付单时间自适应回溯区块）
_BLOCKS_PER_SEC: Dict[str, float] = {
    "erc20": 0.1,
    "bep20": 1.5,
    "polygon": 0.6,
    "optimism": 0.6,
    "arbitrum": 4.2,
}

_USER_AGENT = "Mozilla/5.0 (compatible; LingxiaPay/1.0)"

# 汇率缓存：(timestamp, cny_per_usdt)
_rate_lock = threading.Lock()
_rate_cache: Tuple[float, float] = (0.0, 0.0)
_RATE_TTL_SEC = 300.0

# 链上游标与防抖状态
_scan_lock = threading.Lock()
_evm_block_cursor: Dict[Tuple[str, str], int] = {}
_block_ts_cache: Dict[Tuple[str, int], int] = {}
_manual_check_ts: Dict[str, float] = {}


def _http_get_json(url: str, *, headers: Optional[Dict[str, str]] = None, timeout: float = 6.0) -> Any:
    req_headers = {"Accept": "application/json", "User-Agent": _USER_AGENT}
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(url, headers=req_headers, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _http_post_json(url: str, payload: Any, *, timeout: float = 7.0) -> Any:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": _USER_AGENT,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _fetch_live_usdt_cny() -> Optional[float]:
    """依次尝试多个公开汇率源获取 1 USDT 兑人民币汇率。"""
    # 1. CoinGecko Tether/CNY
    try:
        data = _http_get_json(
            "https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=cny",
            timeout=4.0,
        )
        val = float((data or {}).get("tether", {}).get("cny") or 0)
        if 4.0 <= val <= 15.0:
            return val
    except Exception:
        pass

    # 2. Coinbase USDT exchange rates
    try:
        data = _http_get_json("https://api.coinbase.com/v2/exchange-rates?currency=USDT", timeout=4.0)
        val = float((data or {}).get("data", {}).get("rates", {}).get("CNY") or 0)
        if 4.0 <= val <= 15.0:
            return val
    except Exception:
        pass

    # 3. Open ER-API USD/CNY
    try:
        data = _http_get_json("https://open.er-api.com/v6/latest/USD", timeout=4.0)
        val = float((data or {}).get("rates", {}).get("CNY") or 0)
        if 4.0 <= val <= 15.0:
            return val
    except Exception:
        pass

    return None


def resolve_exchange_rate(cfg: UsdtConfig) -> float:
    """返回最终折算汇率（1 USDT = X CNY）。"""
    global _rate_cache
    fallback = float(cfg.fixed_rate or 7.20)
    if cfg.rate_mode == "fixed":
        base = fallback
    else:
        now = time.monotonic()
        with _rate_lock:
            cached_at, cached_val = _rate_cache
        if cached_val > 0 and (now - cached_at) < _RATE_TTL_SEC:
            base = cached_val
        else:
            live = _fetch_live_usdt_cny()
            if live:
                with _rate_lock:
                    _rate_cache = (now, live)
                base = live
            else:
                base = fallback if fallback > 0 else 7.20

    markup = float(cfg.rate_markup_pct or 0.0)
    adjusted = base * (1.0 + markup / 100.0)
    return round(max(0.5, adjusted), 4)


def _frontend_redirect_path(order: Order) -> str:
    qs = urlencode({"pay": "1"})
    if is_commission_mode(order.sale_mode):
        return f"/commissions?order={order.id}&{qs}"
    return f"/orders/{order.id}?{qs}"


def _resolve_target(db: Session, payment_id: str) -> Tuple[Optional[Order], Optional[OrderPayment]]:
    payment = db.query(OrderPayment).filter(OrderPayment.id == payment_id).first()
    if payment:
        order = db.query(Order).filter(Order.id == payment.order_id).first()
        return order, payment
    order = db.query(Order).filter(Order.id == payment_id).first()
    return order, None


def _is_target_settled(order: Order, payment: Optional[OrderPayment]) -> bool:
    if payment and payment.status == "paid":
        return True
    if is_commission_mode(order.sale_mode):
        if payment and payment.kind == "deposit" and order.status in ("deposit_paid", "awaiting_balance", "completed"):
            return True
        if payment and payment.kind == "balance" and order.status == "completed":
            return True
        if payment is None and order.status in ("deposit_paid", "awaiting_balance", "completed", "paid"):
            return True
        return False
    return order.status in ("paid", "completed")


def settle_order_payment(
    db: Session,
    order: Order,
    payment: Optional[OrderPayment],
    *,
    trade_no: Optional[str] = None,
    payment_method: Optional[str] = None,
) -> bool:
    """统一完成普通订单或约稿分笔订单入账与发货（幂等）。"""
    now = datetime.utcnow()
    if payment:
        payment.status = "paid"
        if not payment.paid_at:
            payment.paid_at = now
        if trade_no and not payment.trade_no:
            payment.trade_no = trade_no
        if payment_method:
            payment.payment_method = payment_method

    if payment_method:
        order.payment_method = payment_method

    if is_commission_mode(order.sale_mode) and payment and payment.kind in ("deposit", "balance"):
        if payment.kind == "deposit":
            was_pending = order.status == "pending"
            if was_pending:
                order.status = "deposit_paid"
            if not order.paid_at:
                order.paid_at = now
            if trade_no and not order.trade_no:
                order.trade_no = trade_no
            db.commit()
            if was_pending:
                from .commission_chat import notify_deposit_paid

                notify_deposit_paid(db, order)
            return True
        if payment.kind == "balance":
            if order.status in ("awaiting_balance", "deposit_paid"):
                order.status = "completed"
            if trade_no and not order.trade_no:
                order.trade_no = trade_no
            db.commit()
            return True

    fulfill_order(db, order, trade_no=trade_no)
    return True


def _format_cents_to_usdt(cents: int) -> str:
    whole = cents // 100
    frac = cents % 100
    return f"{whole}.{frac:02d}"


def _cents_to_units(cents: int, decimals: int) -> str:
    if decimals < 2:
        raise ValueError("Unsupported token decimals")
    return str(int(cents) * (10 ** (decimals - 2)))


def _allocate_unique_amount(
    db: Session,
    *,
    chain: str,
    address_key: str,
    amount_cny: float,
    rate: float,
    decimals: int,
    now: datetime,
) -> Tuple[str, str]:
    """在同一 (chain, address) 的有效+冷却期内分配不撞单的精确 2 位小数 USDT 金额。"""
    raw_usdt = (Decimal(str(amount_cny)) / Decimal(str(rate))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    base_cents = max(1, int(raw_usdt * 100))

    cutoff = now - COOLDOWN_GRACE
    occupied_rows = (
        db.query(UsdtInvoice.amount_usdt)
        .filter(
            UsdtInvoice.chain == chain,
            UsdtInvoice.address_key == address_key,
            UsdtInvoice.status == "pending",
            UsdtInvoice.expires_at >= cutoff,
        )
        .all()
    )
    occupied: Set[str] = {str(r[0]) for r in occupied_rows if r[0]}

    # 跳过 .00 整数金额，防止日常整数转账误触发订单自动发货
    for offset in range(0, 300):
        cand_cents = base_cents + offset
        if cand_cents % 100 == 0:
            continue
        cand_str = _format_cents_to_usdt(cand_cents)
        if cand_str not in occupied:
            return cand_str, _cents_to_units(cand_cents, decimals)

    raise HTTPException(status_code=503, detail="当前该网络收款通道繁忙，请切换其他网络或稍后再试")


def _explorer_tx_url(chain: str, tx_hash: Optional[str]) -> Optional[str]:
    if not tx_hash:
        return None
    spec = USDT_CHAINS_BY_ID.get(chain)
    if not spec:
        return None
    return str(spec["explorer_tx"]).format(tx=tx_hash)


def _item_title(order: Order, payment: Optional[OrderPayment]) -> str:
    items = list(order.items or [])
    base = items[0].name if items else "数字商品"
    if len(items) > 1:
        base = f"{base} 等 {len(items)} 件"
    if payment and payment.kind == "deposit":
        return f"{base}（定金）"
    if payment and payment.kind == "balance":
        return f"{base}（尾款）"
    return base


def build_usdt_session_payload(
    db: Session,
    payment_id: str,
    *,
    preferred_chain: Optional[str] = None,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    """获取或创建自托管 USDT 收银台会话数据。"""
    order, payment = _resolve_target(db, payment_id)
    if not order:
        raise HTTPException(status_code=404, detail="支付单不存在或已过期")

    now = datetime.utcnow()
    amount_cny = round(float(payment.amount if payment else order.total), 2)
    title = _item_title(order, payment)
    redirect_url = _frontend_redirect_path(order)

    # 若已支付，直接返回成功态与跳转地址
    if _is_target_settled(order, payment):
        paid_inv = (
            db.query(UsdtInvoice)
            .filter(UsdtInvoice.payment_id == payment_id, UsdtInvoice.status == "paid")
            .order_by(UsdtInvoice.paid_at.desc())
            .first()
        )
        chain_id = paid_inv.chain if paid_inv else (preferred_chain or "trc20")
        tx_hash = (paid_inv.tx_hash if paid_inv else None) or (payment.trade_no if payment else None) or order.trade_no
        spec = USDT_CHAINS_BY_ID.get(chain_id, USDT_CHAINS_BY_ID["trc20"])
        return {
            "payment_id": payment_id,
            "order_id": order.id,
            "title": title,
            "status": "paid",
            "amount_cny": amount_cny,
            "amount_usdt": paid_inv.amount_usdt if paid_inv else "0.00",
            "exchange_rate": paid_inv.exchange_rate if paid_inv else 0.0,
            "chain": chain_id,
            "chain_name": spec["name"],
            "chain_full_name": spec["full_name"],
            "address": paid_inv.address if paid_inv else "",
            "contract": spec["contract"],
            "expires_at": (paid_inv.expires_at.isoformat() + "Z") if paid_inv else (now.isoformat() + "Z"),
            "remaining_seconds": 0,
            "tx_hash": tx_hash,
            "explorer_url": _explorer_tx_url(chain_id, tx_hash),
            "redirect_url": redirect_url,
            "available_chains": [],
        }

    if order.status in ("cancelled", "failed"):
        raise HTTPException(status_code=400, detail="订单已关闭，请重新下单")

    channel_id = (payment.payment_channel_id if payment else None) or order.payment_channel_id
    channel = db.query(PaymentChannel).filter(PaymentChannel.id == channel_id).first() if channel_id else None
    if not channel or channel.provider != "usdt" or not channel.enabled:
        raise HTTPException(status_code=400, detail="USDT 收款渠道不可用")

    raw_cfg = parse_config(channel.config_json)
    valid_chains = enabled_valid_chains(raw_cfg)
    if not valid_chains:
        raise HTTPException(status_code=400, detail="商家尚未配置可用的 USDT 收款网络")

    cfg = UsdtConfig(**raw_cfg)
    chain_map = {cid: (item, spec) for cid, item, spec in valid_chains}
    available_chains = [
        {
            "id": cid,
            "name": spec["name"],
            "full_name": spec["full_name"],
            "badge": spec["badge"],
            "hint": spec["hint"],
        }
        for cid, _, spec in valid_chains
    ]

    # 选择当前链：优先用户指定链 -> 最近未过期的锁定链 -> 第一个启用链
    chosen_chain = (preferred_chain or "").strip().lower()
    if chosen_chain and chosen_chain not in chain_map:
        raise HTTPException(status_code=400, detail="所选区块链网络未启用")

    if not chosen_chain:
        recent_inv = (
            db.query(UsdtInvoice)
            .filter(
                UsdtInvoice.payment_id == payment_id,
                UsdtInvoice.status == "pending",
                UsdtInvoice.expires_at > now,
            )
            .order_by(UsdtInvoice.created_at.desc())
            .first()
        )
        if recent_inv and recent_inv.chain in chain_map:
            chosen_chain = recent_inv.chain
        else:
            chosen_chain = valid_chains[0][0]

    chain_item, chain_spec = chain_map[chosen_chain]
    wallet_addr = chain_item.address.strip()
    addr_key = normalize_address_key(chosen_chain, wallet_addr)

    existing = (
        db.query(UsdtInvoice)
        .filter(
            UsdtInvoice.payment_id == payment_id,
            UsdtInvoice.chain == chosen_chain,
            UsdtInvoice.status == "pending",
        )
        .order_by(UsdtInvoice.created_at.desc())
        .first()
    )

    reuse = (
        existing is not None
        and existing.address_key == addr_key
        and abs(float(existing.amount_cny) - amount_cny) < 0.01
        and existing.expires_at > now
        and not force_refresh
    )

    if reuse and existing is not None:
        invoice = existing
    else:
        if existing and existing.status == "pending" and existing.expires_at <= now:
            existing.status = "expired"
        rate = resolve_exchange_rate(cfg)
        amount_usdt, amount_units = _allocate_unique_amount(
            db,
            chain=chosen_chain,
            address_key=addr_key,
            amount_cny=amount_cny,
            rate=rate,
            decimals=int(chain_spec["decimals"]),
            now=now,
        )
        expires_at = now + timedelta(minutes=int(cfg.expire_minutes or 20))
        invoice = UsdtInvoice(
            id="usdt_" + random_id(),
            payment_id=payment_id,
            order_id=order.id,
            channel_id=channel.id,
            chain=chosen_chain,
            address=wallet_addr,
            address_key=addr_key,
            amount_cny=amount_cny,
            exchange_rate=rate,
            amount_usdt=amount_usdt,
            amount_units=amount_units,
            status="pending",
            created_at=now,
            expires_at=expires_at,
        )
        db.add(invoice)
        db.commit()
        db.refresh(invoice)

    rem_sec = max(0, int((invoice.expires_at - now).total_seconds()))
    return {
        "payment_id": payment_id,
        "order_id": order.id,
        "title": title,
        "status": "expired" if rem_sec <= 0 else "pending",
        "amount_cny": invoice.amount_cny,
        "amount_usdt": invoice.amount_usdt,
        "exchange_rate": invoice.exchange_rate,
        "chain": chosen_chain,
        "chain_name": chain_spec["name"],
        "chain_full_name": chain_spec["full_name"],
        "address": invoice.address,
        "contract": chain_spec["contract"],
        "expires_at": invoice.expires_at.isoformat() + "Z",
        "remaining_seconds": rem_sec,
        "tx_hash": None,
        "explorer_url": None,
        "redirect_url": redirect_url,
        "available_chains": available_chains,
    }


# ============================ 链上转账扫描器 ============================


class ChainTransfer:
    __slots__ = ("tx_hash", "amount_units", "timestamp_sec")

    def __init__(self, tx_hash: str, amount_units: int, timestamp_sec: int) -> None:
        self.tx_hash = tx_hash
        self.amount_units = amount_units
        self.timestamp_sec = timestamp_sec


def _scan_tron_transfers(
    address: str,
    *,
    contract: str,
    rpc_url: str = "",
    api_key: str = "",
    min_ts_sec: int = 0,
) -> List[ChainTransfer]:
    base = (rpc_url or "https://api.trongrid.io").strip().rstrip("/")
    qs = urllib.parse.urlencode(
        {
            "only_confirmed": "true",
            "only_to": "true",
            "limit": "50",
            "contract_address": contract,
            "min_timestamp": str(max(0, min_ts_sec * 1000)),
        }
    )
    url = f"{base}/v1/accounts/{urllib.parse.quote(address)}/transactions/trc20?{qs}"
    headers: Dict[str, str] = {}
    if api_key and api_key != "********":
        headers["TRON-PRO-API-KEY"] = api_key

    data = _http_get_json(url, headers=headers, timeout=7.0)
    rows = (data or {}).get("data") or []
    out: List[ChainTransfer] = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        if item.get("type") != "Transfer":
            continue
        if str(item.get("to") or "").strip() != address:
            continue
        token_addr = str((item.get("token_info") or {}).get("address") or "").strip()
        if token_addr != contract:
            continue
        tx_id = str(item.get("transaction_id") or "").strip()
        raw_val = str(item.get("value") or "").strip()
        if not tx_id or not raw_val.isdigit():
            continue
        ts_ms = int(item.get("block_timestamp") or 0)
        ts_sec = ts_ms // 1000 if ts_ms > 10_000_000_000 else ts_ms
        out.append(ChainTransfer(tx_hash=tx_id, amount_units=int(raw_val), timestamp_sec=ts_sec))
    return out


def _evm_rpc_call(rpc_urls: List[str], method: str, params: list) -> Tuple[Any, str]:
    last_err: Optional[Exception] = None
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    for url in rpc_urls:
        try:
            resp = _http_post_json(url, payload, timeout=7.0)
            if isinstance(resp, dict) and "error" in resp and resp["error"]:
                err_msg = str(resp["error"])
                raise RuntimeError(err_msg)
            if isinstance(resp, dict) and "result" in resp:
                return resp["result"], url
        except Exception as exc:
            last_err = exc
            continue
    raise RuntimeError(f"EVM RPC 调用失败 ({method}): {last_err}")


def _resolve_evm_block_ts(chain: str, rpc_urls: List[str], block_num: int, log_obj: Dict[str, Any]) -> int:
    # 新版节点（Geth/Erigon）在 eth_getLogs 里直接返回 blockTimestamp
    raw_log_ts = log_obj.get("blockTimestamp")
    if isinstance(raw_log_ts, str) and raw_log_ts.startswith("0x"):
        try:
            return int(raw_log_ts, 16)
        except ValueError:
            pass

    key = (chain, block_num)
    if key in _block_ts_cache:
        return _block_ts_cache[key]

    blk, _ = _evm_rpc_call(rpc_urls, "eth_getBlockByNumber", [hex(block_num), False])
    if isinstance(blk, dict) and isinstance(blk.get("timestamp"), str):
        ts = int(blk["timestamp"], 16)
        if len(_block_ts_cache) > 2000:
            _block_ts_cache.clear()
        _block_ts_cache[key] = ts
        return ts
    return int(time.time())


def _scan_evm_transfers(
    chain: str,
    address: str,
    *,
    contract: str,
    default_rpcs: List[str],
    custom_rpc: str = "",
    oldest_created_at: datetime,
    wanted_units: Set[int],
) -> List[ChainTransfer]:
    rpc_urls: List[str] = []
    if custom_rpc.strip():
        rpc_urls.append(custom_rpc.strip())
    for r in default_rpcs:
        if r not in rpc_urls:
            rpc_urls.append(r)

    latest_hex, working_rpc = _evm_rpc_call(rpc_urls, "eth_blockNumber", [])
    latest_block = int(str(latest_hex), 16)
    # 把刚成功的 RPC 排到首位以复用稳定节点
    ordered_rpcs = [working_rpc] + [u for u in rpc_urls if u != working_rpc]

    addr_key = address.lower()
    cursor_key = (chain, addr_key)
    age_sec = max(90.0, (datetime.utcnow() - oldest_created_at).total_seconds() + 90.0)
    bps = _BLOCKS_PER_SEC.get(chain, 1.0)
    cold_lookback = min(3600, max(60, int(age_sec * bps)))

    prev_cursor = _evm_block_cursor.get(cursor_key)
    if prev_cursor is not None and 0 < prev_cursor <= latest_block:
        # 留 6 个区块重叠防轻微重组漏扫
        from_block = max(0, prev_cursor - 6)
        if latest_block - from_block > 3600:
            from_block = latest_block - cold_lookback
    else:
        from_block = max(0, latest_block - cold_lookback)

    if from_block > latest_block:
        return []

    padded_to = "0x" + ("0" * 24) + addr_key[2:]
    out: List[ChainTransfer] = []
    chunk = 750
    cur = from_block

    while cur <= latest_block:
        end = min(latest_block, cur + chunk - 1)
        filter_param = {
            "fromBlock": hex(cur),
            "toBlock": hex(end),
            "address": contract,
            "topics": [TRANSFER_TOPIC0, None, padded_to],
        }
        try:
            logs, _ = _evm_rpc_call(ordered_rpcs, "eth_getLogs", [filter_param])
        except Exception as exc:
            # 部分公共节点限制单次区块跨度（如 <= 400 blocks），自动折半重试
            if chunk > 200:
                chunk = max(200, chunk // 2)
                continue
            raise exc

        if isinstance(logs, list):
            for lg in logs:
                if not isinstance(lg, dict) or lg.get("removed"):
                    continue
                data_hex = str(lg.get("data") or "0x0")
                tx_hash = str(lg.get("transactionHash") or "").strip()
                blk_hex = str(lg.get("blockNumber") or "0x0")
                if not tx_hash or not data_hex.startswith("0x"):
                    continue
                try:
                    val_int = int(data_hex, 16)
                    blk_num = int(blk_hex, 16)
                except ValueError:
                    continue
                if val_int <= 0 or (wanted_units and val_int not in wanted_units):
                    continue
                ts_sec = _resolve_evm_block_ts(chain, ordered_rpcs, blk_num, lg)
                out.append(ChainTransfer(tx_hash=tx_hash, amount_units=val_int, timestamp_sec=ts_sec))

        cur = end + 1

    _evm_block_cursor[cursor_key] = latest_block
    return out


# ============================ 订单匹配与轮询调度 ============================


def _utc_epoch(dt: datetime) -> int:
    return int((dt - datetime(1970, 1, 1)).total_seconds())
def _tx_already_used(db: Session, tx_hash: str) -> bool:
    if db.query(UsdtInvoice.id).filter(UsdtInvoice.tx_hash == tx_hash).first():
        return True
    if db.query(OrderPayment.id).filter(OrderPayment.trade_no == tx_hash).first():
        return True
    if db.query(Order.id).filter(Order.trade_no == tx_hash).first():
        return True
    return False


def poll_pending_usdt_invoices(*, only_payment_id: Optional[str] = None) -> int:
    """扫描所有待支付（含宽限期内）的 USDT 锁定单，匹配链上到账并自动发货。返回本次成交笔数。"""
    if not _scan_lock.acquire(blocking=False):
        return 0

    settled_count = 0
    try:
        db = SessionLocal()
        try:
            now = datetime.utcnow()
            grace_cutoff = now - COOLDOWN_GRACE

            # 将彻底超过宽限期的 pending 锁定单归档为 expired
            db.query(UsdtInvoice).filter(
                UsdtInvoice.status == "pending",
                UsdtInvoice.expires_at < grace_cutoff,
            ).update({"status": "expired"}, synchronize_session=False)
            db.commit()

            active_invoices: List[UsdtInvoice] = (
                db.query(UsdtInvoice)
                .filter(
                    UsdtInvoice.status == "pending",
                    UsdtInvoice.expires_at >= grace_cutoff,
                )
                .all()
            )
            if not active_invoices:
                return 0

            # 若指定了单笔即时查账，仅扫描该笔涉及的链与钱包，但仍带上同钱包所有待付单以免推进区块游标时漏单
            target_wallets: Optional[Set[Tuple[str, str]]] = None
            if only_payment_id:
                target_wallets = {
                    (inv.chain, inv.address_key)
                    for inv in active_invoices
                    if inv.payment_id == only_payment_id
                }
                if not target_wallets:
                    return 0

            # 预加载关联渠道配置
            channel_ids = {inv.channel_id for inv in active_invoices}
            channels = {
                ch.id: parse_config(ch.config_json)
                for ch in db.query(PaymentChannel).filter(PaymentChannel.id.in_(channel_ids)).all()
            }

            # 按 (chain, address_key, channel_id) 分组，每个钱包每轮只查一次链上接口
            groups: Dict[Tuple[str, str, str], List[UsdtInvoice]] = {}
            for inv in active_invoices:
                if target_wallets is not None and (inv.chain, inv.address_key) not in target_wallets:
                    continue
                groups.setdefault((inv.chain, inv.address_key, inv.channel_id), []).append(inv)

            for (chain, _addr_key, channel_id), inv_list in groups.items():
                spec = USDT_CHAINS_BY_ID.get(chain)
                if not spec:
                    continue
                raw_cfg = channels.get(channel_id) or {}
                cfg = UsdtConfig(**raw_cfg) if raw_cfg else UsdtConfig()
                chain_cfg = cfg.chains.get(chain)
                custom_rpc = chain_cfg.rpc_url.strip() if chain_cfg else ""
                sample_address = inv_list[0].address
                oldest_created = min(i.created_at for i in inv_list)
                wanted_units = {int(i.amount_units) for i in inv_list if str(i.amount_units).isdigit()}
                if not wanted_units:
                    continue

                try:
                    if spec["kind"] == "tron":
                        min_ts = _utc_epoch(oldest_created) - TX_EARLY_SKEW_SEC
                        transfers = _scan_tron_transfers(
                            sample_address,
                            contract=spec["contract"],
                            rpc_url=custom_rpc,
                            api_key=cfg.trongrid_api_key,
                            min_ts_sec=min_ts,
                        )
                    else:
                        transfers = _scan_evm_transfers(
                            chain,
                            sample_address,
                            contract=spec["contract"],
                            default_rpcs=list(spec["default_rpcs"]),
                            custom_rpc=custom_rpc,
                            oldest_created_at=oldest_created,
                            wanted_units=wanted_units,
                        )
                except Exception as exc:
                    logger.warning("扫描 %s (%s) 链上记录失败: %s", chain, sample_address[:10], exc)
                    continue

                if not transfers:
                    continue

                # 按金额匹配待支付锁定单
                by_units: Dict[int, List[UsdtInvoice]] = {}
                for inv in inv_list:
                    by_units.setdefault(int(inv.amount_units), []).append(inv)

                for tr in transfers:
                    candidates = by_units.get(tr.amount_units)
                    if not candidates:
                        continue
                    if _tx_already_used(db, tr.tx_hash):
                        continue

                    matched_inv: Optional[UsdtInvoice] = None
                    for cand in candidates:
                        if cand.status != "pending":
                            continue
                        cand_min_ts = _utc_epoch(cand.created_at) - TX_EARLY_SKEW_SEC
                        cand_max_ts = _utc_epoch(cand.expires_at + COOLDOWN_GRACE)
                        if cand_min_ts <= tr.timestamp_sec <= cand_max_ts:
                            matched_inv = cand
                            break

                    if not matched_inv:
                        continue

                    order, payment = _resolve_target(db, matched_inv.payment_id)
                    if not order:
                        matched_inv.status = "closed"
                        db.commit()
                        continue

                    matched_inv.status = "paid"
                    matched_inv.tx_hash = tr.tx_hash
                    matched_inv.paid_at = datetime.utcnow()

                    # 关闭同一支付单在其他链上的备用锁定记录
                    db.query(UsdtInvoice).filter(
                        UsdtInvoice.payment_id == matched_inv.payment_id,
                        UsdtInvoice.id != matched_inv.id,
                        UsdtInvoice.status == "pending",
                    ).update({"status": "closed"}, synchronize_session=False)

                    settle_order_payment(
                        db,
                        order,
                        payment,
                        trade_no=tr.tx_hash,
                        payment_method=f"usdt_{chain}",
                    )
                    settled_count += 1
                    logger.info(
                        "USDT 自动到账发货成功：order=%s chain=%s amount=%s tx=%s",
                        order.id,
                        chain,
                        matched_inv.amount_usdt,
                        tr.tx_hash,
                    )
        finally:
            db.close()
    finally:
        _scan_lock.release()

    return settled_count


def trigger_manual_check(payment_id: str) -> None:
    """买家点击「我已转账」时触发即时扫描，带 4 秒冷却防刷接口。"""
    now = time.monotonic()
    last = _manual_check_ts.get(payment_id, 0.0)
    if now - last < 4.0:
        return
    if len(_manual_check_ts) > 2000:
        _manual_check_ts.clear()
    _manual_check_ts[payment_id] = now
    poll_pending_usdt_invoices(only_payment_id=payment_id)
