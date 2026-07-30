# 领匣 · 虚拟商品在线售卖

基于 Demo 完整还原的前后端分离项目：卡密 / 兑换码 / 数字文件售卖，模拟支付后自动发货。

## 技术栈

- **前端**：React + Vite + Tailwind CSS + React Router
- **后端**：FastAPI + SQLAlchemy + SQLite
- **鉴权**：JWT + bcrypt，图形验证码

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

## 启动前端

```bash
cd frontend
npm install
npm run dev
```

访问：http://127.0.0.1:5173

前端已配置 `/api` 代理到后端 `8001` 端口。

## 默认账号

| 角色 | 用户名 | 密码 |
|------|--------|------|
| 管理员 | admin | admin123 |

## 主要功能

- 商城浏览、分类筛选、领取匣加购
- 登录 / 注册（图形验证码）
- 模拟支付并自动发货（卡密 / 下载链接写入领取匣）
- **数字文件上传与鉴权下载**（管理台上传，购买后领取匣/订单可下载）
- 我的订单查看发放内容
- 管理台：概览、商品、用户、订单、发放、支付/系统/网站设置
- 维护模式拦截下单、关闭注册拦截注册

## 说明

一期支付为模拟流程。卡密按规则即时生成；数字文件商品可上传真实文件（最大 50MB），付款后买家凭登录态下载。
