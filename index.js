const express = require('express');
const dns = require('dns');
const { Resolver } = require('dns').promises;
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 7860;

// ============ 管理员配置 ============
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || '123321';
const SESSION_SECRET = process.env.SESSION_SECRET || 'doh-server-secret-key';

// ============ Session 配置 ============
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// ============ DoH 路径配置 ============
let DoH路径 = process.env.DOH_PATH || process.env.TOKEN || 'dns-query';

if (DoH路径.includes("/")) {
  const parts = DoH路径.split("/");
  DoH路径 = parts[parts.length - 1];
}

if (!DoH路径 || DoH路径.length === 0 || DoH路径 === 'undefined') {
  DoH路径 = 'dns-query';
}

DoH路径 = DoH路径.replace(/[^a-zA-Z0-9\-_]/g, '');

console.log(`📡 DoH 端点路径: /${DoH路径}`);

// ============ DNS 记录类型映射 ============
const recordTypeMap = {
  'A': 1, 'AAAA': 28, 'CNAME': 5, 'MX': 15, 'TXT': 16, 'NS': 2,
  'SOA': 6, 'PTR': 12, 'SRV': 33, 'CAA': 257, 'HTTPS': 65, 'ANY': 255
};

// ============ 多协议 DNS 上游配置 ============
const upstreamsConfig = [
  { name: "alidns-doh", display: "阿里云", server: "https://dns.alidns.com/dns-query", protocol: "doh", region: "中国", type: "DoH", priority: 1 },
  { name: "cloudflare-doh", display: "Cloudflare", server: "https://cloudflare-dns.com/dns-query", protocol: "doh", region: "全球", type: "DoH", priority: 2 },
  { name: "google-doh", display: "Google", server: "https://dns.google/dns-query", protocol: "doh", region: "全球", type: "DoH", priority: 3 },
  { name: "quad9-doh", display: "Quad9", server: "https://dns.quad9.net/dns-query", protocol: "doh", region: "全球", type: "DoH", priority: 4 },
  { name: "tencent-doh", display: "腾讯云", server: "https://doh.pub/dns-query", protocol: "doh", region: "中国", type: "DoH", priority: 5 },
  { name: "360-doh", display: "360", server: "https://doh.360.cn/dns-query", protocol: "doh", region: "中国", type: "DoH", priority: 6 },
  { name: "adguard-doh", display: "AdGuard", server: "https://dns.adguard-dns.com/dns-query", protocol: "doh", region: "全球", type: "DoH+去广告", priority: 7 },
  { name: "dns-sb-doh", display: "DNS.SB", server: "https://dns.sb/dns-query", protocol: "doh", region: "全球", type: "DoH", priority: 8 },
  { name: "cloudflare-dot", display: "Cloudflare", server: "1.1.1.1", protocol: "dot", port: 853, region: "全球", type: "DoT", priority: 10 },
  { name: "google-dot", display: "Google", server: "8.8.8.8", protocol: "dot", port: 853, region: "全球", type: "DoT", priority: 11 },
  { name: "quad9-dot", display: "Quad9", server: "9.9.9.9", protocol: "dot", port: 853, region: "全球", type: "DoT", priority: 12 },
  { name: "alidns-dot", display: "阿里云", server: "223.5.5.5", protocol: "dot", port: 853, region: "中国", type: "DoT", priority: 13 },
  { name: "tencent-dot", display: "腾讯云", server: "119.29.29.29", protocol: "dot", port: 853, region: "中国", type: "DoT", priority: 14 },
  { name: "cloudflare-tcp", display: "Cloudflare", server: "1.1.1.1", protocol: "tcp", port: 53, region: "全球", type: "TCP", priority: 20 },
  { name: "google-tcp", display: "Google", server: "8.8.8.8", protocol: "tcp", port: 53, region: "全球", type: "TCP", priority: 21 },
  { name: "quad9-tcp", display: "Quad9", server: "9.9.9.9", protocol: "tcp", port: 53, region: "全球", type: "TCP", priority: 22 },
  { name: "alidns-tcp", display: "阿里云", server: "223.5.5.5", protocol: "tcp", port: 53, region: "中国", type: "TCP", priority: 23 },
  { name: "cloudflare-udp", display: "Cloudflare", server: "1.1.1.1", protocol: "udp", port: 53, region: "全球", type: "UDP", priority: 30 },
  { name: "google-udp", display: "Google", server: "8.8.8.8", protocol: "udp", port: 53, region: "全球", type: "UDP", priority: 31 },
  { name: "quad9-udp", display: "Quad9", server: "9.9.9.9", protocol: "udp", port: 53, region: "全球", type: "UDP", priority: 32 },
  { name: "opendns-udp", display: "OpenDNS", server: "208.67.222.222", protocol: "udp", port: 53, region: "全球", type: "UDP", priority: 33 },
  { name: "comodo-udp", display: "Comodo", server: "8.26.56.26", protocol: "udp", port: 53, region: "全球", type: "UDP", priority: 34 },
  { name: "alidns-udp", display: "阿里云", server: "223.5.5.5", protocol: "udp", port: 53, region: "中国", type: "UDP", priority: 35 },
  { name: "tencent-udp", display: "腾讯云", server: "119.29.29.29", protocol: "udp", port: 53, region: "中国", type: "UDP", priority: 36 },
  { name: "baidu-udp", display: "百度", server: "180.76.76.76", protocol: "udp", port: 53, region: "中国", type: "UDP", priority: 37 }
];

const enabledProtocols = (process.env.ENABLED_PROTOCOLS || 'doh,dot,tcp,udp').split(',');
const enabledUpstreamsEnv = process.env.ENABLED_UPSTREAMS || 'all';

let upstreamList = [];

if (enabledUpstreamsEnv === 'all') {
  upstreamList = upstreamsConfig.filter(u => enabledProtocols.includes(u.protocol));
} else {
  const enabledNames = enabledUpstreamsEnv.split(',').map(n => n.trim());
  upstreamList = upstreamsConfig.filter(u =>
    enabledNames.includes(u.name) || enabledNames.includes(u.display)
  );
  if (upstreamList.length === 0) upstreamList = upstreamsConfig.slice(0, 10);
}

// ============ 查询函数（DoH/DoT/TCP/UDP） ============
async function queryDoH(server, domain, type) {
  const url = new URL(server);
  url.searchParams.set("name", domain);
  url.searchParams.set("type", type);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url.toString(), {
      headers: { 'Accept': 'application/dns-json' },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      return { success: true, data: data };
    }
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
  return { success: false, data: null };
}

