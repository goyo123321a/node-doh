const express = require('express');
const session = require('express-session');
const dns = require('dns');
const { Resolver } = require('dns').promises;

const app = express();
const PORT = process.env.PORT || 7860;

// 管理员密码（从环境变量读取，未设置则后台不可用）
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || admin;
const SESSION_SECRET = process.env.SESSION_SECRET || 'doh-secret-change-me';

// Session 配置
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 3600000 } // 1小时
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
  'SOA': 6, 'PTR': 12, 'SRV': 33, 'CAA': 257, 'ANY': 255
};

// ============ 多协议 DNS 上游配置 ============
const upstreamsConfig = [
  { name: "cloudflare-doh", display: "Cloudflare", server: "https://cloudflare-dns.com/dns-query", protocol: "doh", region: "全球", type: "DoH", priority: 1 },
  { name: "google-doh", display: "Google", server: "https://dns.google/dns-query", protocol: "doh", region: "全球", type: "DoH", priority: 2 },
  { name: "quad9-doh", display: "Quad9", server: "https://dns.quad9.net/dns-query", protocol: "doh", region: "全球", type: "DoH", priority: 3 },
  { name: "alidns-doh", display: "阿里云", server: "https://dns.alidns.com/dns-query", protocol: "doh", region: "中国", type: "DoH", priority: 4 },
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

// ============ DNS 查询辅助函数 ============
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

// 当前选中的上游（null = 自动模式）
let selectedUpstreamId = null;
let availableUpstreams = [...upstreams];
let currentUpstreamIndex = 0;
let healthCheckRunning = false;

function sanitizeHeaderValue(value) {
  return String(value).replace(/[^\x20-\x7E]/g, '').replace(/[\n\r]/g, '').substring(0, 100);
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

async function queryDNS(upstream, domain, type) {
  switch (upstream.protocol) {
    case 'doh': {
      const result = await queryDoH(upstream.server, domain, type);
      if (result.success && result.data) return { success: true, data: result.data };
      return { success: false, data: null };
    }
    case 'dot': {
      const result = await queryDoT(upstream.server, upstream.port, domain, type);
      if (result.success) {
        const answers = result.answers || [];
        return { success: true, data: { Answer: answers.map(a => ({ type: recordTypeMap[type] || 1, data: a })) } };
      }
      return { success: false, data: null };
    }
    case 'tcp': {
      const result = await queryTCP(upstream.server, upstream.port, domain, type);
      if (result.success) {
        const answers = result.answers || [];
        return { success: true, data: { Answer: answers.map(a => ({ type: recordTypeMap[type] || 1, data: a })) } };
      }
      return { success: false, data: null };
    }
    case 'udp': {
      const result = await queryUDP(upstream.server, upstream.port, domain, type);
      if (result.success) {
        const answers = result.answers || [];
        return { success: true, data: { Answer: answers.map(a => ({ type: recordTypeMap[type] || 1, data: a })) } };
      }
      return { success: false, data: null };
    }
    default: throw new Error(`未知协议: ${upstream.protocol}`);
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

// ============ 中间件 ============
app.use(express.json({ type: 'application/dns-json' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.raw({ type: 'application/dns-message', limit: '10mb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ============ 管理员认证中间件 ============
function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return res.status(403).send('管理员功能未启用（未设置 ADMIN_PASSWORD 环境变量）');
  if (req.session && req.session.isAdmin) return next();
  res.redirect('/admin/login');
}

// ============ 公开 API（只读）============
app.get('/api/upstreams', (req, res) => {
  res.json(getCurrentStatus());
});

app.get('/api/dns', async (req, res) => {
  const domain = req.query.domain || 'www.google.com';
  const type = req.query.type || 'A';
  try {
    if (type === 'all') {
      const results = await queryAllTypes(domain);
      res.json({ Status: 0, upstream: results.upstream || 'auto', ...results });
    } else {
      const result = await queryWithFallback(domain, type);
      if (result.success) {
        res.json({
          Status: 0,
          upstream: result.upstream,
          protocol: result.protocol,
          Answer: result.data.Answer || [],
          Question: [{ name: domain, type: recordTypeMap[type] || 1, class: 1 }]
        });
      } else {
        res.json({ Status: 2, upstream: null, Answer: [], error: '查询失败' });
      }
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 管理员 API（需认证）============
app.post('/api/admin/switch/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const upstream = upstreams.find(u => u.id === id);
  if (upstream && upstream.status === 'online') {
    selectedUpstreamId = id;
    currentUpstreamIndex = 0;
    console.log(`🔧 管理员手动切换到: ${upstream.displayName} (${upstream.protocol.toUpperCase()})`);
    res.json({ success: true, upstream: upstream.displayName });
  } else {
    res.json({ success: false, message: '上游不可用' });
  }
});

app.post('/api/admin/auto', requireAdmin, (req, res) => {
  selectedUpstreamId = null;
  currentUpstreamIndex = 0;
  console.log(`🔧 管理员切换到自动模式`);
  res.json({ success: true, mode: 'auto' });
});

app.post('/api/admin/healthcheck', requireAdmin, async (req, res) => {
  await healthCheck();
  res.json({ success: true });
});

// ============ 管理员登录页面 ============
app.get('/admin/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>管理员登录</title>
    <style>body{font-family:Arial;max-width:400px;margin:100px auto;padding:20px;} input,button{padding:10px;margin:5px 0;width:100%;}</style>
    </head>
    <body>
      <h2>管理员登录</h2>
      <form method="POST" action="/admin/login">
        <input type="password" name="password" placeholder="管理员密码" required />
        <button type="submit">登录</button>
      </form>
    </body>
    </html>
  `);
});

app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    res.redirect('/admin');
  } else {
    res.send('<h3>密码错误</h3><a href="/admin/login">返回重试</a>');
  }
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ============ 管理员后台界面 ============
app.get('/admin', requireAdmin, (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>DoH 管理后台</title><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      body { font-family: Arial; max-width: 1000px; margin: 20px auto; padding: 20px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
      th { background-color: #f2f2f2; }
      .online { color: green; font-weight: bold; }
      .offline { color: red; }
      button { padding: 4px 8px; cursor: pointer; }
      .auto-btn { background: #4caf50; color: white; border: none; padding: 8px 16px; }
      .refresh-btn { background: #2196f3; color: white; border: none; padding: 5px 10px; margin-bottom: 10px; }
      .logout { float: right; }
    </style>
    </head>
    <body>
      <div class="logout"><a href="/admin/logout">退出登录</a></div>
      <h2>DoH 上游 DNS 管理后台</h2>
      <button class="refresh-btn" onclick="refreshHealthCheck()">🔄 刷新健康检查</button>
      <button class="auto-btn" onclick="setAutoMode()">⚡ 切换到自动模式</button>
      <div id="status"></div>
      <table id="upstreamTable"><thead><tr><th>状态</th><th>上游服务器</th><th>协议</th><th>区域</th><th>响应时间</th><th>操作</th></tr></thead><tbody id="upstreamList"></tbody></table>
      <script>
        async function load(){
          const res=await fetch('/api/upstreams');
          const data=await res.json();
          const tbody=document.getElementById('upstreamList');
          tbody.innerHTML='';
          data.upstreams.forEach(u=>{
            const row=tbody.insertRow();
            row.insertCell(0).innerHTML=u.status==='online'?'<span class="online">● 在线</span>':'<span class="offline">○ 离线</span>';
            row.insertCell(1).innerHTML=u.displayName+(data.selectedId===u.id?' <b>(当前)</b>':'');
            row.insertCell(2).innerHTML=u.protocol.toUpperCase();
            row.insertCell(3).innerHTML=u.region;
            row.insertCell(4).innerHTML=u.responseTime?u.responseTime+'ms':'-';
            const action=row.insertCell(5);
            if(u.status==='online'){
              const btn=document.createElement('button');
              btn.textContent=data.selectedId===u.id?'当前使用':'切换';
              if(data.selectedId!==u.id) btn.onclick=()=>switchUpstream(u.id);
              action.appendChild(btn);
            }else action.innerHTML='不可用';
          });
          document.getElementById('status').innerHTML='当前模式: '+(data.mode==='auto'?'自动':'手动')+' | 当前上游: '+data.currentUpstream;
        }
        async function switchUpstream(id){
          const res=await fetch('/api/admin/switch/'+id,{method:'POST'});
          if(res.ok) load();
        }
        async function setAutoMode(){
          const res=await fetch('/api/admin/auto',{method:'POST'});
          if(res.ok) load();
        }
        async function refreshHealthCheck(){
          await fetch('/api/admin/healthcheck',{method:'POST'});
          setTimeout(load,2000);
        }
        load(); setInterval(load,10000);
      </script>
    </body>
    </html>
  `);
});

// ============ 前台页面（只读，带管理员登录按钮）============
app.get('/', (req, res) => {
  const hostname = req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const currentDohUrl = `${protocol}://${hostname}/${DoH路径}`;

  res.send(`
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>DNS-over-HTTPS 服务</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          padding: 20px;
        }
        .container { max-width: 1000px; margin: 0 auto; }
        .header { text-align: center; color: white; margin-bottom: 30px; position: relative; }
        .header h1 { font-size: 2.5em; margin-bottom: 10px; }
        .admin-link {
          position: absolute;
          top: 0;
          right: 0;
          background: rgba(255,255,255,0.2);
          padding: 8px 16px;
          border-radius: 30px;
          color: white;
          text-decoration: none;
          font-size: 14px;
        }
        .admin-link:hover { background: rgba(255,255,255,0.3); }
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
        .query-box select, .query-box button {
          padding: 12px 15px;
          border-radius: 8px;
          font-size: 16px;
        }
        .query-box select {
          border: 2px solid #e0e0e0;
          background: white;
        }
        .query-box button {
          background: #667eea;
          color: white;
          border: none;
          cursor: pointer;
        }
        .query-box button:hover { background: #5a67d8; }
        .result {
          background: #f7f7f7;
          padding: 20px;
          border-radius: 10px;
          font-family: monospace;
          font-size: 13px;
          margin-top: 20px;
          overflow-x: auto;
          white-space: pre-wrap;
          border-left: 4px solid #667eea;
        }
        .footer { text-align: center; color: white; margin-top: 30px; opacity: 0.8; }
        @media (max-width: 768px) {
          .upstream-table { font-size: 12px; }
          .upstream-table th, .upstream-table td { padding: 6px; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <a href="/admin" class="admin-link">🔐 管理员登录</a>
          <h1>🖥️ DNS over HTTPS 服务</h1>
          <p>加密 DNS 查询 | 多协议支持 | 高可用</p>
        </div>

        <div class="card">
          <h2>📊 服务信息</h2>
          <p><strong>🔗 DoH 端点：</strong></p>
          <div class="endpoint">${currentDohUrl}</div>
          <div id="currentInfo" style="margin-top: 15px;"></div>
        </div>

        <div class="card">
          <h2>🌐 上游 DNS 服务器</h2>
          <div style="overflow-x: auto;">
            <table class="upstream-table">
              <thead><tr><th>状态</th><th>上游服务器</th><th>协议</th><th>区域</th><th>响应时间</th></tr></thead>
              <tbody id="upstreamList"></tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <h2>🔧 DNS 查询工具</h2>
          <div class="query-box">
            <input type="text" id="domain" placeholder="域名，如: google.com" value="google.com">
            <select id="recordType">
              <option value="A">A (IPv4)</option>
              <option value="AAAA">AAAA (IPv6)</option>
              <option value="MX">MX (邮件交换)</option>
              <option value="TXT">TXT (文本记录)</option>
              <option value="NS">NS (域名服务器)</option>
              <option value="all" selected>全部 (A/AAAA/MX/TXT/NS)</option>
            </select>
            <button onclick="queryDNS()" id="queryBtn">🚀 查询</button>
          </div>
          <div id="result" class="result">等待查询...</div>
        </div>

        <div class="card">
          <h2>📖 使用说明</h2>
          <p><strong>浏览器配置 DoH：</strong><br>
          Chrome/Edge: 设置 → 隐私和安全 → 安全 → 使用安全 DNS → 自定义<br>
          <strong>填入：</strong> <code>${currentDohUrl}</code></p>
          <p><strong>curl 示例：</strong><br>
          <code>curl "${currentDohUrl}?name=google.com&type=A"</code></p>
        </div>

        <div class="footer">
          <p>🚀 DoH Server | 自动故障转移 | 多协议支持</p>
        </div>
      </div>

      <script>
        function getProtocolClass(protocol) {
          const map = { doh: 'protocol-doh', dot: 'protocol-dot', tcp: 'protocol-tcp', udp: 'protocol-udp' };
          return map[protocol] || 'protocol-doh';
        }
        async function loadUpstreams() {
          try {
            const res = await fetch('/api/upstreams');
            const data = await res.json();
            const tbody = document.getElementById('upstreamList');
            tbody.innerHTML = '';
            data.upstreams.forEach(u => {
              const row = tbody.insertRow();
              row.insertCell(0).innerHTML = u.status === 'online' ? '<span class="status-online">● 在线</span>' : '<span class="status-offline">○ 离线</span>';
              row.insertCell(1).innerHTML = u.displayName;
              row.insertCell(2).innerHTML = '<span class="protocol-badge ' + getProtocolClass(u.protocol) + '">' + u.protocol.toUpperCase() + '</span>';
              row.insertCell(3).innerHTML = u.region;
              row.insertCell(4).innerHTML = u.responseTime ? u.responseTime + 'ms' : '-';
            });
            document.getElementById('currentInfo').innerHTML = '📡 当前使用: <strong>' + data.currentUpstream + '</strong> | 模式: ' + (data.mode === 'auto' ? '自动切换' : '手动固定');
          } catch(err) { console.error(err); }
        }
        async function queryDNS() {
          const domain = document.getElementById('domain').value.trim();
          const type = document.getElementById('recordType').value;
          if (!domain) { alert('请输入域名'); return; }
          const resultDiv = document.getElementById('result');
          const queryBtn = document.getElementById('queryBtn');
          resultDiv.innerHTML = '⏳ 查询中...';
          queryBtn.disabled = true;
          try {
            const url = '/api/dns?domain=' + encodeURIComponent(domain) + '&type=' + type;
            const res = await fetch(url);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            let html = '<strong>✅ ' + domain + ' 查询结果</strong><br>';
            if (data.upstream) html += '<small>📡 上游: ' + data.upstream + '</small><br><br>';
            if (type === 'all') {
              const types = ['A', 'AAAA', 'MX', 'TXT', 'NS'];
              for (const t of types) {
                const records = data[t] || [];
                html += '<div style="margin-bottom:15px;"><strong>📋 ' + t + ' 记录</strong><br>';
                if (records.length) records.forEach(r => { html += '&nbsp;&nbsp;→ ' + (r.data || r.exchange || JSON.stringify(r)) + '<br>'; });
                else html += '&nbsp;&nbsp;无记录<br>';
                html += '</div>';
              }
            } else {
              const records = data.Answer || [];
              html += '<strong>📋 ' + type + ' 记录</strong><br>';
              if (records.length) records.forEach(r => { html += '&nbsp;&nbsp;→ ' + (r.data || JSON.stringify(r)) + '<br>'; });
              else html += '&nbsp;&nbsp;无记录<br>';
            }
            resultDiv.innerHTML = html;
          } catch(err) {
            resultDiv.innerHTML = '❌ 查询失败: ' + err.message;
          } finally {
            queryBtn.disabled = false;
          }
        }
        document.getElementById('domain').addEventListener('keypress', e => { if(e.key === 'Enter') queryDNS(); });
        loadUpstreams();
        setInterval(loadUpstreams, 15000);
      </script>
    </body>
    </html>
  `);
});

// ============ DoH 端点 ============
app.all(`/${DoH路径}`, async (req, res) => {
  const { method, headers, body } = req;
  const UA = headers['user-agent'] || 'DoH Client';
  const contentType = headers['content-type'] || '';

  try {
    const upstream = getCurrentUpstream();
    let domain = null;
    let type = 'A';
    let response = null;

    const safeUpstreamName = sanitizeHeaderValue(upstream.displayName);
    res.set('Access-Control-Allow-Origin', '*');
    res.set('X-Upstream', safeUpstreamName);
    res.set('X-Protocol', upstream.protocol.toUpperCase());

    if (method === 'GET') {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.searchParams.has('name')) {
        domain = url.searchParams.get('name');
        type = url.searchParams.get('type') || 'A';
        const result = await queryDNS(upstream, domain, type);
        if (result.success && result.data) {
          res.set('Content-Type', 'application/json');
          return res.json(result.data);
        } else {
          res.set('Content-Type', 'application/json');
          return res.status(500).json({ error: 'DNS 查询失败', code: 'QUERY_FAILED' });
        }
      }
      if (url.searchParams.has('dns')) {
        response = await fetch(`${upstream.server}${url.search}`, {
          headers: { 'Accept': 'application/dns-message', 'User-Agent': UA }
        });
      } else {
        return res.status(400).json({ error: '缺少参数 name 或 dns' });
      }
    } else if (method === 'POST') {
      let rawBody = '';
      if (Buffer.isBuffer(body)) rawBody = body.toString('utf8');
      else if (typeof body === 'string') rawBody = body;
      else if (body && typeof body === 'object') rawBody = JSON.stringify(body);

      if (contentType.includes('application/dns-json')) {
        try {
          const jsonBody = (typeof body === 'object' && body !== null && !Buffer.isBuffer(body)) ? body : JSON.parse(rawBody);
          domain = jsonBody.name || jsonBody.domain;
          type = jsonBody.type || 'A';
        } catch (e) { return res.status(400).json({ error: '无效的 JSON 格式' }); }
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
        } catch (e) { return res.status(400).json({ error: '无效的表单格式' }); }
      } else if (contentType.includes('application/dns-message')) {
        response = await fetch(upstream.server, {
          method: 'POST',
          headers: { 'Accept': 'application/dns-message', 'Content-Type': 'application/dns-message', 'User-Agent': UA },
          body: body
        });
      } else if (rawBody.trim().startsWith('{')) {
        try {
          const jsonBody = JSON.parse(rawBody);
          domain = jsonBody.name || jsonBody.domain;
          type = jsonBody.type || 'A';
        } catch (e) { return res.status(400).json({ error: '无法解析 JSON 请求体' }); }
      } else if (rawBody.includes('=')) {
        try {
          const params = new URLSearchParams(rawBody);
          domain = params.get('name') || params.get('domain');
          type = params.get('type') || 'A';
        } catch (e) { return res.status(400).json({ error: '无法解析表单请求体' }); }
      }

      if (domain && !response) {
        const result = await queryDNS(upstream, domain, type);
        if (result.success && result.data) {
          res.set('Content-Type', 'application/json');
          return res.json(result.data);
        } else {
          return res.status(500).json({ error: 'DNS 查询失败', code: 'QUERY_FAILED' });
        }
      }
      if (!domain && !response) {
        return res.status(400).json({ error: '无法解析请求，请确保包含 name 或 domain 参数' });
      }
    }

    if (response) {
      if (!response.ok) throw new Error(`DoH 返回错误 (${response.status})`);
      const responseBody = await response.buffer();
      return res.status(response.status).send(responseBody);
    }
    return res.status(400).json({ error: '不支持的请求格式' });
  } catch (error) {
    console.error("DoH 请求处理错误:", error);
    res.status(500).json({ error: '内部服务器错误', message: error.message });
  }
});

// ============ 健康检查 ============
app.get('/health', (req, res) => {
  const status = getCurrentStatus();
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

// 启动服务器
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`========================================`);
  console.log(`🛡️ 多协议 DoH 服务器已启动（管理员后台模式）`);
  console.log(`📡 端口: ${PORT}`);
  console.log(`🔗 DoH 端点: /${DoH路径}`);
  console.log(`🌐 上游总数: ${upstreams.length}`);
  if (ADMIN_PASSWORD) console.log(`🔐 管理员后台: /admin (密码已设置)`);
  else console.log(`⚠️ 管理员后台未启用 (未设置 ADMIN_PASSWORD 环境变量)`);
  console.log(`========================================`);
  await healthCheck();
  setInterval(healthCheck, 60000);
});

process.on('SIGTERM', () => { console.log('正在关闭...'); process.exit(0); });
