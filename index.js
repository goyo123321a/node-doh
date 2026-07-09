// ==================== 环境变量默认值 ====================
const ENV_DEFAULTS = {
  ADMIN_USER: 'admin',
  ADMIN_PASS: '123321',
  CACHE_TTL: 60 * 1000,        // 配置缓存 1 分钟
  SESSION_TTL: 3600,           // Session 1 小时
  FASTEST_TIMEOUT: 5000,       // 实时选择超时 5 秒
  MAX_FAILOVER_ATTEMPTS: 3,    // 故障转移最大尝试次数（已弃用，但保留）
};

// ==================== 全局缓存 ====================
let cachedConfig = null;
let cacheExpiry = 0;
const CONFIG_KEY = 'config';
const SESSION_PREFIX = 'session:';

// ==================== 核心工具函数 ====================

// 从 KV 获取配置（带缓存）
async function getConfig(env) {
  if (Date.now() < cacheExpiry && cachedConfig) {
    return cachedConfig;
  }
  try {
    const kv = env.DOH_CONFIG;
    if (!kv) {
      console.warn('KV 未绑定，使用内存默认配置');
      const defaultConfig = {
        upstreams: [
          { id: 'cloudflare', name: 'Cloudflare', url: 'https://cloudflare-dns.com/dns-query', enabled: true, region: '全球' },
          { id: 'google', name: 'Google', url: 'https://dns.google/dns-query', enabled: true, region: '全球' },
          { id: 'quad9', name: 'Quad9', url: 'https://dns.quad9.net/dns-query', enabled: true, region: '全球' },
          { id: 'dns_sb', name: 'DNS.SB', url: 'https://dns.sb/dns-query', enabled: true, region: '全球' },
          { id: 'alidns', name: '阿里云', url: 'https://dns.alidns.com/dns-query', enabled: true, region: '中国' },
          { id: 'tencent', name: '腾讯云', url: 'https://doh.pub/dns-query', enabled: true, region: '中国' },
          { id: 'doh_360', name: '360', url: 'https://doh.360.cn/dns-query', enabled: true, region: '中国' },
          { id: 'adguard', name: 'AdGuard', url: 'https://dns.adguard-dns.com/dns-query', enabled: true, region: '全球' },
          { id: 'opendns', name: 'OpenDNS', url: 'https://doh.opendns.com/dns-query', enabled: true, region: '全球' }
        ],
        default: 'cloudflare',
        allow_custom: true,
        doh_path: 'dns-query',
        enable_auto_select: true
      };
      cachedConfig = defaultConfig;
      cacheExpiry = Date.now() + ENV_DEFAULTS.CACHE_TTL;
      return defaultConfig;
    }
    const data = await kv.get(CONFIG_KEY, 'json');
    const config = data || {
      upstreams: [
        { id: 'cloudflare', name: 'Cloudflare', url: 'https://cloudflare-dns.com/dns-query', enabled: true, region: '全球' },
        { id: 'google', name: 'Google', url: 'https://dns.google/dns-query', enabled: true, region: '全球' },
        { id: 'quad9', name: 'Quad9', url: 'https://dns.quad9.net/dns-query', enabled: true, region: '全球' },
        { id: 'dns_sb', name: 'DNS.SB', url: 'https://dns.sb/dns-query', enabled: true, region: '全球' },
        { id: 'alidns', name: '阿里云', url: 'https://dns.alidns.com/dns-query', enabled: true, region: '中国' },
        { id: 'tencent', name: '腾讯云', url: 'https://doh.pub/dns-query', enabled: true, region: '中国' },
        { id: 'doh_360', name: '360', url: 'https://doh.360.cn/dns-query', enabled: true, region: '中国' },
        { id: 'adguard', name: 'AdGuard', url: 'https://dns.adguard-dns.com/dns-query', enabled: true, region: '全球' },
        { id: 'opendns', name: 'OpenDNS', url: 'https://doh.opendns.com/dns-query', enabled: true, region: '全球' }
      ],
      default: 'cloudflare',
      allow_custom: true,
      doh_path: 'dns-query',
      enable_auto_select: true
    };
    cachedConfig = config;
    cacheExpiry = Date.now() + ENV_DEFAULTS.CACHE_TTL;
    return config;
  } catch (e) {
    console.error('KV 读取失败，使用默认配置', e);
    return {
      upstreams: [
        { id: 'cloudflare', name: 'Cloudflare', url: 'https://cloudflare-dns.com/dns-query', enabled: true },
        { id: 'alidns', name: '阿里 DNS', url: 'https://dns.alidns.com/resolve', enabled: true }
      ],
      default: 'cloudflare',
      allow_custom: true,
      doh_path: 'dns-query',
      enable_auto_select: true
    };
  }
}

// 保存配置到 KV
async function saveConfig(env, config) {
  const kv = env.DOH_CONFIG;
  if (!kv) {
    cachedConfig = config;
    cacheExpiry = Date.now() + ENV_DEFAULTS.CACHE_TTL;
    return;
  }
  await kv.put(CONFIG_KEY, JSON.stringify(config));
  cachedConfig = config;
  cacheExpiry = Date.now() + ENV_DEFAULTS.CACHE_TTL;
}

// Session 管理
function generateSessionId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

async function createSession(env, username) {
  const sid = generateSessionId();
  const expires = Date.now() + ENV_DEFAULTS.SESSION_TTL * 1000;
  const kv = env.DOH_CONFIG;
  if (kv) {
    await kv.put(`${SESSION_PREFIX}${sid}`, JSON.stringify({ username, expires }), { expirationTtl: ENV_DEFAULTS.SESSION_TTL });
  }
  return sid;
}

async function validateSession(env, request) {
  const cookie = request.headers.get('Cookie');
  if (!cookie) return null;
  const match = cookie.split(';').find(c => c.trim().startsWith('session_id='));
  if (!match) return null;
  const sid = match.split('=')[1].trim();
  const kv = env.DOH_CONFIG;
  if (!kv) return null;
  const session = await kv.get(`${SESSION_PREFIX}${sid}`, 'json');
  if (!session || session.expires < Date.now()) {
    if (session) await kv.delete(`${SESSION_PREFIX}${sid}`);
    return null;
  }
  return session.username;
}

async function destroySession(env, request) {
  const cookie = request.headers.get('Cookie');
  if (!cookie) return;
  const match = cookie.split(';').find(c => c.trim().startsWith('session_id='));
  if (match) {
    const sid = match.split('=')[1].trim();
    const kv = env.DOH_CONFIG;
    if (kv) await kv.delete(`${SESSION_PREFIX}${sid}`);
  }
}

// JSON 响应辅助
function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

// 管理员认证中间件
async function requireAdmin(env, request) {
  const username = await validateSession(env, request);
  if (!username) {
    return new Response('Unauthorized', { status: 401, headers: { 'Content-Type': 'text/plain' } });
  }
  const expected = env.ADMIN_USER || ENV_DEFAULTS.ADMIN_USER;
  if (username !== expected) {
    return new Response('Forbidden', { status: 403 });
  }
  return null; // 通过
}

