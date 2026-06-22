# 🚀 DoH Server – 多协议 DNS over HTTPS 代理

一个功能完整的 **DNS over HTTPS (DoH)** 代理服务器，支持多种上游协议（DoH / DNS-over-TLS / TCP / UDP）、自动故障转移、手动上游切换，并提供美观的 Web 管理面板。

## ✨ 特性

- ✅ 标准 DoH 端点（兼容 [RFC 8484](https://datatracker.ietf.org/doc/html/rfc8484)）  
  支持 `GET`、`POST JSON`、`POST 表单`、`DNS Wire Format` 等请求方式
- ✅ **37+ 内置公共 DNS 上游**（Cloudflare、Google、阿里云、腾讯云、Quad9、DNS.SB 等）
- ✅ **自动健康检查 + 故障转移**（每 30 秒检测，按响应时间排序，自动切换至最快上游）
- ✅ **手动上游切换**（支持自动模式 / 手动模式）
- ✅ **多协议上游**（DoH / DoT / TCP / UDP 混合使用）
- ✅ **Web 管理面板**  
  查看上游状态、响应时间、手动切换、DNS 查询工具
- ✅ **丰富的 DNS 记录类型**  
  `A`, `AAAA`, `CNAME`, `MX`, `TXT`, `NS`, `SOA`, `PTR`, `SRV`, `CAA`
- ✅ **IP 地理位置查询 API**（`/api/ip-info`，使用 `ip-api.com`）
- ✅ **可自定义 DoH 路径**（通过环境变量 `DOH_PATH`）
- ✅ **一键部署**：Docker、Node.js 原生、Hugging Face Spaces

## 📦 快速开始

### 1. 使用 Docker

```bash
docker run -d -p 7860:7860 --name doh-server ghcr.io/goyo1233321a/node-dot:latest
```

2. 使用 Node.js

```bash
git clone https://github.com/goyo1233321a/node-dot.git
cd node-dot
npm install
npm start
```

服务将在 http://localhost:7860 启动。

🔧 环境变量

### 📋 环境变量

| 变量名 | 是否必须 | 默认值 | 说明 |
|--------|----------|--------|------|
| DOH_PATH | 否 | dns-query |  服务端点路径（优先级最高） dns-query my-dns, query, doh |
| TOKEN | 否 | dns-query | 备选 DoH 路径 |
| ADMIN_USER | 否 | admin | 管理员登录用户名 admin |
| ADMIN_PASS | 否 | 123321 | 管理员登录密码 123321 |
| SESSION_SECRET | 否 | doh-server-secret-key | Session 加密密钥（用于登录状态）随机字符串如abc123xyz |
| PORT | 是 | 7860 | 服务监听端口（Hugging Face 要求 7860） |

 使用示例
# GET 请求 - A记录 (IPv4)
```
curl -H "accept: application/dns-json" \
  "https://zwmztkpw-wzvigdwr.hf.space/123a?name=google.com&type=A"
```

# GET 请求 - HTTPS记录 (ECH配置)
```
curl -H "accept: application/dns-json" \
  "https://zwmztkpw-wzvigdwr.hf.space/123a?name=cloudflare-ech.com&type=HTTPS"
```

 # GET 请求 – Wire Format（?dns=）
# 查询 google.com A 记录（Base64URL 编码示例）
```
curl -H "accept: application/dns-message" \
  "https://hcfcwwba-oleksxxr.hf.space/node-doh?dns=AAABAAABAAAAAAAAB2V4YW1wbGUDY29tAAABAAE"
```
预期：返回二进制 DNS 数据（终端会显示乱码，这是正常的）。
验证响应头：content-type: application/dns-message

# POST 请求 - JSON格式 (A记录)
```
curl -X POST -H "Content-Type: application/dns-json" \
  -d '{"name":"google.com","type":"A"}' \
  "https://zwmztkpw-wzvigdwr.hf.space/123a"
```

# POST 请求 - 表单格式 (A记录)
```
curl -X POST -H "Content-Type: application/x-www-form-urlencoded" \
  -d "name=google.com&type=A" \
  "https://zwmztkpw-wzvigdwr.hf.space/123a"
```

# 浏览器访问 (直接显示JSON)
https://zwmztkpw-wzvigdwr.hf.space/123a?name=google.com&type=A

# 浏览器配置 DoH
Chrome/Edge: 设置 → 隐私和安全 → 安全 → 使用安全 DNS → 自定义
填入: https://zwmztkpw-wzvigdwr.hf.space/123a
MIT

```
