const express = require('express');
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
  cookie: {
    secure: false,
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// ============ DoH 路径配置 ============
let DoH路径 = process.env.DOH_PATH || process.env.TOKEN || 'dns-query';
DoH路径 = DoH路径.replace(/^\/+|\/+$/g, '');
if (DoH路径.includes('/')) {
  const parts = DoH路径.split('/');
  DoH路径 = parts[parts.length - 1];
}
DoH路径 = DoH路径.replace(/[^a-zA-Z0-9\-_]/g, '');
if (!DoH路径 || DoH路径.length === 0) {
  DoH路径 = 'dns-query';
}
console.log(`[INFO] ${new Date().toISOString()} 📡 DoH 端点路径: /${DoH路径}`);

// ============ DNS 记录类型映射 ============
const recordTypeMap = {
  'A': 1, 'AAAA': 28, 'CNAME': 5, 'MX': 15, 'TXT': 16, 'NS': 2,
  'SOA': 6, 'PTR': 12, 'SRV': 33, 'CAA': 257, 'HTTPS': 65, 'ANY': 255
};

// ============ 上游配置 ============
const upstreamsConfig = [
  { name: "cloudflare-dns.com", display: "Cloudflare", server: "https://cloudflare-dns.com/dns-query", region: "全球", type: "DoH", priority: 1 },
  { name: "dns.google", display: "Google", server: "https://dns.google/dns-query", region: "全球", type: "DoH", priority: 2 },
  { name: "dns.quad9.net", display: "Quad9", server: "https://dns.quad9.net/dns-query", region: "全球", type: "DoH", priority: 3 },
  { name: "dns.sb", display: "DNS.SB", server: "https://dns.sb/dns-query", region: "全球", type: "DoH", priority: 4 },
  { name: "alidns.com", display: "阿里云", server: "https://dns.alidns.com/dns-query", region: "中国", type: "DoH", priority: 5 },
  { name: "doh.pub", display: "腾讯云", server: "https://doh.pub/dns-query", region: "中国", type: "DoH", priority: 6 },
  { name: "doh.360.cn", display: "360", server: "https://doh.360.cn/dns-query", region: "中国", type: "DoH", priority: 7 },
  { name: "dns.adguard-dns.com", display: "AdGuard", server: "https://dns.adguard-dns.com/dns-query", region: "全球", type: "DoH+去广告", priority: 8 },
  { name: "doh.opendns.com", display: "OpenDNS", server: "https://doh.opendns.com/dns-query", region: "全球", type: "DoH", priority: 9 }
];

const enabledUpstreamsEnv = process.env.ENABLED_UPSTREAMS || 'all';
let upstreamList = [];
if (enabledUpstreamsEnv === 'all') {
  upstreamList = upstreamsConfig;
} else {
  const enabledNames = enabledUpstreamsEnv.split(',').map(n => n.trim());
  upstreamList = upstreamsConfig.filter(u =>
    enabledNames.includes(u.name) || enabledNames.includes(u.display)
  );
  if (upstreamList.length === 0) upstreamList = upstreamsConfig.slice(0, 5);
}

const upstreams = upstreamList.map((config, index) => ({
  id: index,
  name: config.name,
  displayName: config.display,
  server: config.server,
  region: config.region,
  type: config.type,
  timeout: config.region === '中国' ? 2000 : 3000,
  status: 'checking',
  lastCheck: null,
  responseTime: null
}));

console.log(`[INFO] ${new Date().toISOString()} 🌐 配置 DoH 上游总数: ${upstreams.length}`);
console.log(`[INFO] ${new Date().toISOString()} 📋 上游列表: ${upstreams.map(u => u.displayName).join(', ')}`);

let selectedUpstreamId = null;
let availableUpstreams = [...upstreams];
let sortedAvailable = [];
let currentUpstreamIndex = 0;
let healthCheckRunning = false;

// ============ 服务端地理信息缓存 ============
const geoCache = new Map();
const GEO_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;        // 7 天
const GEO_FAIL_TTL = 60 * 60 * 1000;                  // 1 小时

// ============ 辅助函数 ============
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============ 健康检查 ============
async function checkSingleUpstream(upstream) {
  const startTime = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), upstream.timeout + 2000);
    const url = new URL(upstream.server);
    url.searchParams.set('name', 'google.com');
    url.searchParams.set('type', 'A');
    const response = await fetch(url.toString(), {
      headers: { 'Accept': 'application/dns-json' },
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    const isOnline = response.ok;
    upstream.status = isOnline ? 'online' : 'offline';
    upstream.lastCheck = new Date().toISOString();
    upstream.responseTime = isOnline ? Date.now() - startTime : null;
    if (isOnline) {
      console.log(`[INFO] ${new Date().toISOString()} ✅ ${upstream.displayName} - ${upstream.responseTime}ms`);
    } else {
      console.log(`[INFO] ${new Date().toISOString()} ❌ ${upstream.displayName} - 不可用`);
    }
    return isOnline;
  } catch (err) {
    upstream.status = 'offline';
    upstream.lastCheck = new Date().toISOString();
    upstream.responseTime = null;
    console.log(`[ERROR] ${new Date().toISOString()} ❌ ${upstream.displayName} - 不可用 (${err.message})`);
    return false;
  }
}

