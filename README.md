# 领匣 · 虚拟商品在线售卖

卡密 / 兑换码 / 数字文件售卖。对接易支付完成真实收款，支付成功后自动发货。

## 技术栈

- **前端**：React + Vite + Tailwind CSS + React Router
- **后端**：FastAPI + SQLAlchemy + SQLite
- **鉴权**：JWT + bcrypt，图形验证码
- **支付**：易支付（页面跳转 `submit.php` + 异步通知发货）

## 目录结构

```
lingxia/
  frontend/   # React 应用
  backend/    # FastAPI 应用
  README.md
```

## 启动后端

```bash
cd backend
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

API 文档：http://127.0.0.1:8001/docs

环境变量（模板见 `backend/.env.example`，启动时会自动加载 `backend/.env`）：

- `JWT_SECRET`：JWT 签名密钥。**生产必填**；未设置时使用进程随机密钥（重启掉登录态），
  且 `LINGXIA_ENV=production` 时会直接拒绝启动
- `LINGXIA_ENV`：设为 `production` 启用启动强校验
- `FRONTEND_URL`：支付同步回跳后的前台地址（默认 `http://127.0.0.1:5173`）
- `PUBLIC_BASE_URL`：后端公网地址，用于生成支付回调地址；配置后不再依赖请求 Host 头，公网部署建议填写
- `TRUST_PROXY_HEADERS`：源站仅经 Cloudflare / Nginx 等代理访问时设为 `true`，限流才会读取转发头中的客户端 IP
- `ADMIN_INITIAL_PASSWORD`：首次建库时的管理员密码，留空则随机生成并打印到日志

## 启动前端

```bash
cd frontend
npm install
npm run dev
```

访问：http://127.0.0.1:5173

前端已配置 `/api` 代理到后端 `8001` 端口。

## 默认账号

首次启动（空库）会创建管理员 `admin`，密码取自 `ADMIN_INITIAL_PASSWORD`；未配置时随机生成并
打印在启动日志中（`journalctl -u lingxia` 可查），仅输出一次，请立即登录修改。

初始化不会写入演示商品。请在管理台自行添加商品与支付渠道。

## 数据备份

`scripts/backup.sh` 会打包 SQLite、上传文件与 `.env`。部署到服务器后加 cron 每日执行：

```bash
0 4 * * * /opt/lingxia/backup.sh >> /var/log/lingxia-backup.log 2>&1
```

## 支付配置

1. 管理台 → 支付接入 → 添加易支付渠道（pid / key / 网关）
2. 启用支付宝 / 微信 / QQ 等支付方式
3. `notify_url` / `return_url` 可留空：系统会自动使用当前站点的  
   `/api/pay/ezpay/notify` 与 `/api/pay/ezpay/return`  
   （公网部署时请配置可被易支付访问的域名，或在渠道中填写完整回调地址）

下单流程：创建待支付订单 → 跳转易支付 → 异步通知验签 → 自动发货 → 同步回跳订单页。

## 主要功能

- 商城浏览、分类筛选、购物车（本地持久化）
- 登录 / 注册（图形验证码 + 邮箱验证码）、登录与验证码限流
- 易支付 / 支付宝收款，回调验签与金额校验后自动发货
- 数字文件上传与鉴权下载（付费文件不生成公开直链）
- 我的订单查看发放内容
- 管理台：概览、商品、用户、订单、发放、支付/系统/网站设置
- 维护模式拦截下单、关闭注册拦截注册