// ==================== DNS 查询核心函数 ====================

// 向指定 DoH 服务器查询单个记录类型
async function queryDns(dohUrl, domain, type) {
  const url = new URL(dohUrl);
  url.searchParams.set('name', domain);
  url.searchParams.set('type', type);

  const acceptHeaders = ['application/dns-json', 'application/json', ''];
  let lastError = null;

  for (const accept of acceptHeaders) {
    try {
      const headers = {};
      if (accept) headers['Accept'] = accept;
      const resp = await fetch(url.toString(), { headers });
      if (!resp.ok) {
        const text = await resp.text();
        lastError = new Error(`HTTP ${resp.status}: ${text.slice(0, 100)}`);
        continue;
      }
      const contentType = resp.headers.get('content-type') || '';
      if (contentType.includes('json')) {
        return await resp.json();
      } else {
        const text = await resp.text();
        try { return JSON.parse(text); } catch (_) { throw new Error('响应不是 JSON'); }
      }
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('所有 DoH 尝试均失败');
}

// 查询 A、AAAA、NS 并合并结果
async function queryMultipleTypes(dohUrl, domain) {
  const [ipv4Result, ipv6Result, nsResult] = await Promise.all([
    queryDns(dohUrl, domain, 'A'),
    queryDns(dohUrl, domain, 'AAAA'),
    queryDns(dohUrl, domain, 'NS')
  ]);

  const nsRecords = [];
  if (nsResult.Answer) {
    nsRecords.push(...nsResult.Answer.filter(r => r.type === 2));
  }
  if (nsResult.Authority) {
    nsRecords.push(...nsResult.Authority.filter(r => r.type === 2 || r.type === 6));
  }

  const question = [];
  [ipv4Result, ipv6Result, nsResult].forEach(res => {
    if (res.Question) {
      if (Array.isArray(res.Question)) question.push(...res.Question);
      else question.push(res.Question);
    }
  });

  return {
    Status: ipv4Result.Status || ipv6Result.Status || nsResult.Status,
    TC: ipv4Result.TC || ipv6Result.TC || nsResult.TC,
    RD: ipv4Result.RD || ipv6Result.RD || nsResult.RD,
    RA: ipv4Result.RA || ipv6Result.RA || nsResult.RA,
    AD: ipv4Result.AD || ipv6Result.AD || nsResult.AD,
    CD: ipv4Result.CD || ipv6Result.CD || nsResult.CD,
    Question: question,
    Answer: [
      ...(ipv4Result.Answer || []),
      ...(ipv6Result.Answer || []),
      ...nsRecords
    ],
    ipv4: { records: ipv4Result.Answer || [] },
    ipv6: { records: ipv6Result.Answer || [] },
    ns: { records: nsRecords }
  };
}

// ==================== 实时选择最快上游 ====================

// 并发请求所有启用的上游，返回最快响应的那个（或 null）
async function selectFastestUpstream(env, config, domain, type = 'A') {
  const enabled = config.upstreams.filter(u => u.enabled);
  if (enabled.length === 0) return null;

  // 构造每个上游的请求，但只请求状态码和响应时间
  const fetchPromises = enabled.map(async (upstream) => {
    const start = Date.now();
    try {
      const url = new URL(upstream.url);
      url.searchParams.set('name', domain || 'google.com'); // 若未指定查询域名，用 google.com 测试
      url.searchParams.set('type', type);
      const resp = await fetch(url.toString(), {
        headers: { 'Accept': 'application/dns-json' },
        signal: AbortSignal.timeout(ENV_DEFAULTS.FASTEST_TIMEOUT)
      });
      const elapsed = Date.now() - start;
      if (!resp.ok) {
        return { id: upstream.id, alive: false, latency: Infinity };
      }
      // 快速检查是否为 JSON（不解析）
      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('json')) {
        // 可能不是 JSON，但有些服务器返回 text/plain 但内容仍是 JSON，我们尝试读取一小部分判断
        // 为简化，我们默认接受任何 200 响应
      }
      return { id: upstream.id, alive: true, latency: elapsed };
    } catch (err) {
      return { id: upstream.id, alive: false, latency: Infinity };
    }
  });

  const results = await Promise.all(fetchPromises);
  // 筛选出存活的，按延迟升序
  const alive = results.filter(r => r.alive).sort((a, b) => a.latency - b.latency);
  if (alive.length === 0) return null;
  // 返回对应的 upstream 对象
  const fastestId = alive[0].id;
  return config.upstreams.find(u => u.id === fastestId);
}

// ==================== 管理 API 处理器 ====================
async function handleAdminAPI(request, env, url) {
  const auth = await requireAdmin(env, request);
  if (auth) return auth;

  const path = url.pathname.replace('/api/admin/', '');
  const method = request.method;
  const config = await getConfig(env);

  try {
    // GET /upstreams
    if (path === 'upstreams' && method === 'GET') {
      return json(config.upstreams);
    }

    // POST /upstreams
    if (path === 'upstreams' && method === 'POST') {
      const body = await request.json();
      if (!body.name || !body.url) return json({ error: '缺少 name 或 url' }, 400);
      const newUpstream = {
        id: body.id || Date.now().toString(36),
        name: body.name,
        url: body.url,
        enabled: body.enabled !== undefined ? body.enabled : true,
        region: body.region || '全球'
      };
      config.upstreams.push(newUpstream);
      await saveConfig(env, config);
      return json({ success: true, id: newUpstream.id });
    }

    // PUT /upstreams/:id
    if (path.startsWith('upstreams/') && method === 'PUT') {
      const id = path.split('/')[1];
      const body = await request.json();
      const idx = config.upstreams.findIndex(u => u.id === id);
      if (idx === -1) return json({ error: 'Not found' }, 404);
      config.upstreams[idx] = { ...config.upstreams[idx], ...body };
      await saveConfig(env, config);
      return json({ success: true });
    }

    // DELETE /upstreams/:id
    if (path.startsWith('upstreams/') && method === 'DELETE') {
      const id = path.split('/')[1];
      config.upstreams = config.upstreams.filter(u => u.id !== id);
      if (config.default === id) {
        const first = config.upstreams.find(u => u.enabled);
        config.default = first ? first.id : '';
      }
      await saveConfig(env, config);
      return json({ success: true });
    }

    // GET /config
    if (path === 'config' && method === 'GET') {
      return json({
        default: config.default,
        allow_custom: config.allow_custom,
        doh_path: config.doh_path,
        enable_auto_select: config.enable_auto_select
      });
    }

    // PUT /config
    if (path === 'config' && method === 'PUT') {
      const body = await request.json();
      if (body.default !== undefined) {
        const exists = config.upstreams.some(u => u.id === body.default && u.enabled);
        if (!exists) return json({ error: '默认服务器不存在或已禁用' }, 400);
        config.default = body.default;
      }
      if (body.allow_custom !== undefined) config.allow_custom = body.allow_custom;
      if (body.doh_path !== undefined) {
        if (!/^[a-zA-Z0-9\-_/]+$/.test(body.doh_path)) {
          return json({ error: '路径格式不合法' }, 400);
        }
        config.doh_path = body.doh_path;
      }
      if (body.enable_auto_select !== undefined) {
        config.enable_auto_select = body.enable_auto_select;
      }
      await saveConfig(env, config);
      return json({ success: true });
    }

    // POST /logout
    if (path === 'logout' && method === 'POST') {
      await destroySession(env, request);
      return json({ success: true });
    }

    return json({ error: 'API 不存在' }, 404);
  } catch (e) {
    console.error('管理 API 错误:', e);
    return json({ error: e.message }, 500);
  }
}

// ==================== 登录处理器 ====================
async function handleLogin(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const { username, password } = await request.json();
  const expectedUser = env.ADMIN_USER || ENV_DEFAULTS.ADMIN_USER;
  const expectedPass = env.ADMIN_PASS || ENV_DEFAULTS.ADMIN_PASS;
  if (username === expectedUser && password === expectedPass) {
    const sid = await createSession(env, username);
    const response = json({ success: true });
    response.headers.set(
      'Set-Cookie',
      `session_id=${sid}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ENV_DEFAULTS.SESSION_TTL}`
    );
    return response;
  }
  return json({ error: '用户名或密码错误' }, 401);
}

// ==================== 公共 API：上游列表 ====================
async function handlePublicUpstreams(env) {
  const config = await getConfig(env);
  const list = config.upstreams.filter(u => u.enabled).map(u => ({
    id: u.id,
    name: u.name,
    url: u.url
  }));
  return json(list);
}

// ==================== 管理面板 HTML（简化，移除延迟列和健康检查按钮） ====================
function renderAdminPage() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DoH 管理面板</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <style>
    body { padding: 20px; background: #f8f9fa; }
    .container { max-width: 1000px; }
    .card { margin-bottom: 20px; }
    .table td { vertical-align: middle; }
  </style>
</head>
<body>
<div class="container">
  <h1 class="mb-4">🔧 DoH 管理面板</h1>
  <div class="card">
    <div class="card-header d-flex justify-content-between align-items-center">
      <span>上游 DoH 服务器</span>
      <button class="btn btn-primary btn-sm" id="addBtn">+ 添加</button>
    </div>
    <div class="card-body">
      <table class="table table-hover">
        <thead><tr><th>名称</th><th>URL</th><th>区域</th><th>状态</th><th>操作</th></tr></thead>
        <tbody id="upstreamsBody"></tbody>
      </table>
    </div>
  </div>
  <div class="card">
    <div class="card-header">全局设置</div>
    <div class="card-body">
      <form id="configForm">
        <div class="mb-3">
          <label for="defaultServer" class="form-label">默认服务器（手动备用）</label>
          <select id="defaultServer" class="form-select"></select>
        </div>
        <div class="mb-3 form-check">
          <input type="checkbox" class="form-check-input" id="allowCustom">
          <label class="form-check-label" for="allowCustom">允许用户自定义 DoH 地址</label>
        </div>
        <div class="mb-3 form-check">
          <input type="checkbox" class="form-check-input" id="enableAutoSelect">
          <label class="form-check-label" for="enableAutoSelect">启用自动选择上游（实时最快）</label>
        </div>
        <div class="mb-3">
          <label for="dohPath" class="form-label">DoH 端点路径（如 dns-query）</label>
          <input type="text" class="form-control" id="dohPath" placeholder="dns-query">
        </div>
        <button type="submit" class="btn btn-success">保存设置</button>
      </form>
    </div>
  </div>
  <div class="mt-3">
    <button class="btn btn-danger" id="logoutBtn">退出登录</button>
    <a href="/" class="btn btn-secondary">返回首页</a>
  </div>
</div>
<script>
  async function loadData() {
    const resp = await fetch('/api/admin/upstreams');
    const upstreams = await resp.json();
    const tbody = document.getElementById('upstreamsBody');
    tbody.innerHTML = '';
    upstreams.forEach(u => {
      const tr = document.createElement('tr');
      tr.innerHTML = \`
        <td>\${u.name}</td>
        <td>\${u.url}</td>
        <td>\${u.region || '全球'}</td>
        <td><span class="badge bg-success">✅ 启用</span></td>
        <td>
          <button class="btn btn-sm btn-outline-primary edit-btn" data-id="\${u.id}">编辑</button>
          <button class="btn btn-sm btn-outline-danger delete-btn" data-id="\${u.id}">删除</button>
        </td>
      \`;
      tbody.appendChild(tr);
    });
    document.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', () => editUpstream(btn.dataset.id));
    });
    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteUpstream(btn.dataset.id));
    });

    const configResp = await fetch('/api/admin/config');
    const config = await configResp.json();
    const defaultSelect = document.getElementById('defaultServer');
    defaultSelect.innerHTML = '';
    upstreams.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.name;
      if (u.id === config.default) opt.selected = true;
      defaultSelect.appendChild(opt);
    });
    document.getElementById('allowCustom').checked = config.allow_custom;
    document.getElementById('enableAutoSelect').checked = config.enable_auto_select;
    document.getElementById('dohPath').value = config.doh_path;
  }

  document.getElementById('addBtn').addEventListener('click', () => {
    const name = prompt('请输入上游名称：');
    if (!name) return;
    const url = prompt('请输入 DoH URL：');
    if (!url) return;
    const region = prompt('请输入区域（如 全球/中国）：') || '全球';
    fetch('/api/admin/upstreams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, url, region, enabled: true })
    }).then(res => res.json()).then(data => {
      if (data.success) loadData();
      else alert('添加失败：' + data.error);
    });
  });

  async function editUpstream(id) {
    const resp = await fetch('/api/admin/upstreams');
    const upstreams = await resp.json();
    const u = upstreams.find(item => item.id === id);
    if (!u) return;
    const newName = prompt('修改名称：', u.name);
    if (newName === null) return;
    const newUrl = prompt('修改 URL：', u.url);
    if (newUrl === null) return;
    const newRegion = prompt('修改区域：', u.region || '全球');
    if (newRegion === null) return;
    const newEnabled = confirm('是否启用？') ? true : false;
    fetch('/api/admin/upstreams/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName, url: newUrl, region: newRegion, enabled: newEnabled })
    }).then(res => res.json()).then(data => {
      if (data.success) loadData();
      else alert('更新失败：' + data.error);
    });
  }

  function deleteUpstream(id) {
    if (!confirm('确定要删除此上游吗？')) return;
    fetch('/api/admin/upstreams/' + id, { method: 'DELETE' })
      .then(res => res.json()).then(data => {
        if (data.success) loadData();
        else alert('删除失败：' + data.error);
      });
  }

  document.getElementById('configForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const defaultServer = document.getElementById('defaultServer').value;
    const allowCustom = document.getElementById('allowCustom').checked;
    const enableAutoSelect = document.getElementById('enableAutoSelect').checked;
    const dohPath = document.getElementById('dohPath').value.trim();
    if (!dohPath) { alert('路径不能为空'); return; }
    const resp = await fetch('/api/admin/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        default: defaultServer, 
        allow_custom: allowCustom, 
        enable_auto_select: enableAutoSelect,
        doh_path: dohPath 
      })
    });
    const data = await resp.json();
    if (data.success) {
      alert('设置已保存');
      loadData();
    } else {
      alert('保存失败：' + data.error);
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    location.reload();
  });

  loadData();
</script>
</body>
</html>`;
}

// ==================== 登录页面 HTML ====================
function renderLoginPage(message = '') {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>管理员登录</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <style>
    body { display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #f8f9fa; }
    .login-card { width: 100%; max-width: 400px; }
  </style>
</head>
<body>
<div class="card login-card">
  <div class="card-body">
    <h3 class="card-title text-center mb-4">管理员登录</h3>
    ${message ? `<div class="alert alert-danger">${message}</div>` : ''}
    <form id="loginForm">
      <div class="mb-3">
        <label for="username" class="form-label">用户名</label>
        <input type="text" class="form-control" id="username" required>
      </div>
      <div class="mb-3">
        <label for="password" class="form-label">密码</label>
        <input type="password" class="form-control" id="password" required>
      </div>
      <button type="submit" class="btn btn-primary w-100">登录</button>
    </form>
  </div>
</div>
<script>
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const resp = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await resp.json();
    if (data.success) {
      location.href = '/admin';
    } else {
      alert('登录失败：' + data.error);
    }
  });
</script>
</body>
</html>`;
}

// ==================== 公共首页（保持不变） ====================
async function renderPublicPage(env) {
  const config = await getConfig(env);
  const dohPath = config.doh_path || 'dns-query';
  const autoSelect = config.enable_auto_select ? true : false;
  let fixedUpstreamName = '未配置';
  if (!autoSelect) {
    const defaultUpstream = config.upstreams.find(u => u.id === config.default && u.enabled);
    if (defaultUpstream) fixedUpstreamName = defaultUpstream.name;
  }
  const hostname = new URL(env.URL || 'https://example.com').hostname || '...';

  return new Response(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DNS-over-HTTPS Resolver</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css">
  <link rel="icon" href="https://cf-assets.www.cloudflare.com/dzlvafdwdttg/6TaQ8Q7BDmdAFRoHpDCb82/8d9bc52a2ac5af100de3a9adcf99ffaa/security-shield-protection-2.svg" type="image/x-icon">
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      min-height: 100vh;
      padding: 0;
      margin: 0;
      line-height: 1.6;
      background: url('https://cf-assets.www.cloudflare.com/dzlvafdwdttg/5B5shLB8bSKIyB9NJ6R1jz/87e7617be2c61603d46003cb3f1bd382/Hero-globe-bg-takeover-xxl.png'),
                  linear-gradient(135deg, rgba(253, 101, 60, 0.85) 0%, rgba(251,152,30, 0.85) 100%);
      background-size: cover;
      background-position: center center;
      background-repeat: no-repeat;
      background-attachment: fixed;
      padding: 30px 20px;
      box-sizing: border-box;
    }
    .container {
      width: 100%;
      max-width: 800px;
      margin: 20px auto;
      background-color: rgba(255,255,255,0.65);
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.15);
      padding: 30px;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255,255,255,0.4);
    }
    h1 {
      background-image: linear-gradient(to right, rgb(249,171,76), rgb(252,103,60));
      color: rgb(252,103,60);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      font-weight: 600;
    }
    .card {
      margin-bottom: 20px;
      border: none;
      box-shadow: 0 2px 10px rgba(0,0,0,0.05);
      background-color: rgba(255,255,255,0.8);
      backdrop-filter: blur(5px);
    }
    .card-header {
      background-color: rgba(255,242,235,0.9);
      font-weight: 600;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .form-label {
      font-weight: 500;
      color: rgb(70,50,40);
    }
    .btn-primary {
      background-color: rgb(253,101,60);
      border: none;
    }
    .btn-primary:hover {
      background-color: rgb(230,90,50);
    }
    pre {
      background-color: rgba(255,245,240,0.9);
      padding: 15px;
      border-radius: 6px;
      border: 1px solid rgba(253,101,60,0.2);
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 400px;
      overflow: auto;
    }
    .loading {
      display: none;
      text-align: center;
      padding: 20px 0;
    }
    .loading-spinner {
      border: 4px solid rgba(0,0,0,0.1);
      border-left: 4px solid rgb(253,101,60);
      border-radius: 50%;
      width: 30px;
      height: 30px;
      animation: spin 1s linear infinite;
      margin: 0 auto 10px;
    }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    .badge { margin-left: 5px; }
    .ip-record {
      padding: 5px 10px;
      margin-bottom: 5px;
      border-radius: 4px;
      background-color: rgba(255,255,255,0.9);
      border: 1px solid rgba(253,101,60,0.15);
    }
    .ip-record:hover { background-color: rgba(255,235,225,0.9); }
    .ip-address {
      font-family: monospace;
      font-weight: 600;
      cursor: pointer;
    }
    .ip-address.copied:after { content: '✓ 已复制'; opacity: 1; }
    .geo-blocked {
      color: #fff;
      background-color: #dc3545;
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 600;
      animation: pulse-red 2s infinite;
    }
    @keyframes pulse-red {
      0% { box-shadow: 0 0 0 0 rgba(220,53,69,0.7); }
      70% { box-shadow: 0 0 0 10px rgba(220,53,69,0); }
      100% { box-shadow: 0 0 0 0 rgba(220,53,69,0); }
    }
    .geo-loading { color: rgb(150,100,80); font-style: italic; }
    .ttl-info { min-width: 80px; text-align: right; color: rgb(180,90,60); }
    .copy-link {
      color: rgb(253,101,60);
      text-decoration: none;
      border-bottom: 1px dashed rgb(253,101,60);
      cursor: pointer;
    }
    .copy-link.copied:after { content: '✓ 已复制'; opacity: 1; }
    .github-corner svg {
      fill: #fff;
      color: rgb(251,152,30);
      position: absolute;
      top: 0;
      right: 0;
      border: 0;
      width: 80px;
      height: 80px;
    }
    .github-corner:hover .octo-arm {
      animation: octocat-wave 560ms ease-in-out;
    }
    @keyframes octocat-wave {
      0%,100%{transform:rotate(0)}20%,60%{transform:rotate(-25deg)}40%,80%{transform:rotate(10deg)}
    }
    @media (max-width:576px){ .github-corner .octo-arm{animation:octocat-wave 560ms ease-in-out} }
    .info-line {
      font-size: 14px;
      color: #6c757d;
      text-align: center;
      margin-top: 10px;
    }
    .admin-link .btn {
      font-size: 0.9rem;
    }
  </style>
</head>
<body>
<a href="https://github.com/cmliu/CF-Workers-DoH" target="_blank" class="github-corner" aria-label="View source on Github">
  <svg viewBox="0 0 250 250" aria-hidden="true"><path d="M0,0 L115,115 L130,115 L142,142 L250,250 L250,0 Z"></path><path d="M128.3,109.0 C113.8,99.7 119.0,89.6 119.0,89.6 C122.0,82.7 120.5,78.6 120.5,78.6 C119.2,72.0 123.4,76.3 123.4,76.3 C127.3,80.9 125.5,87.3 125.5,87.3 C122.9,97.6 130.6,101.9 134.4,103.2" fill="currentColor" style="transform-origin: 130px 106px;" class="octo-arm"></path><path d="M115.0,115.0 C114.9,115.1 118.7,116.5 119.8,115.4 L133.7,101.6 C136.9,99.2 139.9,98.4 142.2,98.6 C133.8,88.0 127.5,74.4 143.8,58.0 C148.5,53.4 154.0,51.2 159.7,51.0 C160.3,49.4 163.2,43.6 171.4,40.1 C171.4,40.1 176.1,42.5 178.8,56.2 C183.1,58.6 187.2,61.8 190.9,65.4 C194.5,69.0 197.7,73.2 200.1,77.6 C213.8,80.2 216.3,84.9 216.3,84.9 C212.7,93.1 206.9,96.0 205.4,96.6 C205.1,102.4 203.0,107.8 198.3,112.5 C181.9,128.9 168.3,122.5 157.7,114.1 C157.9,116.9 156.7,120.9 152.7,124.9 L141.0,136.5 C139.8,137.7 141.6,141.9 141.8,141.8 Z" fill="currentColor" class="octo-body"></path></svg>
</a>
<div class="container">
  <h1 class="text-center mb-4">DNS-over-HTTPS Resolver</h1>
  <div class="card">
    <div class="card-header">
      <span>DNS 查询</span>
      <span class="admin-link">
        <a href="/admin" target="_blank" class="btn btn-sm btn-outline-secondary">管理员登录</a>
      </span>
    </div>
    <div class="card-body">
      <form id="resolveForm">
        <div class="mb-3">
          <label for="domain" class="form-label">待解析域名:</label>
          <div class="input-group">
            <input type="text" id="domain" class="form-control" value="www.google.com" placeholder="输入域名，如 example.com">
            <button type="button" class="btn btn-outline-secondary" id="clearBtn">清除</button>
          </div>
        </div>
        <div class="d-flex gap-2">
          <button type="submit" class="btn btn-primary flex-grow-1">解析</button>
          <button type="button" class="btn btn-outline-primary" id="getJsonBtn">Get Json</button>
        </div>
      </form>
    </div>
  </div>

  <div class="card">
    <div class="card-header d-flex justify-content-between align-items-center">
      <span>解析结果</span>
      <button class="btn btn-sm btn-outline-secondary" id="copyBtn" style="display: none;">复制结果</button>
    </div>
    <div class="card-body">
      <div id="loading" class="loading"><div class="loading-spinner"></div><p>正在查询中，请稍候...</p></div>
      <div id="resultContainer" style="display: none;">
        <ul class="nav nav-tabs" id="resultTabs">
          <li class="nav-item"><button class="nav-link active" id="ipv4-tab" data-bs-toggle="tab" data-bs-target="#ipv4">IPv4</button></li>
          <li class="nav-item"><button class="nav-link" id="ipv6-tab" data-bs-toggle="tab" data-bs-target="#ipv6">IPv6</button></li>
          <li class="nav-item"><button class="nav-link" id="ns-tab" data-bs-toggle="tab" data-bs-target="#ns">NS</button></li>
          <li class="nav-item"><button class="nav-link" id="raw-tab" data-bs-toggle="tab" data-bs-target="#raw">原始</button></li>
        </ul>
        <div class="tab-content">
          <div class="tab-pane fade show active" id="ipv4"><div id="ipv4Summary"></div><div id="ipv4Records"></div></div>
          <div class="tab-pane fade" id="ipv6"><div id="ipv6Summary"></div><div id="ipv6Records"></div></div>
          <div class="tab-pane fade" id="ns"><div id="nsSummary"></div><div id="nsRecords"></div></div>
          <div class="tab-pane fade" id="raw"><pre id="result">等待查询...</pre></div>
        </div>
      </div>
      <div id="errorContainer" style="display: none;"><pre id="errorMessage" class="error-message"></pre></div>
    </div>
  </div>

  <div class="info-line">
    <strong>DoH 端点：</strong><span id="dohUrlDisplay" class="copy-link" title="点击复制">https://<span id="currentDomain">${hostname}</span>/${dohPath}</span>
    <br>
    <span id="upstreamInfo">
      ${autoSelect ? '⚡ 当前模式：<strong>自动选择</strong>（每次请求实时选取最快上游）' : `🔒 固定上游：<strong>${fixedUpstreamName}</strong>`}
    </span>
    <br>
    <small>管理员可在后台更改配置</small>
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
<script>
  const currentHost = window.location.host;
  const currentProtocol = window.location.protocol;
  const currentDohPath = '${dohPath}';
  const dohEndpoint = currentProtocol + '//' + currentHost + '/' + currentDohPath;

  const 阻断IPv4 = ['104.21.16.1','104.21.32.1','104.21.48.1','104.21.64.1','104.21.80.1','104.21.96.1','104.21.112.1'];
  const 阻断IPv6 = ['2606:4700:3030::6815:1001','2606:4700:3030::6815:3001','2606:4700:3030::6815:7001','2606:4700:3030::6815:5001'];
  function isBlockedIP(ip) { return 阻断IPv4.includes(ip) || 阻断IPv6.includes(ip); }

  document.getElementById('clearBtn').addEventListener('click', function() {
    document.getElementById('domain').value = '';
    document.getElementById('domain').focus();
  });

  document.getElementById('copyBtn').addEventListener('click', function() {
    const text = document.getElementById('result').textContent;
    navigator.clipboard.writeText(text).then(() => {
      const orig = this.textContent;
      this.textContent = '已复制';
      setTimeout(() => { this.textContent = orig; }, 2000);
    }).catch(err => console.error(err));
  });

  function formatTTL(sec) {
    if (sec < 60) return sec + '秒';
    if (sec < 3600) return Math.floor(sec/60) + '分钟';
    if (sec < 86400) return Math.floor(sec/3600) + '小时';
    return Math.floor(sec/86400) + '天';
  }

  async function queryIpGeoInfo(ip) {
    try {
      const resp = await fetch(\`./ip-info?ip=\${ip}&token=${dohPath}\`);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return await resp.json();
    } catch(e) { console.error(e); return null; }
  }

  function handleCopyClick(el, text) {
    navigator.clipboard.writeText(text).then(() => {
      el.classList.add('copied');
      setTimeout(() => el.classList.remove('copied'), 2000);
    }).catch(err => console.error(err));
  }

  function displayRecords(data) {
    document.getElementById('resultContainer').style.display = 'block';
    document.getElementById('errorContainer').style.display = 'none';
    document.getElementById('result').textContent = JSON.stringify(data, null, 2);

    const ipv4Records = data.ipv4?.records || [];
    const ipv4Container = document.getElementById('ipv4Records');
    ipv4Container.innerHTML = '';
    if (ipv4Records.length === 0) {
      document.getElementById('ipv4Summary').innerHTML = '<strong>未找到 IPv4 记录</strong>';
    } else {
      document.getElementById('ipv4Summary').innerHTML = \`<strong>找到 \${ipv4Records.length} 条 IPv4 记录</strong>\`;
      ipv4Records.forEach(record => {
        const div = document.createElement('div');
        div.className = 'ip-record';
        if (record.type === 5) {
          div.innerHTML = \`
            <div class="d-flex justify-content-between align-items-center">
              <span class="ip-address" data-copy="\${record.data}">\${record.data}</span>
              <span class="badge bg-success">CNAME</span>
              <span class="text-muted ttl-info">TTL: \${formatTTL(record.TTL)}</span>
            </div>
          \`;
          ipv4Container.appendChild(div);
          const copyEl = div.querySelector('.ip-address');
          copyEl.addEventListener('click', function() { handleCopyClick(this, this.dataset.copy); });
        } else if (record.type === 1) {
          div.innerHTML = \`
            <div class="d-flex justify-content-between align-items-center">
              <span class="ip-address" data-copy="\${record.data}">\${record.data}</span>
              <span class="geo-info geo-loading">正在获取位置信息...</span>
              <span class="text-muted ttl-info">TTL: \${formatTTL(record.TTL)}</span>
            </div>
          \`;
          ipv4Container.appendChild(div);
          const copyEl = div.querySelector('.ip-address');
          copyEl.addEventListener('click', function() { handleCopyClick(this, this.dataset.copy); });
          const geoSpan = div.querySelector('.geo-info');
          const ip = record.data;
          if (isBlockedIP(ip)) {
            queryIpGeoInfo(ip).then(geo => {
              geoSpan.innerHTML = ''; geoSpan.classList.remove('geo-loading');
              const b = document.createElement('span'); b.className = 'geo-blocked'; b.textContent = '阻断IP';
              geoSpan.appendChild(b);
              if (geo && geo.status === 'success' && geo.as) {
                const as = document.createElement('span'); as.className = 'geo-as'; as.textContent = geo.as;
                geoSpan.appendChild(as);
              }
            }).catch(() => {
              geoSpan.innerHTML = ''; geoSpan.classList.remove('geo-loading');
              const b = document.createElement('span'); b.className = 'geo-blocked'; b.textContent = '阻断IP';
              geoSpan.appendChild(b);
            });
          } else {
            queryIpGeoInfo(ip).then(geo => {
              if (geo && geo.status === 'success') {
                geoSpan.innerHTML = ''; geoSpan.classList.remove('geo-loading');
                const c = document.createElement('span'); c.className = 'geo-country'; c.textContent = geo.country || '未知国家';
                geoSpan.appendChild(c);
                const as = document.createElement('span'); as.className = 'geo-as'; as.textContent = geo.as || '未知 AS';
                geoSpan.appendChild(as);
              } else {
                geoSpan.textContent = '位置信息获取失败';
              }
            });
          }
        }
      });
    }

    const ipv6Records = data.ipv6?.records || [];
    const ipv6Container = document.getElementById('ipv6Records');
    ipv6Container.innerHTML = '';
    if (ipv6Records.length === 0) {
      document.getElementById('ipv6Summary').innerHTML = '<strong>未找到 IPv6 记录</strong>';
    } else {
      document.getElementById('ipv6Summary').innerHTML = \`<strong>找到 \${ipv6Records.length} 条 IPv6 记录</strong>\`;
      ipv6Records.forEach(record => {
        const div = document.createElement('div');
        div.className = 'ip-record';
        if (record.type === 5) {
          div.innerHTML = \`
            <div class="d-flex justify-content-between align-items-center">
              <span class="ip-address" data-copy="\${record.data}">\${record.data}</span>
              <span class="badge bg-success">CNAME</span>
              <span class="text-muted ttl-info">TTL: \${formatTTL(record.TTL)}</span>
            </div>
          \`;
          ipv6Container.appendChild(div);
          const copyEl = div.querySelector('.ip-address');
          copyEl.addEventListener('click', function() { handleCopyClick(this, this.dataset.copy); });
        } else if (record.type === 28) {
          div.innerHTML = \`
            <div class="d-flex justify-content-between align-items-center">
              <span class="ip-address" data-copy="\${record.data}">\${record.data}</span>
              <span class="geo-info geo-loading">正在获取位置信息...</span>
              <span class="text-muted ttl-info">TTL: \${formatTTL(record.TTL)}</span>
            </div>
          \`;
          ipv6Container.appendChild(div);
          const copyEl = div.querySelector('.ip-address');
          copyEl.addEventListener('click', function() { handleCopyClick(this, this.dataset.copy); });
          const geoSpan = div.querySelector('.geo-info');
          const ip = record.data;
          if (isBlockedIP(ip)) {
            queryIpGeoInfo(ip).then(geo => {
              geoSpan.innerHTML = ''; geoSpan.classList.remove('geo-loading');
              const b = document.createElement('span'); b.className = 'geo-blocked'; b.textContent = '阻断IP';
              geoSpan.appendChild(b);
              if (geo && geo.status === 'success' && geo.as) {
                const as = document.createElement('span'); as.className = 'geo-as'; as.textContent = geo.as;
                geoSpan.appendChild(as);
              }
            }).catch(() => {
              geoSpan.innerHTML = ''; geoSpan.classList.remove('geo-loading');
              const b = document.createElement('span'); b.className = 'geo-blocked'; b.textContent = '阻断IP';
              geoSpan.appendChild(b);
            });
          } else {
            queryIpGeoInfo(ip).then(geo => {
              if (geo && geo.status === 'success') {
                geoSpan.innerHTML = ''; geoSpan.classList.remove('geo-loading');
                const c = document.createElement('span'); c.className = 'geo-country'; c.textContent = geo.country || '未知国家';
                geoSpan.appendChild(c);
                const as = document.createElement('span'); as.className = 'geo-as'; as.textContent = geo.as || '未知 AS';
                geoSpan.appendChild(as);
              } else {
                geoSpan.textContent = '位置信息获取失败';
              }
            });
          }
        }
      });
    }

    const nsRecords = data.ns?.records || [];
    const nsContainer = document.getElementById('nsRecords');
    nsContainer.innerHTML = '';
    if (nsRecords.length === 0) {
      document.getElementById('nsSummary').innerHTML = '<strong>未找到 NS 记录</strong>';
    } else {
      document.getElementById('nsSummary').innerHTML = \`<strong>找到 \${nsRecords.length} 条名称服务器记录</strong>\`;
      nsRecords.forEach(record => {
        const div = document.createElement('div');
        div.className = 'ip-record';
        if (record.type === 2) {
          div.innerHTML = \`
            <div class="d-flex justify-content-between align-items-center">
              <span class="ip-address" data-copy="\${record.data}">\${record.data}</span>
              <span class="badge bg-info">NS</span>
              <span class="text-muted ttl-info">TTL: \${formatTTL(record.TTL)}</span>
            </div>
          \`;
          nsContainer.appendChild(div);
          const copyEl = div.querySelector('.ip-address');
          copyEl.addEventListener('click', function() { handleCopyClick(this, this.dataset.copy); });
        } else if (record.type === 6) {
          const parts = record.data.split(' ');
          let adminEmail = parts[1].replace('.', '@');
          if (adminEmail.endsWith('.')) adminEmail = adminEmail.slice(0, -1);
          div.innerHTML = \`
            <div class="d-flex justify-content-between align-items-center mb-2">
              <span class="ip-address" data-copy="\${record.name}">\${record.name}</span>
              <span class="badge bg-warning">SOA</span>
              <span class="text-muted ttl-info">TTL: \${formatTTL(record.TTL)}</span>
            </div>
            <div class="ps-3 small">
              <div><strong>主 NS:</strong> <span class="ip-address" data-copy="\${parts[0]}">\${parts[0]}</span></div>
              <div><strong>管理邮箱:</strong> <span class="ip-address" data-copy="\${adminEmail}">\${adminEmail}</span></div>
              <div><strong>序列号:</strong> \${parts[2]}</div>
              <div><strong>刷新间隔:</strong> \${formatTTL(parts[3])}</div>
              <div><strong>重试间隔:</strong> \${formatTTL(parts[4])}</div>
              <div><strong>过期时间:</strong> \${formatTTL(parts[5])}</div>
              <div><strong>最小 TTL:</strong> \${formatTTL(parts[6])}</div>
            </div>
          \`;
          nsContainer.appendChild(div);
          div.querySelectorAll('.ip-address').forEach(el => {
            el.addEventListener('click', function() { handleCopyClick(this, this.dataset.copy); });
          });
        } else {
          div.innerHTML = \`
            <div class="d-flex justify-content-between align-items-center">
              <span class="ip-address" data-copy="\${record.data}">\${record.data}</span>
              <span class="badge bg-secondary">类型: \${record.type}</span>
              <span class="text-muted ttl-info">TTL: \${formatTTL(record.TTL)}</span>
            </div>
          \`;
          nsContainer.appendChild(div);
          const copyEl = div.querySelector('.ip-address');
          copyEl.addEventListener('click', function() { handleCopyClick(this, this.dataset.copy); });
        }
      });
    }

    document.getElementById('copyBtn').style.display = 'block';
  }

  function displayError(msg) {
    document.getElementById('resultContainer').style.display = 'none';
    document.getElementById('errorContainer').style.display = 'block';
    document.getElementById('errorMessage').textContent = msg;
    document.getElementById('copyBtn').style.display = 'none';
  }

  document.getElementById('resolveForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const domain = document.getElementById('domain').value;
    if (!domain) { alert('请输入域名'); return; }

    document.getElementById('loading').style.display = 'block';
    document.getElementById('resultContainer').style.display = 'none';
    document.getElementById('errorContainer').style.display = 'none';
    document.getElementById('copyBtn').style.display = 'none';

    try {
      const resp = await fetch(\`/\${currentDohPath}?name=\${encodeURIComponent(domain)}&type=all\`);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const json = await resp.json();
      if (json.error) displayError(json.error);
      else displayRecords(json);
    } catch(err) {
      displayError('查询失败: ' + err.message);
    } finally {
      document.getElementById('loading').style.display = 'none';
    }
  });

  document.addEventListener('DOMContentLoaded', function() {
    const lastDomain = localStorage.getItem('lastDomain');
    if (lastDomain) document.getElementById('domain').value = lastDomain;
    document.getElementById('domain').addEventListener('input', function() {
      localStorage.setItem('lastDomain', this.value);
    });
    document.getElementById('currentDomain').textContent = currentHost;

    const dohUrlDisplay = document.getElementById('dohUrlDisplay');
    if (dohUrlDisplay) {
      dohUrlDisplay.addEventListener('click', function() {
        const text = currentProtocol + '//' + currentHost + '/' + currentDohPath;
        navigator.clipboard.writeText(text).then(() => {
          this.classList.add('copied');
          setTimeout(() => this.classList.remove('copied'), 2000);
        }).catch(err => console.error(err));
      });
    }

    document.getElementById('getJsonBtn').addEventListener('click', function() {
      const domain = document.getElementById('domain').value;
      if (!domain) { alert('请输入域名'); return; }
      const jsonUrl = new URL(dohEndpoint);
      jsonUrl.searchParams.set('name', domain);
      window.open(jsonUrl.toString(), '_blank');
    });
  });
</script>
</body>
</html>`, {
    headers: { 'Content-Type': 'text/html;charset=UTF-8' }
  });
}

// ==================== DoH 代理核心（使用实时最快选择） ====================
async function DOHRequest(request, env, config) {
  const url = new URL(request.url);
  let serverId = url.searchParams.get('server');
  let upstream = null;

  if (serverId) {
    upstream = config.upstreams.find(u => u.id === serverId && u.enabled);
    if (!upstream) {
      return new Response('指定的上游不存在或已禁用', { status: 400 });
    }
  } else {
    if (config.enable_auto_select) {
      // 实时选择最快上游（使用请求的域名和类型）
      const domain = url.searchParams.get('name') || 'google.com';
      const type = url.searchParams.get('type') || 'A';
      const fastest = await selectFastestUpstream(env, config, domain, type);
      if (fastest) upstream = fastest;
    }
    // 若未启用自动选择或自动选择失败，使用默认
    if (!upstream) {
      const fallback = config.upstreams.find(u => u.id === config.default && u.enabled);
      if (fallback) upstream = fallback;
    }
    if (!upstream) {
      return new Response('没有可用的上游服务器', { status: 503 });
    }
  }

  // 直接转发到选中的上游（无需故障转移，因为实时选择已保证可用）
  try {
    return await forwardToUpstream(request, upstream);
  } catch (err) {
    // 如果选中的上游失败，尝试故障转移（简单重试其他）
    const allEnabled = config.upstreams.filter(u => u.enabled && u.id !== upstream.id);
    for (const fallback of allEnabled) {
      try {
        return await forwardToUpstream(request, fallback);
      } catch (_) {}
    }
    return new Response(JSON.stringify({ error: `所有上游均失败: ${err.message}` }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function forwardToUpstream(request, upstream) {
  const url = new URL(request.url);
  const method = request.method;
  const searchParams = url.searchParams;
  const domain = searchParams.get('name');
  const UA = request.headers.get('User-Agent') || 'DoH Client';

  if (searchParams.get('type') === 'all' && domain) {
    const result = await queryMultipleTypes(upstream.url, domain);
    return json(result);
  }

  if (method === 'GET') {
    if (searchParams.has('name')) {
      const type = searchParams.get('type') || 'A';
      const searchDoH = searchParams.has('type') ? url.search : url.search + '&type=A';
      let response = await fetch(upstream.url + searchDoH, {
        headers: { 'Accept': 'application/dns-json', 'User-Agent': UA }
      });
      if (!response.ok) {
        const resolveUrl = upstream.url.replace(/\/dns-query$/, '/resolve');
        if (resolveUrl !== upstream.url) {
          response = await fetch(resolveUrl + searchDoH, {
            headers: { 'Accept': 'application/dns-json', 'User-Agent': UA }
          });
        }
      }
      if (!response.ok) throw new Error(`Upstream error ${response.status}`);
      const respHeaders = new Headers(response.headers);
      respHeaders.set('Access-Control-Allow-Origin', '*');
      respHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      respHeaders.set('Access-Control-Allow-Headers', '*');
      respHeaders.set('Content-Type', 'application/json');
      return new Response(response.body, { status: response.status, headers: respHeaders });
    }
    if (url.search) {
      const response = await fetch(upstream.url + url.search, {
        headers: { 'Accept': 'application/dns-message', 'User-Agent': UA }
      });
      if (!response.ok) throw new Error(`Upstream error ${response.status}`);
      const respHeaders = new Headers(response.headers);
      respHeaders.set('Access-Control-Allow-Origin', '*');
      respHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      respHeaders.set('Access-Control-Allow-Headers', '*');
      return new Response(response.body, { status: response.status, headers: respHeaders });
    }
    throw new Error('Bad Request: missing name or dns parameter');
  }

  if (method === 'POST') {
    const contentType = request.headers.get('Content-Type') || '';
    if (contentType.includes('application/dns-message')) {
      const response = await fetch(upstream.url, {
        method: 'POST',
        headers: {
          'Accept': 'application/dns-message',
          'Content-Type': 'application/dns-message',
          'User-Agent': UA
        },
        body: request.body
      });
      if (!response.ok) throw new Error(`Upstream error ${response.status}`);
      const respHeaders = new Headers(response.headers);
      respHeaders.set('Access-Control-Allow-Origin', '*');
      respHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      respHeaders.set('Access-Control-Allow-Headers', '*');
      return new Response(response.body, { status: response.status, headers: respHeaders });
    } else if (contentType.includes('application/dns-json')) {
      const jsonBody = await request.json();
      const name = jsonBody.name;
      const type = jsonBody.type || 'A';
      if (!name) throw new Error('Missing "name" in JSON body');
      const targetUrl = new URL(upstream.url);
      targetUrl.searchParams.set('name', name);
      targetUrl.searchParams.set('type', type);
      const response = await fetch(targetUrl.toString(), {
        headers: { 'Accept': 'application/dns-json', 'User-Agent': UA }
      });
      if (!response.ok) throw new Error(`Upstream error ${response.status}`);
      const data = await response.json();
      return json(data);
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await request.formData();
      const name = formData.get('name');
      const type = formData.get('type') || 'A';
      if (!name) throw new Error('Missing "name" in form data');
      const targetUrl = new URL(upstream.url);
      targetUrl.searchParams.set('name', name);
      targetUrl.searchParams.set('type', type);
      const response = await fetch(targetUrl.toString(), {
        headers: { 'Accept': 'application/dns-json', 'User-Agent': UA }
      });
      if (!response.ok) throw new Error(`Upstream error ${response.status}`);
      const data = await response.json();
      return json(data);
    } else {
      throw new Error('Unsupported Content-Type for POST');
    }
  }

  throw new Error('Method Not Allowed');
}

// ==================== IP 地理位置代理 ====================
async function handleIpInfo(request, env) {
  const url = new URL(request.url);
  if (env.TOKEN) {
    const token = url.searchParams.get('token');
    if (token !== env.TOKEN) {
      return json({ status: 'error', message: 'Token不正确' }, 403);
    }
  }
  const ip = url.searchParams.get('ip') || request.headers.get('CF-Connecting-IP');
  if (!ip) return json({ error: 'IP参数未提供' }, 400);
  try {
    const resp = await fetch(`http://ip-api.com/json/${ip}?lang=zh-CN`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    data.timestamp = new Date().toISOString();
    return json(data);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

// ==================== 主入口 ====================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    // 管理员登录 API
    if (path === '/api/admin/login' && method === 'POST') {
      return await handleLogin(request, env);
    }
    if (path === '/api/admin/logout' && method === 'POST') {
      const auth = await requireAdmin(env, request);
      if (auth) return auth;
      await destroySession(env, request);
      return json({ success: true });
    }

    // 管理 API
    if (path.startsWith('/api/admin/')) {
      return await handleAdminAPI(request, env, url);
    }

    // 公共 API：上游列表
    if (path === '/api/public/upstreams') {
      return await handlePublicUpstreams(env);
    }

    // 管理员页面
    if (path === '/admin') {
      const username = await validateSession(env, request);
      if (username) {
        return new Response(renderAdminPage(), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
      } else {
        return new Response(renderLoginPage(), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
      }
    }

    // DoH 端点
    const config = await getConfig(env);
    const dohPath = config.doh_path || 'dns-query';
    if (path === `/${dohPath}`) {
      return await DOHRequest(request, env, config);
    }

    // IP 信息
    if (path === '/ip-info') {
      return await handleIpInfo(request, env);
    }

    // 兼容 ?doh= 参数
    if (url.searchParams.has('doh')) {
      const doh = url.searchParams.get('doh');
      const domain = url.searchParams.get('domain') || url.searchParams.get('name');
      const type = url.searchParams.get('type') || 'A';
      if (!domain) return json({ error: '缺少 domain 参数' }, 400);
      if (!doh.includes(url.hostname)) {
        try {
          let result;
          if (type === 'all') {
            result = await queryMultipleTypes(doh, domain);
          } else {
            result = await queryDns(doh, domain, type);
          }
          return json(result);
        } catch (err) {
          return json({ error: err.message }, 500);
        }
      }
      const newUrl = new URL(url);
      newUrl.pathname = `/${dohPath}`;
      newUrl.searchParams.delete('doh');
      newUrl.searchParams.set('name', domain);
      newUrl.searchParams.set('type', type);
      return await DOHRequest(new Request(newUrl.toString(), request), env, config);
    }

    // 重定向 / 代理
    if (env.URL302) return Response.redirect(env.URL302, 302);
    if (env.URL) {
      // 可扩展代理
    }

    // 默认返回公共首页
    return await renderPublicPage(env);
  }
};