async function healthCheck() {
  if (healthCheckRunning) return;
  healthCheckRunning = true;
  console.log(`[INFO] ${new Date().toISOString()} 🔍 开始健康检查`);
  await Promise.all(upstreams.map(u => checkSingleUpstream(u)));
  const newAvailable = upstreams.filter(u => u.status === 'online');
  newAvailable.sort((a, b) => (a.responseTime || 9999) - (b.responseTime || 9999));
  availableUpstreams = newAvailable;
  sortedAvailable = [...availableUpstreams];
  console.log(`[INFO] ${new Date().toISOString()} 📡 在线: ${availableUpstreams.length}/${upstreams.length}`);
  if (availableUpstreams[0]) {
    console.log(`[INFO] ${new Date().toISOString()} 📡 最快: ${availableUpstreams[0].displayName} (${availableUpstreams[0].responseTime}ms)`);
  }
  healthCheckRunning = false;
}

// ============ 获取当前上游（自动模式始终用最快的） ============
function getCurrentUpstream() {
  if (selectedUpstreamId !== null) {
    const selected = upstreams.find(u => u.id === selectedUpstreamId);
    if (selected && selected.status === 'online') {
      return selected;
    }
    selectedUpstreamId = null;
  }
  if (sortedAvailable.length > 0) {
    return sortedAvailable[0];
  }
  return upstreams[0];
}

async function fetchWithFallback(endpoints, options, timeout = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  const signal = controller.signal;
  let lastError = null;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { ...options, signal });
      clearTimeout(timeoutId);
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (err) {
      lastError = err;
    }
  }
  clearTimeout(timeoutId);
  throw lastError || new Error('所有上游均失败');
}

async function queryDoH(server, domain, type, timeout = 10000) {
  const url = new URL(server);
  url.searchParams.set("name", domain);
  url.searchParams.set("type", type);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url.toString(), {
      headers: { 'Accept': 'application/dns-json' },
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (response.ok) {
      const data = await response.json();
      return { success: true, data };
    } else {
      return { success: false, data: null };
    }
  } catch (err) {
    clearTimeout(timeoutId);
    return { success: false, data: null, error: err.message };
  }
}

async function queryDNS(upstream, domain, type) {
  try {
    const result = await queryDoH(upstream.server, domain, type, upstream.timeout);
    if (result.success && result.data) {
      return { success: true, data: result.data };
    }
    return { success: false, data: null };
  } catch (err) {
    console.error(`[ERROR] ${new Date().toISOString()} queryDNS 异常: ${err.message}`);
    return { success: false, data: null };
  }
}

async function queryWithFallback(domain, type, retryCount = 0) {
  const maxRetries = upstreams.length;
  const upstream = getCurrentUpstream();
  const result = await queryDNS(upstream, domain, type);
  if (result.success && result.data && (result.data.Answer?.length > 0)) {
    return { success: true, data: result.data, upstream: upstream.displayName };
  }
  if (retryCount < maxRetries) {
    return queryWithFallback(domain, type, retryCount + 1);
  }
  return { success: false, data: null, upstream: null };
}

async function queryAllTypes(domain) {
  const types = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME'];
  const results = {};
  const promises = types.map(async (type) => {
    const result = await queryWithFallback(domain, type);
    return { type, records: result.success ? (result.data.Answer || []) : [], upstream: result.upstream };
  });
  const allResults = await Promise.all(promises);
  for (const { type, records, upstream } of allResults) {
    results[type] = records;
    if (upstream && !results.upstream) results.upstream = upstream;
  }
  return results;
}

