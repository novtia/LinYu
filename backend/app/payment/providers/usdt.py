from __future__ import annotations

import hashlib
import re
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException
from pydantic import BaseModel, Field

from .base import BasePaymentProvider

_BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
_BASE58_MAP = {c: i for i, c in enumerate(_BASE58_ALPHABET)}
_EVM_ADDR_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")

# 日常主流 USDT 网络元数据（官方合约地址与精度固定，防止假币攻击）
USDT_CHAIN_SPECS: Tuple[Dict[str, Any], ...] = (
    {
        "id": "trc20",
        "name": "TRC20",
        "full_name": "Tron (TRC20)",
        "kind": "tron",
        "contract": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        "decimals": 6,
        "badge": "推荐 · 最常用",
        "hint": "波场网络 · 交易所/钱包均支持",
        "explorer_tx": "https://tronscan.org/#/transaction/{tx}",
        "default_rpcs": ["https://api.trongrid.io"],
    },
    {
        "id": "bep20",
        "name": "BEP20",
        "full_name": "BNB Smart Chain (BEP20)",
        "kind": "evm",
        "contract": "0x55d398326f99059fF775485246999027B3197955",
        "decimals": 18,
        "badge": "极低手续费",
        "hint": "币安智能链 · 约 3 秒确认",
        "explorer_tx": "https://bscscan.com/tx/{tx}",
        "default_rpcs": [
            "https://bsc-rpc.publicnode.com",
            "https://bsc-dataseed.binance.org",
            "https://bsc-dataseed1.defibit.io",
        ],
    },
    {
        "id": "polygon",
        "name": "Polygon",
        "full_name": "Polygon PoS",
        "kind": "evm",
        "contract": "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
        "decimals": 6,
        "badge": "极低手续费",
        "hint": "Polygon 网络 · 秒级到账",
        "explorer_tx": "https://polygonscan.com/tx/{tx}",
        "default_rpcs": [
            "https://polygon-bor-rpc.publicnode.com",
            "https://polygon-rpc.com",
        ],
    },
    {
        "id": "arbitrum",
        "name": "Arbitrum",
        "full_name": "Arbitrum One",
        "kind": "evm",
        "contract": "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
        "decimals": 6,
        "badge": "以太坊 L2",
        "hint": "Arbitrum One · 秒级确认",
        "explorer_tx": "https://arbiscan.io/tx/{tx}",
        "default_rpcs": [
            "https://arbitrum-one-rpc.publicnode.com",
            "https://arb1.arbitrum.io/rpc",
        ],
    },
    {
        "id": "optimism",
        "name": "Optimism",
        "full_name": "OP Mainnet",
        "kind": "evm",
        "contract": "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
        "decimals": 6,
        "badge": "以太坊 L2",
        "hint": "OP Mainnet · 低 Gas 确认快",
        "explorer_tx": "https://optimistic.etherscan.io/tx/{tx}",
        "default_rpcs": [
            "https://optimism-rpc.publicnode.com",
            "https://mainnet.optimism.io",
        ],
    },
    {
        "id": "erc20",
        "name": "ERC20",
        "full_name": "Ethereum (ERC20)",
        "kind": "evm",
        "contract": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        "decimals": 6,
        "badge": "主网通用",
        "hint": "以太坊主网 · 大额稳妥",
        "explorer_tx": "https://etherscan.io/tx/{tx}",
        "default_rpcs": [
            "https://ethereum-rpc.publicnode.com",
            "https://cloudflare-eth.com",
        ],
    },
)

USDT_CHAINS_BY_ID: Dict[str, Dict[str, Any]] = {c["id"]: c for c in USDT_CHAIN_SPECS}
USDT_CHAIN_ORDER: List[str] = [c["id"] for c in USDT_CHAIN_SPECS]


def is_valid_tron_address(addr: str) -> bool:
    """校验波场 T 开头 34 位 Base58Check 地址（0x41 前缀 + 双 SHA256 校验和）。"""
    s = (addr or "").strip()
    if len(s) != 34 or not s.startswith("T"):
        return False
    num = 0
    for ch in s:
        val = _BASE58_MAP.get(ch)
        if val is None:
            return False
        num = num * 58 + val
    try:
        raw = num.to_bytes(25, byteorder="big")
    except OverflowError:
        return False
    if raw[0] != 0x41:
        return False
    chk = hashlib.sha256(hashlib.sha256(raw[:21]).digest()).digest()[:4]
    return raw[21:] == chk


def is_valid_evm_address(addr: str) -> bool:
    return bool(_EVM_ADDR_RE.match((addr or "").strip()))


def is_valid_chain_address(chain: str, addr: str) -> bool:
    spec = USDT_CHAINS_BY_ID.get(chain)
    if not spec:
        return False
    if spec["kind"] == "tron":
        return is_valid_tron_address(addr)
    return is_valid_evm_address(addr)


def normalize_address_key(chain: str, addr: str) -> str:
    """用于数据库索引比对的标准地址键：Tron 区分大小写，EVM 统一小写。"""
    s = (addr or "").strip()
    spec = USDT_CHAINS_BY_ID.get(chain)
    if spec and spec["kind"] == "tron":
        return s
    return s.lower()


class UsdtChainItem(BaseModel):
    enabled: bool = False
    address: str = ""
    rpc_url: str = ""


class UsdtMethods(BaseModel):
    usdt: bool = True