async function queryDoT(server, port, domain, type) {
  return new Promise((resolve, reject) => {
    const resolver = new Resolver();
    resolver.setServers([`${server}:${port}`]);

    const timeout = setTimeout(() => {
      resolver.cancel();
      reject(new Error('DoT 查询超时'));
    }, 5000);

    const dnsType = type === 'A' ? 'A' : type === 'AAAA' ? 'AAAA' : type;

    resolver.resolve(domain, dnsType).then(result => {
      clearTimeout(timeout);
      resolve({ success: true, answers: result });
    }).catch(err => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function queryTCP(server, port, domain, type) {
  return new Promise((resolve, reject) => {
    const resolver = new Resolver();
    resolver.setServers([`${server}:${port}`]);

    const timeout = setTimeout(() => {
      resolver.cancel();
      reject(new Error('TCP 查询超时'));
    }, 5000);

    const dnsType = type === 'A' ? 'A' : type === 'AAAA' ? 'AAAA' : type;

    resolver.resolve(domain, dnsType).then(result => {
      clearTimeout(timeout);
      resolve({ success: true, answers: result });
    }).catch(err => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function queryUDP(server, port, domain, type) {
  return new Promise((resolve, reject) => {
    const resolver = new Resolver();
    resolver.setServers([`${server}:${port}`]);

    const timeout = setTimeout(() => {
      resolver.cancel();
      reject(new Error('UDP 查询超时'));
    }, 5000);

    const dnsType = type === 'A' ? 'A' : type === 'AAAA' ? 'AAAA' : type;

    resolver.resolve(domain, dnsType).then(result => {
      clearTimeout(timeout);
      resolve({ success: true, answers: result });
    }).catch(err => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// 构建上游对象
const upstreams = upstreamList.map((config, index) => ({
  id: index,
  name: config.name,
  displayName: config.display,
  server: config.server,
  protocol: config.protocol,
  port: config.port,
  region: config.region,
  type: config.type,
  timeout: config.region === '中国' ? 2000 : 3000,
  status: 'checking',
  lastCheck: null,
  responseTime: null
}));

console.log(`\n🌐 配置上游总数: ${upstreams.length}`);
console.log(`📋 按协议分布:`);
const protocolCount = {};
upstreams.forEach(u => { protocolCount[u.protocol] = (protocolCount[u.protocol] || 0) + 1; });
Object.entries(protocolCount).forEach(([p, c]) => console.log(`   ${p.toUpperCase()}: ${c}个`));

// 当前选中的上游
let selectedUpstreamId = null;
let availableUpstreams = [...upstreams];
let currentUpstreamIndex = 0;
let healthCheckRunning = false;

// ============ 增强的过滤函数 ============
function sanitizeHeaderValue(value) {
  if (!value) return 'unknown';
  return String(value).replace(/[^a-zA-Z0-9 \-_.]/g, '').substring(0, 100);
}

// 健康检查
async function checkSingleUpstream(upstream) {
  const startTime = Date.now();
  try {
    let result;
    switch (upstream.protocol) {
      case 'doh':
        result = await queryDoH(upstream.server, 'google.com', 'A');
        break;
      case 'dot':
        result = await queryDoT(upstream.server, upstream.port, 'google.com', 'A');
        break;
      case 'tcp':
        result = await queryTCP(upstream.server, upstream.port, 'google.com', 'A');
        break;
      case 'udp':
        result = await queryUDP(upstream.server, upstream.port, 'google.com', 'A');
        break;
      default:
        throw new Error('未知协议');
    }

    const isOnline = result.success && (result.data?.Answer?.length > 0 || result.answers?.length > 0);
    upstream.status = isOnline ? 'online' : 'offline';
    upstream.lastCheck = new Date().toISOString();
    upstream.responseTime = isOnline ? Date.now() - startTime : null;

    if (isOnline && !availableUpstreams.find(u => u.id === upstream.id)) {
      availableUpstreams.push(upstream);
    } else if (!isOnline) {
      availableUpstreams = availableUpstreams.filter(u => u.id !== upstream.id);
    }

    if (isOnline) {
      console.log(`✅ ${upstream.displayName} (${upstream.protocol.toUpperCase()}) - ${upstream.responseTime}ms`);
    } else {
      console.log(`❌ ${upstream.displayName} (${upstream.protocol.toUpperCase()}) - 不可用`);
    }
    return isOnline;
  } catch (err) {
    upstream.status = 'offline';
    upstream.lastCheck = new Date().toISOString();
    upstream.responseTime = null;
    availableUpstreams = availableUpstreams.filter(u => u.id !== upstream.id);
    console.log(`❌ ${upstream.displayName} (${upstream.protocol.toUpperCase()}) - ${err.message}`);
    return false;
  }
}

async function healthCheck() {
  if (healthCheckRunning) return;
  healthCheckRunning = true;

  console.log(`\n🔍 开始健康检查 (${new Date().toLocaleTimeString()})`);

  const results = await Promise.all(upstreams.map(u => checkSingleUpstream(u)));
  const onlineCount = results.filter(r => r === true).length;

  if (availableUpstreams.length === 0) {
    availableUpstreams = [...upstreams];
  }

  availableUpstreams.sort((a, b) => (a.responseTime || 9999) - (b.responseTime || 9999));

  console.log(`📡 在线: ${onlineCount}/${upstreams.length}`);
  if (availableUpstreams[0]) {
    console.log(`📡 最快: ${availableUpstreams[0].displayName} (${availableUpstreams[0].responseTime}ms)`);
  }

  healthCheckRunning = false;
}

function getCurrentUpstream() {
  if (selectedUpstreamId !== null) {
    const selected = upstreams.find(u => u.id === selectedUpstreamId);
    if (selected && selected.status === 'online') {
      return selected;
    }
    selectedUpstreamId = null;
  }

  const onlineSorted = [...availableUpstreams].sort((a, b) => (a.responseTime || 9999) - (b.responseTime || 9999));
  if (onlineSorted.length > 0) {
    const upstream = onlineSorted[currentUpstreamIndex % onlineSorted.length];
    currentUpstreamIndex++;
    return upstream;
  }

  return upstreams[0];
}

// ============ 核心查询函数 ============
async function queryDNS(upstream, domain, type) {
  if (type === 'HTTPS') {
    let dohServer = upstream.server;
    if (upstream.protocol !== 'doh') {
      dohServer = 'https://cloudflare-dns.com/dns-query';
      console.log(`HTTPS 查询强制使用 DoH 备用服务器: ${dohServer}`);
    }
    const result = await queryDoH(dohServer, domain, type);
    if (result.success && result.data) {
      return { success: true, data: result.data };
    }
    return { success: false, data: null };
  }

  switch (upstream.protocol) {
    case 'doh': {
      const result = await queryDoH(upstream.server, domain, type);
      if (result.success && result.data) {
        return { success: true, data: result.data };
      }
      return { success: false, data: null };
    }
    case 'dot': {
      const result = await queryDoT(upstream.server, upstream.port, domain, type);
      if (result.success) {
        const answers = result.answers || [];
        return {
          success: true,
          data: {
            Answer: answers.map(a => ({ type: recordTypeMap[type] || 1, data: a }))
          }
        };
      }
      return { success: false, data: null };
    }
    case 'tcp': {
      const result = await queryTCP(upstream.server, upstream.port, domain, type);
      if (result.success) {
        const answers = result.answers || [];
        return {
          success: true,
          data: {
            Answer: answers.map(a => ({ type: recordTypeMap[type] || 1, data: a }))
          }
        };
      }
      return { success: false, data: null };
    }
    case 'udp': {
      const result = await queryUDP(upstream.server, upstream.port, domain, type);
      if (result.success) {
        const answers = result.answers || [];
        return {
          success: true,
          data: {
            Answer: answers.map(a => ({ type: recordTypeMap[type] || 1, data: a }))
          }
        };
      }
      return { success: false, data: null };
    }
    default:
      throw new Error(`未知协议: ${upstream.protocol}`);
  }
}

async function queryWithFallback(domain, type, retryCount = 0) {
  const maxRetries = upstreams.length;
  const upstream = getCurrentUpstream();

  try {
    const result = await queryDNS(upstream, domain, type);
    if (result.success && result.data && (result.data.Answer?.length > 0)) {
      return { success: true, data: result.data, upstream: upstream.displayName, protocol: upstream.protocol };
    }
  } catch (err) {
    console.log(`${upstream.displayName} 查询失败: ${err.message}`);
  }

  if (retryCount < maxRetries) {
    return queryWithFallback(domain, type, retryCount + 1);
  }

  return { success: false, data: null, upstream: null };
}

async function queryAllTypes(domain) {
  const types = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME'];
  const results = {};

  for (const type of types) {
    const result = await queryWithFallback(domain, type);
    if (result.success && result.data) {
      results[type] = result.data.Answer || [];
      if (!results.upstream) results.upstream = result.upstream;
    } else {
      results[type] = [];
    }
  }

  return results;
}

function getCurrentStatus() {
  return {
    upstreams: upstreams.map(u => ({
      id: u.id,
      name: u.name,
      displayName: u.displayName,
      protocol: u.protocol,
      region: u.region,
      type: u.type,
      status: u.status,
      responseTime: u.responseTime,
      lastCheck: u.lastCheck,
      selected: selectedUpstreamId === u.id
    })),
    mode: selectedUpstreamId === null ? 'auto' : 'manual',
    selectedId: selectedUpstreamId,
    currentUpstream: getCurrentUpstream().displayName,
    availableCount: availableUpstreams.length,
    totalCount: upstreams.length,
    protocolStats: availableUpstreams.reduce((acc, u) => {
      acc[u.protocol] = (acc[u.protocol] || 0) + 1;
      return acc;
    }, {})
  };
}

// ============ 辅助函数 ============
function formatDNSResponse(data, domain, type) {
  if (data.Status !== undefined || data.Status === 0) {
    return data;
  }
  const typeNum = recordTypeMap[type] || 1;
  return {
    Status: 0,
    TC: false,
    RD: true,
    RA: true,
    AD: false,
    CD: false,
    Question: [{ name: domain, type: typeNum, class: 1 }],
    Answer: data.Answer || []
  };
}

function setJsonHeaders(res) {
  res.set('Content-Type', 'application/json');
  res.set('Content-Disposition', 'inline');
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
}

function getDoHEndpoint(upstream) {
  if (upstream.protocol === 'doh') {
    return upstream.server;
  }
  const fallback = process.env.FALLBACK_DOH || 'https://dns.alidns.com/dns-query';
  console.log(`Wire format 使用备用 DoH: ${fallback}`);
  return fallback;
}

// ============ 中间件 ============
app.use(express.json({ type: 'application/dns-json' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.raw({ type: 'application/dns-message', limit: '10mb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// ============ 登录验证中间件 ============
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    next();
  } else {
    res.redirect('/admin/login');
  }
}

// ============ 管理员路由（与之前相同，未改动） ============
app.get('/admin/login', (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>管理员登录 - DoH Server</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }
    .login-card {
      background: white;
      border-radius: 16px;
      padding: 40px;
      width: 100%;
      max-width: 400px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    }
    .login-card h1 {
      color: #667eea;
      margin-bottom: 30px;
      text-align: center;
    }
    .input-group {
      margin-bottom: 20px;
    }
    .input-group label {
      display: block;
      margin-bottom: 8px;
      color: #555;
      font-weight: 500;
    }
    .input-group input {
      width: 100%;
      padding: 12px 15px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 16px;
    }
    .input-group input:focus {
      outline: none;
      border-color: #667eea;
    }
    button {
      width: 100%;
      padding: 12px;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: bold;
      cursor: pointer;
    }
    button:hover { background: #5a67d8; }
    .error {
      background: #ffebee;
      color: #f44336;
      padding: 10px;
      border-radius: 8px;
      margin-bottom: 20px;
      text-align: center;
    }
    .footer {
      text-align: center;
      margin-top: 20px;
      color: #999;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="login-card">
    <h1>🔐 管理员登录</h1>
    ${req.query.error ? '<div class="error">用户名或密码错误</div>' : ''}
    <form method="POST" action="/admin/login">
      <div class="input-group">
        <label>用户名</label>
        <input type="text" name="username" required autofocus>
      </div>
      <div class="input-group">
        <label>密码</label>
        <input type="password" name="password" required>
      </div>
      <button type="submit">登 录</button>
    </form>
    <div class="footer">DoH Server Admin Panel</div>
  </div>
</body>
</html>`;
  res.send(html);
});

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.isAdmin = true;
    res.redirect('/admin');
  } else {
    res.redirect('/admin/login?error=1');
  }
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

app.get('/admin', requireAdmin, (req, res) => {
  const hostname = req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const currentDohUrl = `${protocol}://${hostname}/${DoH路径}`;
  const homeUrl = `${protocol}://${hostname}/`;
  const logoutUrl = `${protocol}://${hostname}/admin/logout`;

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>管理员面板 - DoH Server</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: white;
      margin-bottom: 30px;
      flex-wrap: wrap;
      gap: 15px;
    }
    .header h1 { font-size: 2em; }
    .header-buttons {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .home-btn {
      background: rgba(255,255,255,0.2);
      border: 1px solid rgba(255,255,255,0.3);
      padding: 8px 16px;
      border-radius: 8px;
      color: white;
      text-decoration: none;
      transition: all 0.3s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .home-btn:hover {
      background: rgba(255,255,255,0.3);
      transform: translateY(-2px);
    }
    .logout-btn {
      background: rgba(220, 53, 69, 0.8);
      border: 1px solid rgba(220, 53, 69, 1);
      padding: 8px 16px;
      border-radius: 8px;
      color: white;
      text-decoration: none;
      transition: all 0.3s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .logout-btn:hover {
      background: rgba(220, 53, 69, 1);
      transform: translateY(-2px);
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 25px;
      margin-bottom: 20px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    }
    .card h2 {
      color: #667eea;
      margin-bottom: 20px;
      border-bottom: 2px solid #e0e0e0;
      padding-bottom: 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
    }
    .endpoint {
      background: #f5f5f5;
      padding: 12px 15px;
      border-radius: 8px;
      font-family: monospace;
      word-break: break-all;
    }
    .upstream-table {
      width: 100%;
      border-collapse: collapse;
    }
    .upstream-table th, .upstream-table td {
      padding: 10px;
      text-align: left;
      border-bottom: 1px solid #eee;
    }
    .upstream-table th {
      background: #f8f9fa;
      font-weight: 600;
    }
    .status-online { color: #4caf50; font-weight: bold; }
    .status-offline { color: #f44336; font-weight: bold; }
    .status-checking { color: #ff9800; }
    .protocol-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 10px;
      font-weight: bold;
    }
    .protocol-doh { background: #e3f2fd; color: #1976d2; }
    .protocol-dot { background: #e8f5e9; color: #388e3c; }
    .protocol-tcp { background: #fff3e0; color: #f57c00; }
    .protocol-udp { background: #fce4ec; color: #c2185b; }
    .switch-btn {
      padding: 4px 12px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      background: #667eea;
      color: white;
    }
    .switch-btn:hover { background: #5a67d8; }
    .switch-btn:disabled { background: #ccc; cursor: not-allowed; }
    .auto-btn {
      background: #4caf50;
      padding: 8px 16px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      color: white;
    }
    .auto-btn:hover { background: #45a049; }
    .refresh-btn {
      background: #667eea;
      color: white;
      border: none;
      padding: 5px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
    }
    .refresh-btn:hover { background: #5a67d8; }
    .current-info {
      background: #e8f4f8;
      padding: 10px 15px;
      border-radius: 8px;
      margin-bottom: 15px;
    }
    .footer { text-align: center; color: white; margin-top: 30px; opacity: 0.8; }
    @media (max-width: 768px) {
      .upstream-table { font-size: 12px; }
      .upstream-table th, .upstream-table td { padding: 6px; }
      .header { flex-direction: column; text-align: center; }
      .header-buttons { justify-content: center; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔧 管理员面板</h1>
      <div class="header-buttons">
        <a href="${homeUrl}" class="home-btn">
          🏠 返回前台
        </a>
        <a href="${logoutUrl}" class="logout-btn" onclick="return confirm('确定要退出登录吗？')">
          🚪 退出登录
        </a>
      </div>
    </div>

    <div class="card">
      <h2>📊 服务状态</h2>
      <p><strong>🔗 DoH 端点：</strong></p>
      <div class="endpoint" id="endpoint"></div>
      <div class="current-info" id="currentInfo"></div>
    </div>

    <div class="card">
      <h2>
        🌐 上游 DNS 服务器
        <button class="refresh-btn" onclick="refreshHealthCheck()">🔄 刷新健康检查</button>
      </h2>
      <div style="overflow-x: auto;">
        <table class="upstream-table">
          <thead>
            <tr><th>状态</th><th>上游服务器</th><th>协议</th><th>区域</th><th>响应时间</th><th>操作</th></tr>
          </thead>
          <tbody id="upstreamList"></tbody>
        </table>
      </div>
      <div style="margin-top: 15px; text-align: center;">
        <button class="auto-btn" onclick="setAutoMode()">🔄 切换到自动模式</button>
      </div>
    </div>

    <div class="footer">
      <p>管理员面板 - 只有管理员可以切换上游 DNS</p>
    </div>
  </div>

  <script>
    const endpoint = '${currentDohUrl}';
    document.getElementById('endpoint').innerHTML = endpoint;

    let currentMode = 'auto';
    let currentSelectedId = null;

    async function loadUpstreams() {
      try {
        const response = await fetch('/api/upstreams');
        const data = await response.json();
        currentMode = data.mode;
        currentSelectedId = data.selectedId;
        renderUpstreams(data.upstreams, data.mode, data.selectedId);
        updateCurrentInfo(data.currentUpstream, data.mode);
      } catch (err) {
        console.error('加载失败:', err);
        setTimeout(loadUpstreams, 3000);
      }
    }

    function getProtocolClass(protocol) {
      const map = { doh: 'protocol-doh', dot: 'protocol-dot', tcp: 'protocol-tcp', udp: 'protocol-udp' };
      return map[protocol] || 'protocol-doh';
    }

    function renderUpstreams(upstreams, mode, selectedId) {
      const tbody = document.getElementById('upstreamList');
      if (!tbody) return;
      tbody.innerHTML = '';

      const sorted = [...upstreams].sort((a, b) => {
        if (a.status === 'online' && b.status !== 'online') return -1;
        if (a.status !== 'online' && b.status === 'online') return 1;
        if (a.status === 'online' && b.status === 'online') {
          return (a.responseTime || 9999) - (b.responseTime || 9999);
        }
        return 0;
      });

      sorted.forEach(u => {
        const row = tbody.insertRow();

        const statusCell = row.insertCell(0);
        let statusText = '', statusClass = '';
        switch(u.status) {
          case 'online': statusText = '● 在线'; statusClass = 'status-online'; break;
          case 'offline': statusText = '○ 离线'; statusClass = 'status-offline'; break;
          default: statusText = '◐ 检测中'; statusClass = 'status-checking';
        }
        statusCell.innerHTML = '<span class="' + statusClass + '">' + statusText + '</span>';

        const nameCell = row.insertCell(1);
        let nameHtml = u.displayName;
        if (mode === 'manual' && selectedId !== null && u.id === selectedId) {
          nameHtml += ' <span style="background:#ff9800; color:white; padding:2px 8px; border-radius:4px; font-size:10px;">当前使用</span>';
        }
        nameCell.innerHTML = nameHtml;

        const protocolCell = row.insertCell(2);
        protocolCell.innerHTML = '<span class="protocol-badge ' + getProtocolClass(u.protocol) + '">' + u.protocol.toUpperCase() + '</span>';

        const regionCell = row.insertCell(3);
        regionCell.innerHTML = u.region || '全球';

        const timeCell = row.insertCell(4);
        timeCell.innerHTML = u.responseTime ? u.responseTime + 'ms' : '-';

        const actionCell = row.insertCell(5);
        if (u.status === 'online') {
          const switchBtn = document.createElement('button');
          if (mode === 'manual' && selectedId !== null && u.id === selectedId) {
            switchBtn.textContent = '当前使用';
            switchBtn.disabled = true;
            switchBtn.style.background = '#ccc';
            switchBtn.style.cursor = 'default';
          } else {
            switchBtn.textContent = '切换到此';
            switchBtn.className = 'switch-btn';
            switchBtn.onclick = (function(id) {
              return function() { switchUpstream(id); };
            })(u.id);
          }
          actionCell.appendChild(switchBtn);
        } else {
          actionCell.innerHTML = '<span style="color:#999;">不可用</span>';
        }
      });
    }

    function updateCurrentInfo(upstream, mode) {
      const infoDiv = document.getElementById('currentInfo');
      if (!infoDiv) return;
      const modeText = mode === 'auto' ? '自动切换' : '手动固定';
      infoDiv.innerHTML = '📡 当前使用: <strong>' + upstream + '</strong> <span style="background:' + (mode === 'auto' ? '#4caf50' : '#ff9800') + '; color:white; padding:2px 8px; border-radius:4px; font-size:12px; margin-left:10px;">' + modeText + '</span>';
    }

    async function switchUpstream(id) {
      try {
        const response = await fetch('/api/switch/' + id, { method: 'POST' });
        const data = await response.json();
        if (data.success) {
          console.log('已切换到:', data.upstream);
          await loadUpstreams();
        } else {
          alert('切换失败: ' + data.message);
        }
      } catch (err) {
        console.error('切换失败:', err);
        alert('切换失败: ' + err.message);
      }
    }

    async function setAutoMode() {
      try {
        const response = await fetch('/api/auto', { method: 'POST' });
        const data = await response.json();
        if (data.success) {
          console.log('已切换到自动模式');
          await loadUpstreams();
        }
      } catch (err) {
        console.error('切换失败:', err);
      }
    }

    async function refreshHealthCheck() {
      const btn = event.target;
      const originalText = btn.textContent;
      btn.textContent = '检查中...';
      btn.disabled = true;
      try {
        await fetch('/api/healthcheck', { method: 'POST' });
        setTimeout(async function() {
          await loadUpstreams();
          btn.textContent = originalText;
          btn.disabled = false;
        }, 3000);
      } catch (err) {
        console.error('刷新失败:', err);
        btn.textContent = originalText;
        btn.disabled = false;
      }
    }

    loadUpstreams();
    setInterval(loadUpstreams, 10000);
  </script>
</body>
</html>`;
  res.send(html);
});

// ============ API 路由 ============
app.post('/api/switch/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const upstream = upstreams.find(u => u.id === id);

  if (upstream && upstream.status === 'online') {
    selectedUpstreamId = id;
    currentUpstreamIndex = 0;
    console.log(`🔧 手动切换到: ${upstream.displayName} (${upstream.protocol.toUpperCase()})`);
    res.json({ success: true, upstream: upstream.displayName });
  } else {
    res.json({ success: false, message: '上游不可用' });
  }
});

app.post('/api/auto', requireAdmin, (req, res) => {
  selectedUpstreamId = null;
  currentUpstreamIndex = 0;
  console.log(`🔧 切换到自动模式`);
  res.json({ success: true, mode: 'auto' });
});

app.post('/api/healthcheck', requireAdmin, async (req, res) => {
  await healthCheck();
  res.json({ success: true });
});

// ============ 公开 API ============
app.get('/api/upstreams', (req, res) => {
  res.json(getCurrentStatus());
});

app.get('/api/dns', async (req, res) => {
  const domain = req.query.domain || 'www.google.com';
  const type = req.query.type || 'A';

  try {
    if (type === 'all') {
      const results = await queryAllTypes(domain);
      const formatted = {
        Status: 0,
        upstream: results.upstream || 'auto',
        ...results
      };
      setJsonHeaders(res);
      return res.json(formatted);
    } else {
      const result = await queryWithFallback(domain, type);
      if (result.success) {
        const formatted = formatDNSResponse(result.data, domain, type);
        setJsonHeaders(res);
        return res.json({
          Status: formatted.Status,
          upstream: result.upstream,
          protocol: result.protocol,
          ...formatted
        });
      } else {
        setJsonHeaders(res);
        return res.status(404).json({
          Status: 2,
          upstream: null,
          Answer: [],
          error: '查询失败'
        });
      }
    }
  } catch (err) {
    setJsonHeaders(res);
    res.status(500).json({ error: err.message });
  }
});

// ============ DoH 端点（修复 response.buffer 错误） ============
app.all(`/${DoH路径}`, async (req, res) => {
  const { method, headers, body } = req;
  const UA = headers['user-agent'] || 'DoH Client';
  const accept = headers['accept'] || '';
  const contentType = headers['content-type'] || '';

  try {
    const upstream = getCurrentUpstream();
    let domain = null;
    let type = 'A';
    let response = null;

    // ---------- GET 请求 ----------
    if (method === 'GET') {
      const url = new URL(req.url, `http://${req.headers.host}`);

      // 处理 ?name= 参数（JSON 或 wire format）
      if (url.searchParams.has('name')) {
        domain = url.searchParams.get('name');
        type = url.searchParams.get('type') || 'A';

        if (accept.includes('application/dns-message')) {
          const dohEndpoint = getDoHEndpoint(upstream);
          const upstreamUrl = new URL(dohEndpoint);
          upstreamUrl.searchParams.set('name', domain);
          upstreamUrl.searchParams.set('type', type);
          const wireResponse = await fetch(upstreamUrl.toString(), {
            headers: { 'Accept': 'application/dns-message', 'User-Agent': UA }
          });
          // 获取二进制数据（修复 buffer 错误）
          const arrayBuffer = await wireResponse.arrayBuffer();
          const wireBody = Buffer.from(arrayBuffer);
          res.set('Content-Type', 'application/dns-message');
          res.set('Content-Length', wireBody.length);
          res.set('Access-Control-Allow-Origin', '*');
          return res.status(wireResponse.status).send(wireBody);
        }

        // 默认返回 JSON
        const result = await queryDNS(upstream, domain, type);
        if (result.success && result.data) {
          const formatted = formatDNSResponse(result.data, domain, type);
          setJsonHeaders(res);
          return res.json(formatted);
        } else {
          setJsonHeaders(res);
          return res.status(500).json({
            Status: 2,
            Answer: [],
            error: 'DNS 查询失败',
            code: 'QUERY_FAILED'
          });
        }
      }

      // 处理 ?dns= 参数（Base64URL 编码的 wire data）
      if (url.searchParams.has('dns')) {
        const dohEndpoint = getDoHEndpoint(upstream);
        const base64url = url.searchParams.get('dns');
        const upstreamUrl = new URL(dohEndpoint);
        upstreamUrl.searchParams.set('dns', base64url);
        const wireResponse = await fetch(upstreamUrl.toString(), {
          headers: { 'Accept': 'application/dns-message', 'User-Agent': UA }
        });
        const arrayBuffer = await wireResponse.arrayBuffer();
        const wireBody = Buffer.from(arrayBuffer);
        res.set('Content-Type', 'application/dns-message');
        res.set('Content-Length', wireBody.length);
        res.set('Access-Control-Allow-Origin', '*');
        return res.status(wireResponse.status).send(wireBody);
      }

      setJsonHeaders(res);
      return res.status(400).json({ error: '缺少参数 name 或 dns' });
    }

    // ---------- POST 请求 ----------
    else if (method === 'POST') {
      let rawBody = '';
      if (Buffer.isBuffer(body)) {
        rawBody = body.toString('utf8');
      } else if (typeof body === 'string') {
        rawBody = body;
      } else if (body && typeof body === 'object') {
        rawBody = JSON.stringify(body);
      }

      if (contentType.includes('application/dns-json')) {
        try {
          let jsonBody;
          if (typeof body === 'object' && body !== null && !Buffer.isBuffer(body)) {
            jsonBody = body;
          } else {
            jsonBody = JSON.parse(rawBody);
          }
          domain = jsonBody.name || jsonBody.domain;
          type = jsonBody.type || 'A';
        } catch (e) {
          setJsonHeaders(res);
          return res.status(400).json({ error: '无效的 JSON 格式', message: e.message });
        }
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        try {
          if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
            domain = req.body.name || req.body.domain;
            type = req.body.type || 'A';
          } else if (rawBody) {
            const params = new URLSearchParams(rawBody);
            domain = params.get('name') || params.get('domain');
            type = params.get('type') || 'A';
          }
        } catch (e) {
          setJsonHeaders(res);
          return res.status(400).json({ error: '无效的表单格式' });
        }
      } else if (contentType.includes('application/dns-message')) {
        // 直接转发 wire format POST
        const dohEndpoint = getDoHEndpoint(upstream);
        response = await fetch(dohEndpoint, {
          method: 'POST',
          headers: {
            'Accept': 'application/dns-message',
            'Content-Type': 'application/dns-message',
            'User-Agent': UA
          },
          body: body
        });
      } else if (rawBody.trim().startsWith('{')) {
        try {
          const jsonBody = JSON.parse(rawBody);
          domain = jsonBody.name || jsonBody.domain;
          type = jsonBody.type || 'A';
        } catch (e) {
          setJsonHeaders(res);
          return res.status(400).json({ error: '无法解析 JSON 请求体' });
        }
      } else if (rawBody.includes('=')) {
        try {
          const params = new URLSearchParams(rawBody);
          domain = params.get('name') || params.get('domain');
          type = params.get('type') || 'A';
        } catch (e) {
          setJsonHeaders(res);
          return res.status(400).json({ error: '无法解析表单请求体' });
        }
      }

      // 如果解析出了 domain，执行查询
      if (domain && !response) {
        if (accept.includes('application/dns-message')) {
          const dohEndpoint = getDoHEndpoint(upstream);
          const upstreamUrl = new URL(dohEndpoint);
          upstreamUrl.searchParams.set('name', domain);
          upstreamUrl.searchParams.set('type', type);
          const wireResponse = await fetch(upstreamUrl.toString(), {
            headers: { 'Accept': 'application/dns-message', 'User-Agent': UA }
          });
          const arrayBuffer = await wireResponse.arrayBuffer();
          const wireBody = Buffer.from(arrayBuffer);
          res.set('Content-Type', 'application/dns-message');
          res.set('Content-Length', wireBody.length);
          res.set('Access-Control-Allow-Origin', '*');
          return res.status(wireResponse.status).send(wireBody);
        }

        const result = await queryDNS(upstream, domain, type);
        if (result.success && result.data) {
          const formatted = formatDNSResponse(result.data, domain, type);
          setJsonHeaders(res);
          return res.json(formatted);
        } else {
          setJsonHeaders(res);
          return res.status(500).json({
            Status: 2,
            Answer: [],
            error: 'DNS 查询失败',
            code: 'QUERY_FAILED'
          });
        }
      }

      if (!domain && !response) {
        setJsonHeaders(res);
        return res.status(400).json({
          error: '无法解析请求',
          message: '请确保请求包含 name 或 domain 参数',
          contentType: contentType
        });
      }
    }

    // ---------- 转发 wire format 响应（POST 透传） ----------
    if (response) {
      if (!response.ok) throw new Error(`DoH 返回错误 (${response.status})`);
      const arrayBuffer = await response.arrayBuffer();
      const responseBody = Buffer.from(arrayBuffer);
      // 不复制所有头，只设置必要的
      res.set('Content-Type', 'application/dns-message');
      res.set('Content-Length', responseBody.length);
      res.set('Access-Control-Allow-Origin', '*');
      return res.status(response.status).send(responseBody);
    }

    setJsonHeaders(res);
    return res.status(400).json({ error: '不支持的请求格式' });

  } catch (error) {
    console.error("DoH 请求处理错误:", error);
    setJsonHeaders(res);
    res.status(500).json({ error: '内部服务器错误', message: error.message, code: 'INTERNAL_ERROR' });
  }
});

// ============ 公开首页（与之前相同） ============
app.get('/', (req, res) => {
  const hostname = req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const currentDohUrl = `${protocol}://${hostname}/${DoH路径}`;
  const adminUrl = `${protocol}://${hostname}/admin`;

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DNS-over-HTTPS Server</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container { max-width: 1000px; margin: 0 auto; }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: white;
      margin-bottom: 30px;
      flex-wrap: wrap;
      gap: 15px;
    }
    .header h1 { font-size: 2.5em; }
    .header-sub { text-align: right; }
    .login-btn {
      background: rgba(255,255,255,0.2);
      border: 1px solid rgba(255,255,255,0.3);
      padding: 10px 24px;
      border-radius: 30px;
      color: white;
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.3s ease;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .login-btn:hover {
      background: rgba(255,255,255,0.3);
      transform: translateY(-2px);
    }
    .header-description {
      text-align: center;
      color: white;
      margin-top: -15px;
      margin-bottom: 30px;
      opacity: 0.9;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 25px;
      margin-bottom: 20px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    }
    .card h2 {
      color: #667eea;
      margin-bottom: 20px;
      border-bottom: 2px solid #e0e0e0;
      padding-bottom: 10px;
    }
    .endpoint {
      background: #f5f5f5;
      padding: 12px 15px;
      border-radius: 8px;
      font-family: monospace;
      word-break: break-all;
    }
    .upstream-table {
      width: 100%;
      border-collapse: collapse;
    }
    .upstream-table th, .upstream-table td {
      padding: 10px;
      text-align: left;
      border-bottom: 1px solid #eee;
    }
    .upstream-table th {
      background: #f8f9fa;
      font-weight: 600;
    }
    .status-online { color: #4caf50; font-weight: bold; }
    .status-offline { color: #f44336; font-weight: bold; }
    .status-checking { color: #ff9800; }
    .protocol-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 10px;
      font-weight: bold;
    }
    .protocol-doh { background: #e3f2fd; color: #1976d2; }
    .protocol-dot { background: #e8f5e9; color: #388e3c; }
    .protocol-tcp { background: #fff3e0; color: #f57c00; }
    .protocol-udp { background: #fce4ec; color: #c2185b; }
    .query-box {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 20px;
    }
    .query-box input {
      flex: 2;
      padding: 12px 15px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 16px;
    }
    .query-box input:focus {
      outline: none;
      border-color: #667eea;
    }
    .query-box select, .query-box button {
      padding: 12px 15px;
      border-radius: 8px;
      font-size: 16px;
    }
    .query-box select {
      border: 2px solid #e0e0e0;
      background: white;
      cursor: pointer;
    }
    .query-box button {
      background: #667eea;
      color: white;
      border: none;
      cursor: pointer;
      transition: background 0.3s;
    }
    .query-box button:hover { background: #5a67d8; }
    .result {
      background: #f7f7f7;
      padding: 20px;
      border-radius: 10px;
      font-family: monospace;
      font-size: 13px;
      margin-top: 20px;
      display: none;
      overflow-x: auto;
      border-left: 4px solid #667eea;
    }
    .result.show { display: block; }
    .result.error { border-left-color: #f44336; background: #ffebee; }
    .loading {
      display: inline-block;
      width: 20px;
      height: 20px;
      border: 2px solid #f3f3f3;
      border-top: 2px solid #667eea;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-right: 10px;
      vertical-align: middle;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .footer { text-align: center; color: white; margin-top: 30px; opacity: 0.8; }
    .record-card {
      background: #f8f9fa;
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 15px;
    }
    .record-title {
      font-weight: bold;
      color: #667eea;
      margin-bottom: 10px;
      border-left: 3px solid #667eea;
      padding-left: 10px;
    }
    .record-item {
      padding: 5px 0;
      border-bottom: 1px solid #e0e0e0;
      font-family: monospace;
    }
    .current-info {
      background: #e8f4f8;
      padding: 10px 15px;
      border-radius: 8px;
      margin-top: 15px;
    }
    .curl-example {
      background: #1e1e1e;
      color: #d4d4d4;
      padding: 15px;
      border-radius: 8px;
      font-family: monospace;
      font-size: 12px;
      overflow-x: auto;
    }
    .curl-example pre {
      margin: 0;
      white-space: pre-wrap;
    }
    @media (max-width: 768px) {
      .upstream-table { font-size: 12px; }
      .upstream-table th, .upstream-table td { padding: 6px; }
      .header { flex-direction: column; text-align: center; }
      .header h1 { font-size: 1.8em; }
      .header-sub { text-align: center; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🖥️ DNS over HTTPS Server</h1>
      <div class="header-sub">
        <a href="${adminUrl}" class="login-btn">
          🔐 管理员登录
        </a>
      </div>
    </div>
    <div class="header-description">
      <p>多协议 (DoH/DoT/TCP/UDP) | 多记录类型 | 隐私保护</p>
    </div>

    <div class="card">
      <h2>📊 服务状态</h2>
      <p><strong>🔗 DoH 端点：</strong></p>
      <div class="endpoint" id="endpoint"></div>
      <div class="current-info" id="currentInfo"></div>
    </div>

    <div class="card">
      <h2>🌐 上游 DNS 服务器</h2>
      <div style="overflow-x: auto;">
        <table class="upstream-table">
          <thead>
            <tr><th>状态</th><th>上游服务器</th><th>协议</th><th>区域</th><th>响应时间</th></tr>
          </thead>
          <tbody id="upstreamList"></tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h2>🔧 DNS 查询工具</h2>
      <div class="query-box">
        <input type="text" id="domain" placeholder="域名，如: google.com" value="google.com">
        <select id="recordType">
          <option value="A">A (IPv4 地址)</option>
          <option value="AAAA">AAAA (IPv6 地址)</option>
          <option value="CNAME">CNAME (规范名称)</option>
          <option value="MX">MX (邮件交换)</option>
          <option value="TXT">TXT (文本记录)</option>
          <option value="NS">NS (域名服务器)</option>
          <option value="HTTPS">HTTPS (ECH配置)</option>
          <option value="all" selected>全部 (A/AAAA/MX/TXT/NS/CNAME)</option>
        </select>
        <button onclick="queryDNS()" id="queryBtn">🚀 查询</button>
      </div>
      <div id="result" class="result"></div>
    </div>

    <div class="card">
      <h2>📖 使用示例</h2>
      <div class="curl-example">
        <pre><strong># GET 请求 - A记录 (IPv4)</strong>
curl -H "accept: application/dns-json" \\
  "${currentDohUrl}?name=google.com&type=A"

<strong># GET 请求 - HTTPS记录 (ECH配置)</strong>
curl -H "accept: application/dns-json" \\
  "${currentDohUrl}?name=cloudflare-ech.com&type=HTTPS"

<strong># POST 请求 - JSON格式 (A记录)</strong>
curl -X POST -H "Content-Type: application/dns-json" \\
  -d '{"name":"google.com","type":"A"}' \\
  "${currentDohUrl}"

<strong># POST 请求 - 表单格式 (A记录)</strong>
curl -X POST -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "name=google.com&type=A" \\
  "${currentDohUrl}"

<strong># 浏览器访问 (直接显示JSON)</strong>
<a href="${currentDohUrl}?name=google.com&type=A" target="_blank">${currentDohUrl}?name=google.com&type=A</a>

<strong># 浏览器配置 DoH</strong>
Chrome/Edge: 设置 → 隐私和安全 → 安全 → 使用安全 DNS → 自定义
填入: <strong>${currentDohUrl}</strong></pre>
      </div>
    </div>

    <div class="footer">
      <p>🚀 Node.js DoH Server | 公开服务 - 管理员可切换上游</p>
    </div>
  </div>

  <script>
    const endpoint = '${currentDohUrl}';
    document.getElementById('endpoint').innerHTML = endpoint;

    async function loadUpstreams() {
      try {
        const response = await fetch('/api/upstreams');
        const data = await response.json();
        renderUpstreams(data.upstreams, data.mode, data.selectedId);
        updateCurrentInfo(data.currentUpstream, data.mode);
      } catch (err) {
        console.error('加载失败:', err);
        setTimeout(loadUpstreams, 3000);
      }
    }

    function getProtocolClass(protocol) {
      const map = { doh: 'protocol-doh', dot: 'protocol-dot', tcp: 'protocol-tcp', udp: 'protocol-udp' };
      return map[protocol] || 'protocol-doh';
    }

    function renderUpstreams(upstreams, mode, selectedId) {
      const tbody = document.getElementById('upstreamList');
      if (!tbody) return;
      tbody.innerHTML = '';

      const sorted = [...upstreams].sort((a, b) => {
        if (a.status === 'online' && b.status !== 'online') return -1;
        if (a.status !== 'online' && b.status === 'online') return 1;
        if (a.status === 'online' && b.status === 'online') {
          return (a.responseTime || 9999) - (b.responseTime || 9999);
        }
        return 0;
      });

      sorted.forEach(u => {
        const row = tbody.insertRow();

        const statusCell = row.insertCell(0);
        let statusText = '', statusClass = '';
        switch(u.status) {
          case 'online': statusText = '● 在线'; statusClass = 'status-online'; break;
          case 'offline': statusText = '○ 离线'; statusClass = 'status-offline'; break;
          default: statusText = '◐ 检测中'; statusClass = 'status-checking';
        }
        statusCell.innerHTML = '<span class="' + statusClass + '">' + statusText + '</span>';

        const nameCell = row.insertCell(1);
        let nameHtml = u.displayName;
        if (mode === 'manual' && selectedId !== null && u.id === selectedId) {
          nameHtml += ' <span style="background:#ff9800; color:white; padding:2px 8px; border-radius:4px; font-size:10px;">当前</span>';
        }
        nameCell.innerHTML = nameHtml;

        const protocolCell = row.insertCell(2);
        protocolCell.innerHTML = '<span class="protocol-badge ' + getProtocolClass(u.protocol) + '">' + u.protocol.toUpperCase() + '</span>';

        const regionCell = row.insertCell(3);
        regionCell.innerHTML = u.region || '全球';

        const timeCell = row.insertCell(4);
        timeCell.innerHTML = u.responseTime ? u.responseTime + 'ms' : '-';
      });
    }

    function updateCurrentInfo(upstream, mode) {
      const infoDiv = document.getElementById('currentInfo');
      if (!infoDiv) return;
      const modeText = mode === 'auto' ? '自动切换模式' : '手动固定模式';
      infoDiv.innerHTML = '📡 当前使用: <strong>' + upstream + '</strong> | ' + modeText;
    }

    function formatMXRecord(r) {
      if (r.priority !== undefined) {
        return '<span style="color:#666; font-size:11px;">[' + r.priority + ']</span> ' + r.exchange;
      }
      return r.data || String(r);
    }

    function displayResults(data, domain, type) {
      let html = '<strong>✅ ' + domain + ' 查询结果</strong><br>';
      if (data.upstream) html += '<small>📡 上游: ' + data.upstream + '</small><br><br>';

      if (type === 'all') {
        const types = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'];
        for (let i = 0; i < types.length; i++) {
          const t = types[i];
          const records = data[t] || [];
          html += '<div class="record-card">';
          html += '<div class="record-title">📋 ' + t + ' 记录</div>';
          if (records.length > 0) {
            for (let j = 0; j < records.length; j++) {
              const r = records[j];
              if (t === 'MX') {
                html += '<div class="record-item">' + formatMXRecord(r) + '</div>';
              } else {
                html += '<div class="record-item">' + (r.data || r.exchange || JSON.stringify(r)) + '</div>';
              }
            }
          } else {
            html += '<div class="record-item" style="color:#999;">无记录</div>';
          }
          html += '</div>';
        }
      } else {
        const records = data.Answer || [];
        html += '<div class="record-card">';
        html += '<div class="record-title">📋 ' + type + ' 记录</div>';
        if (records.length > 0) {
          for (let i = 0; i < records.length; i++) {
            const r = records[i];
            if (type === 'MX') {
              html += '<div class="record-item">' + formatMXRecord(r) + '</div>';
            } else {
              html += '<div class="record-item">' + (r.data || JSON.stringify(r)) + '</div>';
            }
          }
        } else {
          html += '<div class="record-item" style="color:#999;">无记录</div>';
        }
        html += '</div>';
      }

      return html;
    }

    async function queryDNS() {
      const domain = document.getElementById('domain').value.trim();
      const recordType = document.getElementById('recordType').value;
      if (!domain) { alert('请输入域名'); return; }

      const resultDiv = document.getElementById('result');
      const queryBtn = document.getElementById('queryBtn');
      resultDiv.innerHTML = '<span class="loading"></span> 正在查询...';
      resultDiv.classList.add('show');
      queryBtn.disabled = true;

      try {
        const url = '/api/dns?domain=' + encodeURIComponent(domain) + '&type=' + recordType;
        const response = await fetch(url);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();

        resultDiv.innerHTML = displayResults(data, domain, recordType);
        resultDiv.classList.remove('error');
      } catch (err) {
        resultDiv.innerHTML = '❌ 查询失败: ' + err.message;
        resultDiv.classList.add('error');
      } finally {
        queryBtn.disabled = false;
      }
    }

    document.getElementById('domain').addEventListener('keypress', function(e) {
      if (e.key === 'Enter') queryDNS();
    });

    loadUpstreams();
    setInterval(loadUpstreams, 10000);
  </script>
</body>
</html>`;
  res.send(html);
});

app.get('/health', (req, res) => {
  const status = getCurrentStatus();
  setJsonHeaders(res);
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    dohPath: `/${DoH路径}`,
    mode: status.mode,
    currentUpstream: status.currentUpstream,
    available: status.availableCount,
    total: status.totalCount
  });
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`========================================`);
  console.log(`🛡️ 多协议 DoH 服务器已启动`);
  console.log(`📡 端口: ${PORT}`);
  console.log(`🔗 DoH 端点: /${DoH路径}`);
  console.log(`🔐 管理员入口: /admin`);
  console.log(`📋 默认账号: ${ADMIN_USER} / ${ADMIN_PASS}`);
  console.log(`🌐 上游总数: ${upstreams.length}`);
  console.log(`========================================`);

  await healthCheck();
  setInterval(healthCheck, 60000);
});

process.on('SIGTERM', () => {
  console.log('正在关闭...');
  process.exit(0);
});