function getCurrentStatus() {
  return {
    upstreams: upstreams.map(u => ({
      id: u.id,
      name: u.name,
      displayName: u.displayName,
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
    totalCount: upstreams.length
  };
}

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

function parseDnsRequest(req) {
  const contentType = req.headers['content-type'] || '';
  const accept = req.headers['accept'] || '';
  let domain = null;
  let type = 'A';
  let wireBody = null;
  if (req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.searchParams.has('name')) {
      domain = url.searchParams.get('name');
      type = url.searchParams.get('type') || 'A';
    } else if (url.searchParams.has('dns')) {
      wireBody = url.searchParams.get('dns');
    }
    return { domain, type, wireBody, accept, contentType };
  }
  if (req.method === 'POST') {
    const body = req.body;
    if (contentType.includes('application/dns-json')) {
      let jsonBody;
      if (typeof body === 'object' && body !== null && !Buffer.isBuffer(body)) {
        jsonBody = body;
      } else {
        try {
          jsonBody = JSON.parse(body.toString());
        } catch {
          throw new Error('Invalid JSON body');
        }
      }
      domain = jsonBody.name || jsonBody.domain;
      type = jsonBody.type || 'A';
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      let params;
      if (typeof body === 'object' && body !== null) {
        params = body;
      } else {
        try {
          params = new URLSearchParams(body.toString());
        } catch {
          throw new Error('Invalid form data');
        }
      }
      domain = params.name || params.domain;
      type = params.type || 'A';
    } else if (contentType.includes('application/dns-message')) {
      wireBody = body;
    } else if (typeof body === 'string' && body.trim().startsWith('{')) {
      try {
        const json = JSON.parse(body);
        domain = json.name || json.domain;
        type = json.type || 'A';
      } catch {}
    } else if (typeof body === 'string' && body.includes('=')) {
      try {
        const params = new URLSearchParams(body);
        domain = params.get('name') || params.get('domain');
        type = params.get('type') || 'A';
      } catch {}
    }
    return { domain, type, wireBody, accept, contentType };
  }
  return { domain, type, wireBody, accept, contentType };
}

// ============ 服务端地理位置增强函数 ============
async function enrichGeoOnServer(data) {
  // 收集所有 A/AAAA 记录的 IP
  const toEnrich = [];
  const collect = (records) => {
    if (!records) return;
    records.forEach((r) => {
      if (r.data && (r.type === 1 || r.type === 28)) {
        toEnrich.push({ ip: r.data, ref: r });
      }
    });
  };
  if (data.Answer) collect(data.Answer);
  // 如果 data 中有 A/AAAA 单独字段（如 all 查询），也收集
  ['A', 'AAAA'].forEach(t => {
    if (data[t]) collect(data[t]);
  });
  if (toEnrich.length === 0) return;

  // 去重
  const uniqueIps = [...new Set(toEnrich.map(item => item.ip))];
  const now = Date.now();
  const needQueryIps = uniqueIps.filter(ip => {
    const cached = geoCache.get(ip);
    if (cached && cached.expireAt > now) {
      // 有缓存且未过期，直接应用
      const items = toEnrich.filter(item => item.ip === ip);
      items.forEach(item => {
        if (cached.data && cached.data.status === 'success') {
          item.ref.geo = cached.data.country + ' ' + cached.data.as;
        }
      });
      return false;
    }
    return true;
  });

  if (needQueryIps.length === 0) return;

  // 分批批量查询（每批最多 100 个）
  const batchSize = 100;
  for (let i = 0; i < needQueryIps.length; i += batchSize) {
    const batchIps = needQueryIps.slice(i, i + batchSize);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const response = await fetch('http://ip-api.com/batch?fields=status,country,as&lang=zh-CN', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batchIps),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error('Batch API error');
      const results = await response.json();
      results.forEach((geo, index) => {
        const ip = batchIps[index];
        if (geo && geo.status === 'success') {
          geoCache.set(ip, {
            data: geo,
            expireAt: now + GEO_CACHE_TTL
          });
          const items = toEnrich.filter(item => item.ip === ip);
          items.forEach(item => {
            item.ref.geo = geo.country + ' ' + geo.as;
          });
        } else {
          // 失败缓存短时间，避免频繁重试
          geoCache.set(ip, {
            data: null,
            expireAt: now + GEO_FAIL_TTL
          });
        }
      });
    } catch (error) {
      console.warn('批量查询 IP 地理信息失败:', error);
      // 网络错误，将这批 IP 缓存失败结果
      batchIps.forEach(ip => {
        geoCache.set(ip, {
          data: null,
          expireAt: now + 5 * 60 * 1000 // 5 分钟
        });
      });
    }
  }
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

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    next();
  } else {
    res.redirect('/admin/login');
  }
}

