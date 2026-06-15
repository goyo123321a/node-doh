🚀 DoH Server – 多协议 DNS over HTTPS 代理

一个功能完整的 DNS over HTTPS (DoH) 代理服务器，支持多种上游协议（DoH / DNS-over-TLS / TCP / UDP）、自动故障转移、手动上游切换，并提供美观的 Web 管理面板。

✨ 特性

· ✅ 标准 DoH 端点（兼容 RFC 8484）
    支持 GET、POST JSON、POST 表单、DNS Wire Format 等请求方式
· ✅ 37+ 内置公共 DNS 上游（Cloudflare、Google、阿里云、腾讯云、Quad9、DNS.SB 等）
· ✅ 自动健康检查 + 故障转移（每 30 秒检测，按响应时间排序，自动切换至最快上游）
· ✅ 手动上游切换（支持自动模式 / 手动模式）
· ✅ 多协议上游（DoH / DoT / TCP / UDP 混合使用）
· ✅ Web 管理面板
    查看上游状态、响应时间、手动切换、DNS 查询工具
· ✅ 丰富的 DNS 记录类型
    A, AAAA, CNAME, MX, TXT, NS, SOA, PTR, SRV, CAA
· ✅ IP 地理位置查询 API（/api/ip-info，使用 ip-api.com）
· ✅ 可自定义 DoH 路径（通过环境变量 DOH_PATH）
· ✅ 一键部署：Docker、Node.js 原生、Hugging Face Spaces

📦 快速开始

1. 使用 Docker

```bash
docker run -p 7860:7860 ghcr.io/goyo1233321a/node-dot:latest
```

2. 使用 Node.js

```bash
git clone https://goyo1233321a/node-dot:latest
cd doh-server
npm install
npm start
```

服务将在 http://localhost:7860 启动。

🔧 环境变量

变量 说明 默认值
DOH_PATH DoH 服务端点路径 dns-query
TOKEN ①备选 DoH 路径；②/api/ip-info 认证 dns-query
DOH 上游 DNS 服务器列表（逗号分隔） 内置 25 个公共 DNS
ENABLED_PROTOCOLS 启用的协议（doh,dot,tcp,udp） 全部
ENABLED_UPSTREAMS 启用的上游名称（逗号分隔） all
PORT 监听端口 7860

🌐 API 端点

方法 路径 说明
GET /{DOH_PATH}?name=域名&type=记录类型 DoH 查询（JSON）
POST /{DOH_PATH} JSON / 表单 / DNS Wire Format 请求
GET /api/upstreams 获取上游状态
POST /api/switch/:id 手动切换到指定上游
POST /api/auto 切换回自动模式
POST /api/healthcheck 手动触发健康检查
GET /api/ip-info?ip=IP&token=xxx IP 地理位置
GET / Web 管理面板
GET /health 健康检查端点

📘 使用示例

```bash
# GET 查询 A 记录
curl "https://your-space.hf.space/dns-query?name=google.com&type=A"

# POST JSON 查询 AAAA 记录
curl -X POST -H "Content-Type: application/dns-json" \
     -d '{"name":"google.com","type":"AAAA"}' \
     "https://your-space.hf.space/dns-query"

# POST 表单查询 MX 记录
curl -X POST -H "Content-Type: application/x-www-form-urlencoded" \
     -d "name=google.com&type=MX" \
     "https://your-space.hf.space/dns-query"
```

🐳 部署到 Hugging Face Spaces

1. 创建新 Space，选择 Docker 运行时
2. 上传以下文件：
   · Dockerfile
   · package.json
   · index.js
3. Space 自动构建并运行

📄 许可证

MIT

---