def _default_chains() -> Dict[str, UsdtChainItem]:
    out: Dict[str, UsdtChainItem] = {}
    for spec in USDT_CHAIN_SPECS:
        cid = spec["id"]
        out[cid] = UsdtChainItem(enabled=(cid in ("trc20", "bep20")))
    return out


class UsdtConfig(BaseModel):
    rate_mode: str = "auto"  # auto | fixed
    fixed_rate: float = 7.20  # 1 USDT = ? CNY（auto 模式下作为兜底汇率）
    rate_markup_pct: float = 0.0  # 汇率浮动百分比，如 -1 表示按低 1% 汇率折算
    expire_minutes: int = 20  # 金额尾数锁定有效期（分钟）
    trongrid_api_key: str = ""  # 可选 TronGrid API Key（高并发防限流）
    chains: Dict[str, UsdtChainItem] = Field(default_factory=_default_chains)
    methods: UsdtMethods = Field(default_factory=UsdtMethods)


def enabled_valid_chains(config: Dict[str, Any]) -> List[Tuple[str, UsdtChainItem, Dict[str, Any]]]:
    cfg = UsdtConfig(**(config or {}))
    result: List[Tuple[str, UsdtChainItem, Dict[str, Any]]] = []
    for cid in USDT_CHAIN_ORDER:
        item = cfg.chains.get(cid)
        spec = USDT_CHAINS_BY_ID.get(cid)
        if not item or not spec or not item.enabled:
            continue
        addr = item.address.strip()
        if addr and is_valid_chain_address(cid, addr):
            result.append((cid, item, spec))
    return result


class UsdtProvider(BasePaymentProvider):
    """自托管多链 USDT 直收：固定钱包 + 唯一小数尾数虚拟识别 + 链上自动监听发货。"""

    id = "usdt"
    name = "USDT 自托管收款"
    desc = "支持 TRC20 / BEP20 / Polygon / Arbitrum / Optimism / ERC20。只需填写收款地址，自动分配唯一小数尾数并监听链上到账自动发货，0 手续费、不存私钥。"
    docs = ""

    def default_config(self) -> Dict[str, Any]:
        return UsdtConfig().model_dump()

    def normalize_config(self, config: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        raw = dict(config or {})
        raw_chains = raw.get("chains")
        merged_chains = _default_chains()
        if isinstance(raw_chains, dict):
            for cid in USDT_CHAIN_ORDER:
                entry = raw_chains.get(cid)
                if isinstance(entry, dict):
                    merged_chains[cid] = UsdtChainItem(
                        enabled=bool(entry.get("enabled", False)),
                        address=str(entry.get("address") or "").strip(),
                        rpc_url=str(entry.get("rpc_url") or "").strip(),
                    )
        raw["chains"] = merged_chains

        cfg = UsdtConfig(**raw)
        if cfg.rate_mode not in ("auto", "fixed"):
            cfg.rate_mode = "auto"
        try:
            cfg.fixed_rate = round(float(cfg.fixed_rate), 4)
        except (TypeError, ValueError):
            cfg.fixed_rate = 7.20
        if cfg.fixed_rate <= 0.1 or cfg.fixed_rate > 100:
            raise HTTPException(status_code=400, detail="USDT 汇率需在 0.1 ~ 100 之间")

        try:
            cfg.rate_markup_pct = round(float(cfg.rate_markup_pct), 2)
        except (TypeError, ValueError):
            cfg.rate_markup_pct = 0.0
        cfg.rate_markup_pct = max(-30.0, min(30.0, cfg.rate_markup_pct))

        try:
            cfg.expire_minutes = int(cfg.expire_minutes)
        except (TypeError, ValueError):
            cfg.expire_minutes = 20
        cfg.expire_minutes = max(10, min(60, cfg.expire_minutes))
        cfg.trongrid_api_key = (cfg.trongrid_api_key or "").strip()

        # 校验已勾选网络的收款地址格式，防止填错链地址导致丢币
        for cid in USDT_CHAIN_ORDER:
            item = cfg.chains.get(cid)
            spec = USDT_CHAINS_BY_ID[cid]
            if not item:
                continue
            addr = item.address.strip()
            if item.enabled and not addr:
                raise HTTPException(status_code=400, detail=f"请填写 {spec['name']} 网络的收款地址，或先关闭该网络")
            if addr and not is_valid_chain_address(cid, addr):
                expect = "T 开头的 34 位波场地址" if spec["kind"] == "tron" else "0x 开头的 42 位 EVM 地址"
                raise HTTPException(status_code=400, detail=f"{spec['name']} 收款地址格式不正确（应为 {expect}）")

        return cfg.model_dump()

    def enabled_methods(self, config: Dict[str, Any]) -> List[str]:
        methods = (config or {}).get("methods") or {}
        if methods.get("usdt", True) and enabled_valid_chains(config):
            return ["usdt"]
        return []

    def secret_fields(self) -> List[str]:
        return ["trongrid_api_key"]

    def is_ready(self, config: Dict[str, Any]) -> bool:
        return bool(self.enabled_methods(config))

    def build_pay_url(
        self,
        config: Dict[str, Any],
        *,
        money: float,
        name: str,
        out_trade_no: str,
        pay_type: str,
        notify_url: str,
        return_url: str,
    ) -> str:
        return f"/pay/usdt/{out_trade_no}"