// ============ 管理员路由 ============
app.get('/admin/login', (req, res) => {
  const errorMsg = req.query.error ? escapeHtml(req.query.error) : '';
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
    ${errorMsg ? `<div class="error">${errorMsg}</div>` : ''}
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
    res.redirect('/admin/login?error=' + encodeURIComponent('用户名或密码错误'));
  }
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

app.get('/admin', requireAdmin, (req, res) => {
  const hostname = req.headers.host || '';
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
        <a href="${escapeHtml(homeUrl)}" class="home-btn">
          🏠 返回前台
        </a>
        <a href="${escapeHtml(logoutUrl)}" class="logout-btn" onclick="return confirm('确定要退出登录吗？')">
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
            <tr><th>状态</th><th>上游服务器</th><th>区域</th><th>响应时间</th><th>操作</th></tr>
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
    const endpoint = '${escapeHtml(currentDohUrl)}';
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

        const regionCell = row.insertCell(2);
        regionCell.innerHTML = u.region || '全球';

        const timeCell = row.insertCell(3);
        timeCell.innerHTML = u.responseTime ? u.responseTime + 'ms' : '-';

        const actionCell = row.insertCell(4);
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
    console.log(`[INFO] ${new Date().toISOString()} 🔧 手动切换到: ${upstream.displayName}`);
    res.json({ success: true, upstream: upstream.displayName });
  } else {
    res.json({ success: false, message: '上游不可用' });
  }
});

app.post('/api/auto', requireAdmin, (req, res) => {
  selectedUpstreamId = null;
  currentUpstreamIndex = 0;
  console.log(`[INFO] ${new Date().toISOString()} 🔧 切换到自动模式`);
  res.json({ success: true, mode: 'auto' });
});

app.post('/api/healthcheck', requireAdmin, async (req, res) => {
  await healthCheck();
  res.json({ success: true });
});

app.get('/api/upstreams', (req, res) => {
  res.json(getCurrentStatus());
});

// ============ /api/dns 增强（服务端地理缓存） ============
app.get('/api/dns', async (req, res) => {
  const domain = req.query.domain || 'www.google.com';
  const type = req.query.type || 'A';
  try {
    let resultData;
    let upstreamName;
    if (type === 'all') {
      const results = await queryAllTypes(domain);
      resultData = {
        Status: 0,
        upstream: results.upstream || 'auto',
        ...results
      };
      upstreamName = results.upstream || 'auto';
      // 对 A/AAAA 记录进行地理增强
      await enrichGeoOnServer(resultData);
    } else {
      const result = await queryWithFallback(domain, type);
      if (!result.success) {
        setJsonHeaders(res);
        return res.status(404).json({
          Status: 2,
          upstream: null,
          Answer: [],
          error: '查询失败'
        });
      }
      const formatted = formatDNSResponse(result.data, domain, type);
      resultData = {
        Status: formatted.Status,
        upstream: result.upstream,
        ...formatted
      };
      upstreamName = result.upstream;
      // 对 A/AAAA 记录进行地理增强
      await enrichGeoOnServer(resultData);
    }
    setJsonHeaders(res);
    res.json(resultData);
  } catch (err) {
    setJsonHeaders(res);
    res.status(500).json({ error: err.message });
  }
});

