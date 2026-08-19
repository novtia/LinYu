from __future__ import annotations

from pathlib import Path

# 在任何子模块读取环境变量之前加载 backend/.env。
# 已存在的真实环境变量优先（override=False）；未安装 python-dotenv 时静默跳过。
try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)
except ImportError:
    pass