// ============ DoH 端点 ============
app.all(`/${DoH路径}`, async (req, res) => {
  const { method, headers, body } = req;
  const UA = headers['user-agent'] || 'DoH Client';
  try {
    let { domain, type, wireBody, contentType } = parseDnsRequest(req);
    if (wireBody !== null) {
      const endpoints = upstreams.filter(u => u.status === 'online').map(u => u.server);
      if (endpoints.length === 0) endpoints.push(upstreams[0].server);
      let options = { headers: { 'User-Agent': UA } };
      let targetUrls;
      if (method === 'GET') {
        const queryString = `?dns=${encodeURIComponent(wireBody)}`;
        targetUrls = endpoints.map(e => e + queryString);
        options.method = 'GET';
        options.headers['Accept'] = 'application/dns-message';
      } else if (method === 'POST') {
        targetUrls = endpoints;
        options.method = 'POST';
        options.headers['Content-Type'] = 'application/dns-message';
        options.headers['Accept'] = 'application/dns-message';
        options.body = wireBody;
      } else {
        throw new Error('不支持的请求方法');
      }
      const response = await fetchWithFallback(targetUrls, options, 10000);
      const arrayBuffer = await response.arrayBuffer();
      const responseBody = Buffer.from(arrayBuffer);
      res.set('Content-Type', 'application/dns-message');
      res.set('Content-Length', responseBody.length);
      res.set('Access-Control-Allow-Origin', '*');
      return res.status(response.status).send(responseBody);
    }
    if (!domain) {
      setJsonHeaders(res);
      return res.status(400).json({ error: '缺少 name 或 domain 参数' });
    }
    const result = await queryWithFallback(domain, type);
    if (result.success && result.data) {
      const formatted = formatDNSResponse(result.data, domain, type);
      // 对 A/AAAA 记录进行地理增强（DoH 端点返回 JSON 时）
      await enrichGeoOnServer(formatted);
      setJsonHeaders(res);
      return res.json(formatted);
    } else {
      setJsonHeaders(res);
      return res.status(500).json({
        Status: 2,
        Answer: [],
        error: 'DNS 查询失败（所有上游均不可用）',
        code: 'QUERY_FAILED'
      });
    }
  } catch (error) {
    console.error(`[ERROR] ${new Date().toISOString()} DoH 请求处理错误:`, error);
    setJsonHeaders(res);
    res.status(500).json({ error: '内部服务器错误', message: error.message, code: 'INTERNAL_ERROR' });
  }
});

// ============ 公开首页 ============
app.get('/', (req, res) => {
  const hostname = req.headers.host || '';
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const currentDohUrl = `${protocol}://${hostname}/${DoH路径}`;
  const adminUrl = `${protocol}://${hostname}/admin`;

  function cmdBlock(commandText) {
    return `<div class="cmd-block">${commandText}<button class="copy-btn" onclick="copyCommand(this)">📋 复制</button></div>`;
  }

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
    .cmd-block {
      position: relative;
      background: #1e1e1e;
      color: #d4d4d4;
      padding: 10px 15px;
      padding-right: 80px;
      border-radius: 8px;
      font-family: monospace;
      font-size: 13px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
      margin: 6px 0;
    }
    .cmd-block a {
      color: #66d9ef;
    }
    .cmd-block.light {
      background: #f0f0f0;
      color: #333;
    }
    .cmd-block.light a {
      color: #0055cc;
    }
    .copy-btn {
      position: absolute;
      top: 6px;
      right: 6px;
      background: rgba(255,255,255,0.15);
      border: 1px solid rgba(255,255,255,0.2);
      color: #ddd;
      padding: 3px 10px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      transition: all 0.3s;
      backdrop-filter: blur(4px);
      user-select: none;
    }
    .copy-btn:hover {
      background: rgba(255,255,255,0.3);
      color: #fff;
    }
    .copy-btn.copied {
      background: rgba(76, 175, 80, 0.4);
      border-color: #4caf50;
      color: #4caf50;
    }
    .tag {
      display: inline-block;
      background: #667eea;
      color: white;
      font-size: 12px;
      padding: 2px 10px;
      border-radius: 12px;
      margin-right: 6px;
    }
    .example-section {
      margin-bottom: 16px;
      border-left: 3px solid #667eea;
      padding-left: 12px;
    }
    .example-title {
      font-weight: bold;
      color: #667eea;
      margin-bottom: 8px;
    }
    .example-desc {
      font-size: 13px;
      color: #666;
      margin-top: 4px;
    }
    .geo-badge {
      color: #888;
      font-size: 12px;
      margin-left: 8px;
    }
    @media (max-width: 768px) {
      .upstream-table { font-size: 12px; }
      .upstream-table th, .upstream-table td { padding: 6px; }
      .header { flex-direction: column; text-align: center; }
      .header h1 { font-size: 1.8em; }
      .header-sub { text-align: center; }
      .cmd-block { font-size: 11px; padding: 8px 10px; padding-right: 70px; }
      .copy-btn { top: 4px; right: 4px; font-size: 10px; padding: 2px 8px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🖥️ DNS over HTTPS Server</h1>
      <div class="header-sub">
        <a href="${escapeHtml(adminUrl)}" class="login-btn">
          🔐 管理员登录
        </a>
      </div>
    </div>
    <div class="header-description">
      <p>纯 DoH 服务 | 多记录类型 | 支持 GET/POST & Wire Format</p>
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
            <tr><th>状态</th><th>上游服务器</th><th>区域</th><th>响应时间</th></tr>
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

    <!-- ========== 使用示例 ========== -->
    <div class="card">
      <h2>📖 使用示例</h2>
      <div style="font-size:14px; margin-bottom:12px; color:#555;">
        以下命令中的端点 <code>${escapeHtml(currentDohUrl)}</code> 已自动替换为您的实际地址，可直接复制运行。
      </div>

      <div class="example-section">
        <div class="example-title">1️⃣ GET 请求 – JSON 格式（?name=）</div>
        ${cmdBlock(`# A 记录 (IPv4)
curl -H "accept: application/dns-json" \\
  "${escapeHtml(currentDohUrl)}?name=google.com&type=A"`)}
        ${cmdBlock(`# AAAA 记录 (IPv6)
curl -H "accept: application/dns-json" \\
  "${escapeHtml(currentDohUrl)}?name=google.com&type=AAAA"`)}
        ${cmdBlock(`# HTTPS 记录 (ECH 配置)
curl -H "accept: application/dns-json" \\
  "${escapeHtml(currentDohUrl)}?name=cloudflare-ech.com&type=HTTPS"`)}
        <div class="example-desc">预期：返回 JSON，Answer 中包含对应记录。</div>
      </div>

      <div class="example-section">
        <div class="example-title">2️⃣ GET 请求 – Wire Format（?dns=）</div>
        ${cmdBlock(`# 查询 google.com A 记录（Base64URL 编码示例）
curl -H "accept: application/dns-message" \\
  "${escapeHtml(currentDohUrl)}?dns=AAABAAABAAAAAAAAB2V4YW1wbGUDY29tAAABAAE"`)}
        <div class="example-desc">
          预期：返回二进制 DNS 数据（终端会显示乱码，这是正常的）。<br>
          验证响应头：<code>content-type: application/dns-message</code>
        </div>
      </div>

      <div class="example-section">
        <div class="example-title">3️⃣ POST 请求 – JSON Body</div>
        ${cmdBlock(`# A 记录查询
curl -X POST -H "Content-Type: application/dns-json" \\
  -d '{"name":"google.com","type":"A"}' \\
  "${escapeHtml(currentDohUrl)}"`)}
        ${cmdBlock(`# HTTPS 记录查询
curl -X POST -H "Content-Type: application/dns-json" \\
  -d '{"name":"cloudflare-ech.com","type":"HTTPS"}' \\
  "${escapeHtml(currentDohUrl)}"`)}
        <div class="example-desc">预期：返回 JSON，Answer 中包含记录。</div>
      </div>

      <div class="example-section">
        <div class="example-title">4️⃣ POST 请求 – 表单格式</div>
        ${cmdBlock(`curl -X POST -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "name=google.com&type=A" \\
  "${escapeHtml(currentDohUrl)}"`)}
        <div class="example-desc">预期：返回 JSON，Answer 中包含 IPv4 地址。</div>
      </div>

      <div class="example-section">
        <div class="example-title">5️⃣ POST 请求 – Wire Format（原始二进制）</div>
        ${cmdBlock(`# 发送二进制数据
echo -n "AAABAAABAAAAAAAAB2V4YW1wbGUDY29tAAABAAE" | base64 -d > query.bin
curl -X POST -H "Content-Type: application/dns-message" --data-binary @query.bin \\
  "${escapeHtml(currentDohUrl)}"`)}
        <div class="example-desc">
          预期：返回二进制 DNS 响应（终端显示乱码）。<br>
          验证响应头：<code>content-type: application/dns-message</code>
        </div>
      </div>

      <div class="example-section" style="border-top:1px solid #e0e0e0; padding-top:12px; margin-top:8px;">
        <div class="example-title">🌐 浏览器访问 & 配置 DoH</div>
        ${cmdBlock(`# 浏览器直接访问（显示 JSON）
${escapeHtml(currentDohUrl)}?name=google.com&type=A

# Chrome/Edge 配置 DoH
设置 → 隐私和安全 → 安全 → 使用安全 DNS → 自定义
填入：${escapeHtml(currentDohUrl)}`)}
        <div class="example-desc">点击复制按钮将复制完整内容。</div>
      </div>

      <div class="example-section" style="margin-top:12px; border-top:1px solid #e0e0e0; padding-top:12px;">
        <div class="example-title">🔍 诊断辅助命令</div>
        ${cmdBlock(`# 查看完整响应头（确认 Content-Type）
curl -I "${escapeHtml(currentDohUrl)}?name=google.com&type=A"`)}
        ${cmdBlock(`# 查看 wire format 响应头
curl -I -H "accept: application/dns-message" \\
  "${escapeHtml(currentDohUrl)}?dns=AAABAAABAAAAAAAAB2V4YW1wbGUDY29tAAABAAE"`)}
        ${cmdBlock(`# 保存 wire format 响应到文件（避免终端乱码）
curl -H "accept: application/dns-message" \\
  "${escapeHtml(currentDohUrl)}?dns=AAABAAABAAAAAAAAB2V4YW1wbGUDY29tAAABAAE" \\
  --output response.bin`)}
        <div class="example-desc">每个命令独立复制，方便按需使用。</div>
      </div>
    </div>

    <div class="footer">
      <p>🚀 Node.js DoH Server | 公开服务 - 管理员可切换上游</p>
    </div>
  </div>

  <script>
    const endpoint = '${escapeHtml(currentDohUrl)}';
    document.getElementById('endpoint').innerHTML = endpoint;

    // ================== 复制命令（过滤注释） ==================
    function copyCommand(btn) {
      const block = btn.parentElement;
      const clone = block.cloneNode(true);
      const btnClone = clone.querySelector('.copy-btn');
      if (btnClone) btnClone.remove();
      const lines = clone.textContent.split('\\n');
      const filtered = lines.filter(line => {
        const trimmed = line.trim();
        return trimmed.length > 0 && !trimmed.startsWith('#');
      });
      const text = filtered.join('\\n');
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = '✅ 已复制';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = '📋 复制';
          btn.classList.remove('copied');
        }, 2000);
      }).catch(() => {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        try {
          document.execCommand('copy');
          btn.textContent = '✅ 已复制';
          btn.classList.add('copied');
          setTimeout(() => {
            btn.textContent = '📋 复制';
            btn.classList.remove('copied');
          }, 2000);
        } catch {
          alert('复制失败，请手动复制');
        }
        document.body.removeChild(textarea);
      });
    }

    // ================== 显示结果（服务端已包含地理信息） ==================
    function formatMXRecord(r) {
      if (r.priority !== undefined) {
        return '<span style="color:#666; font-size:11px;">[' + r.priority + ']</span> ' + r.exchange;
      }
      return r.data || String(r);
    }

    function displayResults(data, domain, type) {
      var html = '<strong>✅ ' + domain + ' 查询结果</strong><br>';
      if (data.upstream) html += '<small>📡 上游: ' + data.upstream + '</small><br><br>';

      if (type === 'all') {
        var types = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'];
        for (var i = 0; i < types.length; i++) {
          var t = types[i];
          var records = data[t] || [];
          html += '<div class="record-card">';
          html += '<div class="record-title">📋 ' + t + ' 记录</div>';
          if (records.length > 0) {
            for (var j = 0; j < records.length; j++) {
              var r = records[j];
              var displayText;
              if (t === 'MX') {
                displayText = formatMXRecord(r);
              } else {
                displayText = r.data || r.exchange || JSON.stringify(r);
                if ((t === 'A' || t === 'AAAA') && r.geo) {
                  displayText += ' <span class="geo-badge">' + r.geo + '</span>';
                }
              }
              html += '<div class="record-item">' + displayText + '</div>';
            }
          } else {
            html += '<div class="record-item" style="color:#999;">无记录</div>';
          }
          html += '</div>';
        }
      } else {
        var records = data.Answer || [];
        html += '<div class="record-card">';
        html += '<div class="record-title">📋 ' + type + ' 记录</div>';
        if (records.length > 0) {
          for (var k = 0; k < records.length; k++) {
            var r2 = records[k];
            var displayText2;
            if (type === 'MX') {
              displayText2 = formatMXRecord(r2);
            } else {
              displayText2 = r2.data || JSON.stringify(r2);
              if ((type === 'A' || type === 'AAAA') && r2.geo) {
                displayText2 += ' <span class="geo-badge">' + r2.geo + '</span>';
              }
            }
            html += '<div class="record-item">' + displayText2 + '</div>';
          }
        } else {
          html += '<div class="record-item" style="color:#999;">无记录</div>';
        }
        html += '</div>';
      }
      return html;
    }

    async function queryDNS() {
      var domain = document.getElementById('domain').value.trim();
      var recordType = document.getElementById('recordType').value;
      if (!domain) { alert('请输入域名'); return; }

      var resultDiv = document.getElementById('result');
      var queryBtn = document.getElementById('queryBtn');
      resultDiv.innerHTML = '<span class="loading"></span> 正在查询...';
      resultDiv.classList.add('show');
      queryBtn.disabled = true;

      try {
        var url = '/api/dns?domain=' + encodeURIComponent(domain) + '&type=' + recordType;
        var response = await fetch(url);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        var data = await response.json();
        // 服务端已附加 geo，客户端直接显示
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

    async function loadUpstreams() {
      try {
        var response = await fetch('/api/upstreams');
        var data = await response.json();
        renderUpstreams(data.upstreams, data.mode, data.selectedId);
        updateCurrentInfo(data.currentUpstream, data.mode);
      } catch (err) {
        console.error('加载失败:', err);
        setTimeout(loadUpstreams, 3000);
      }
    }

    function renderUpstreams(upstreams, mode, selectedId) {
      var tbody = document.getElementById('upstreamList');
      if (!tbody) return;
      tbody.innerHTML = '';
      var sorted = upstreams.slice().sort(function(a, b) {
        if (a.status === 'online' && b.status !== 'online') return -1;
        if (a.status !== 'online' && b.status === 'online') return 1;
        if (a.status === 'online' && b.status === 'online') {
          return (a.responseTime || 9999) - (b.responseTime || 9999);
        }
        return 0;
      });
      sorted.forEach(function(u) {
        var row = tbody.insertRow();
        var statusCell = row.insertCell(0);
        var statusText = '', statusClass = '';
        switch(u.status) {
          case 'online': statusText = '● 在线'; statusClass = 'status-online'; break;
          case 'offline': statusText = '○ 离线'; statusClass = 'status-offline'; break;
          default: statusText = '◐ 检测中'; statusClass = 'status-checking';
        }
        statusCell.innerHTML = '<span class="' + statusClass + '">' + statusText + '</span>';

        var nameCell = row.insertCell(1);
        var nameHtml = u.displayName;
        if (mode === 'manual' && selectedId !== null && u.id === selectedId) {
          nameHtml += ' <span style="background:#ff9800; color:white; padding:2px 8px; border-radius:4px; font-size:10px;">当前</span>';
        }
        nameCell.innerHTML = nameHtml;

        var regionCell = row.insertCell(2);
        regionCell.innerHTML = u.region || '全球';

        var timeCell = row.insertCell(3);
        timeCell.innerHTML = u.responseTime ? u.responseTime + 'ms' : '-';
      });
    }

    function updateCurrentInfo(upstream, mode) {
      var infoDiv = document.getElementById('currentInfo');
      if (!infoDiv) return;
      var modeText = mode === 'auto' ? '自动切换模式' : '手动固定模式';
      infoDiv.innerHTML = '📡 当前使用: <strong>' + upstream + '</strong> | ' + modeText;
    }

    loadUpstreams();
    setInterval(loadUpstreams, 10000);
  </script>
</body>
</html>`;
  res.send(html);
});

// ============ 健康检查端点 ============
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
    total: status.totalCount,
    protocols: ['DoH']
  });
});

// ============ 启动服务器 ============
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`[INFO] ${new Date().toISOString()} ========================================`);
  console.log(`[INFO] ${new Date().toISOString()} 🛡️ 纯 DoH 服务器已启动`);
  console.log(`[INFO] ${new Date().toISOString()} 📡 端口: ${PORT}`);
  console.log(`[INFO] ${new Date().toISOString()} 🔗 DoH 端点: /${DoH路径}`);
  console.log(`[INFO] ${new Date().toISOString()} 🔐 管理员入口: /admin`);
  console.log(`[INFO] ${new Date().toISOString()} 📋 默认账号: ${ADMIN_USER} / ${ADMIN_PASS}`);
  console.log(`[INFO] ${new Date().toISOString()} 🌐 DoH 上游总数: ${upstreams.length}`);
  console.log(`[INFO] ${new Date().toISOString()} ========================================`);

  await healthCheck();
  setInterval(healthCheck, 60000);
});

process.on('SIGTERM', () => {
  console.log(`[INFO] ${new Date().toISOString()} 正在关闭...`);
  process.exit(0);
});
