// ===== WebSocket JSON-RPC 客户端 =====
class Aria2RPC {
  constructor(url, secret) {
    this.url = url;
    this.secret = secret;
    this.ws = null;
    this.reqId = 0;
    this.pending = new Map();
    this.queue = [];
    this.autoReconnect = true;
    this._connect();
  }

  _connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      while (this.queue.length) {
        const msg = this.queue.shift();
        this.ws.send(msg);
      }
    };

    this.ws.onmessage = (event) => {
      let data;
      try { data = JSON.parse(event.data); } catch (e) { return; }
      if (data.id && this.pending.has(data.id)) {
        const { resolve, reject } = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.error) reject(data.error);
        else resolve(data.result);
      }
    };

    this.ws.onclose = () => {
      for (const [id, { reject }] of this.pending) {
        reject(new Error('WebSocket closed'));
        this.pending.delete(id);
      }
      if (this.autoReconnect) {
        setTimeout(() => this._connect(), 2000);
      }
    };

    this.ws.onerror = () => this.ws.close();
  }

  _buildRequest(method, params) {
    if (this.secret) {
      params = [`token:${this.secret}`, ...params];
    }
    return {
      jsonrpc: '2.0',
      id: ++this.reqId,
      method,
      params
    };
  }

  send(method, params = []) {
    const request = this._buildRequest(method, params);
    const msg = JSON.stringify(request);

    return new Promise((resolve, reject) => {
      this.pending.set(request.id, { resolve, reject });

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(msg);
      } else {
        this.queue.push(msg);
        if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
          this._connect();
        }
      }
    });
  }

  getGlobalOption() {
    return this.send('aria2.getGlobalOption');
  }

  changeGlobalOption(options) {
    return this.send('aria2.changeGlobalOption', options);
  }

  addUri(uris, options = {}) {
    return this.send('aria2.addUri', [uris, options]);
  }

  addTorrent(torrent, uris = [], options = {}) {
    return this.send('aria2.addTorrent', [torrent, uris, options]);
  }

  addMetalink(metalink, options = {}) {
    return this.send('aria2.addMetalink', [metalink, options]);
  }

  tellStatus(gid) {
    return this.send('aria2.tellStatus', [gid]);
  }

  pause(gid) {
    return this.send('aria2.pause', [gid]);
  }

  forcePause(gid) {
    return this.send('aria2.forcePause', [gid]);
  }

  unpause(gid) {
    return this.send('aria2.unpause', [gid]);
  }

  remove(gid) {
    return this.send('aria2.remove', [gid]);
  }

  removeDownloadResult(gid) {
    return this.send('aria2.removeDownloadResult', [gid]);
  }

  purgeDownloadResult(gid) {
    return this.send('aria2.purgeDownloadResult');
  }

  close() {
    this.autoReconnect = false;
    this.ws && this.ws.close();
  }
}

const DEFAULT_SETTINGS = {
  aria2Url: "ws://localhost:6800/jsonrpc",
  aria2Secret: "",
  autoSendDownloads: true,
  enableDefaultDirectory: false,
  defaultDirectory: "",
  enableFileClassification: true,
  enableProxy: true,                        // 是否启用代理
  proxyUrl: "http://127.0.0.1:10808",       // v2rayN 默认 HTTP 代理端口
  minFileSize: 20,
  fileClassification: {
    "pdf": "docment",
    "doc": "docment",
    "docx": "docment",
    "txt": "docment",
    "rtf": "docment",
    "xls": "docment",
    "xlsx": "docment",
    "csv": "docment",
    "ppt": "docment",
    "pptx": "docment",
    "jpg": "picture",
    "jpeg": "picture",
    "png": "picture",
    "gif": "picture",
    "bmp": "picture",
    "svg": "picture",
    "webp": "picture",
    "mp4": "video",
    "avi": "video",
    "mkv": "video",
    "mov": "video",
    "wmv": "video",
    "flv": "video",
    "mp3": "music",
    "wav": "music",
    "flac": "music",
    "aac": "music",
    "ogg": "music",
    "zip": "compressed",
    "rar": "compressed",
    "7z": "compressed",
    "tar": "compressed",
    "gz": "compressed",
    "tar.gz": "compressed",
    "tar.bz2": "compressed",
    "exe": "program",
    "msi": "program",
    "dmg": "program",
    "apk": "program",
    "ipa": "program"
  }
};

let settings = null;
(async () => {
  settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
})();

let rpcClient = null;

async function getRPCClient() {
  if (rpcClient && rpcClient.ws && rpcClient.ws.readyState === WebSocket.OPEN) {
    return rpcClient;
  }
  if (rpcClient) {
    rpcClient.url = settings.aria2Url;
    rpcClient.secret = settings.aria2Secret;
    rpcClient._connect();
    return rpcClient;
  }
  rpcClient = new Aria2RPC(settings.aria2Url, settings.aria2Secret);
  return rpcClient;
}

// 获取所有任务列表
async function getAllTasks(client) {
  const [active, waiting, stopped] = await Promise.all([
    client.send('aria2.tellActive').catch(() => []),
    // 从第一个，最大到1000
    client.send('aria2.tellWaiting', [0, 1000]).catch(() => []),
    client.send('aria2.tellStopped', [0, 1000]).catch(() => [])
  ]);

  const tasks = [];
  // status: active
  for (const t of active) {
    tasks.push(convertAria2Task(t));
  }
  // status: waiting
  for (const t of waiting) {
    tasks.push(convertAria2Task(t));
  }
  // status: paused、error、complete、removed
  for (const t of stopped) {
    tasks.push(convertAria2Task(t));
  }
  return tasks;
}

function convertAria2Task(aria2Task) {
  const gid = aria2Task.gid;
  let name = '';
  // 1. BT 任务：优先名称
  if (aria2Task.bittorrent && aria2Task.bittorrent.info.name) {
    name = aria2Task.bittorrent.info.name;
  }
  // 2. 普通多文件任务（非 BT，但可能有 files 数组，例如 Metalink）
  else if (aria2Task.files && aria2Task.files.length > 0) {
    // 对于普通下载，files 通常只有一个文件，取文件名
    // 如果存在多文件且非 BT，显示第一个文件名并加后缀提示
    const firstFilePath = aria2Task.files[0].path;
    name = firstFilePath.split('/').pop();
    if (aria2Task.files.length > 1) {
      name += ` 等${aria2Task.files.length}个文件`;
    }
  }

  // 如果名称为空，使用 GID
  if (!name) name = gid;

  const totalLength = parseInt(aria2Task.totalLength) || 0;
  const completedLength = parseInt(aria2Task.completedLength) || 0;
  const progress = totalLength > 0 ? (completedLength / totalLength) * 100 : 0;
  const speed = parseInt(aria2Task.downloadSpeed) || 0;

  let remainingSeconds = 0;
  if (totalLength > 0 && speed > 0) {
    const remainingBytes = totalLength - completedLength;
    if (remainingBytes > 0) {
      remainingSeconds = remainingBytes / speed;
    }
  }

  // 可选：增加一个标识，表示 BT 任务（popup 中可显示 🧲 图标）
  const isBt = !!aria2Task.bittorrent;

  return {
    id: gid,
    name: name,
    progress: progress,
    status: aria2Task.status,
    speed: speed,
    isBt: isBt,   // 新增字段，可用于前端显示特殊标记
    totalLength: totalLength,
    completedLength: completedLength,
    remainingSeconds: remainingSeconds,
    files: aria2Task.files // 新增，注意是字符串，需在前端处理
  };
}

function joinPaths(...segments) {
  // 过滤掉空字符串、null、undefined
  const normalized = segments
    .filter(seg => seg != null && seg !== '')
    .map(seg => seg.replace(/\\/g, '/'));
  if (normalized.length === 0) return '';
  let result = normalized.join('/');
  return result.replace(/\/+/g, '/');
}

function isAbsolutePath(p) {
  if (typeof p !== 'string') return false;
  if (/^[a-zA-Z]:[\\/]/.test(p)) return true;
  if (/^\\\\/.test(p)) return true;
  if (p.startsWith('/')) return true;
  return false;
}

async function getFileNameFromUrl(url) {
  const timeout = 5000;
  const sanitize = true;

  function parseContentDisposition(header) {
    if (!header) return '';
    const extMatch = header.match(
      /filename\*\s*=\s*([A-Za-z0-9_-]+)'[^']*'([^;\s]+)/i
    );
    if (extMatch) {
      try { return decodeURIComponent(extMatch[2]); }
      catch { return extMatch[2]; }
    }
    const quotedMatch = header.match(/filename\s*=\s*"((?:[^"\\]|\\.)*)"/i);
    if (quotedMatch) return quotedMatch[1].replace(/\\(.)/g, '$1');
    const bareMatch = header.match(/filename\s*=\s*([^;\s"]+)/i);
    if (bareMatch) return decodeURIComponent(bareMatch[1].replace(/['"]/g, ''));
    return '';
  }

  function parseUrlPathname(rawUrl) {
    try {
      const { pathname, searchParams } = new URL(rawUrl);
      const rcd = searchParams.get('response-content-disposition');
      if (rcd) {
        const fromQuery = parseContentDisposition(decodeURIComponent(rcd));
        if (fromQuery) return fromQuery;
      }
      const last = pathname.split('/').filter(Boolean).pop() || '';
      if (/\.[a-z0-9]{1,10}$/i.test(last)) {
        return decodeURIComponent(last);
      }
    } catch { }
    return '';
  }

  function sanitizeFilename(name) {
    if (!name) return name;
    return name
      .replace(/[\x00-\x1f\x7f]/g, '')
      .replace(/[/\\:*?"<>|]/g, '_')
      .replace(/\.{2,}/g, '.')
      .replace(/^[\s.]+|[\s.]+$/g, '')
      .slice(0, 255);
  }

  // ✅ 第一步：优先直接从 URL 解析，无需网络请求
  const quickResult = parseUrlPathname(url);
  if (quickResult) {
    return sanitize ? sanitizeFilename(quickResult) : quickResult;
  }

  // ✅ 第二步：URL 里没有，再尝试 fetch（插件需配置权限）
  async function fetchHeaders(method) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      return await fetch(url, {
        method,
        redirect: 'follow',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  let filename = '';
  try {
    let response = await fetchHeaders('HEAD');
    if (response.status === 405 || response.status === 501) {
      response = await fetchHeaders('GET');
      response.body?.cancel?.();
    }
    if (response.ok) {
      filename =
        parseContentDisposition(response.headers.get('Content-Disposition')) ||
        parseUrlPathname(response.url || url);
    }
  } catch (e) {
    console.warn('[getFileNameFromUrl] fetch failed:', e.message);
    filename = parseUrlPathname(url);
  }

  return sanitize ? sanitizeFilename(filename) : filename;
}

async function getFileDir(filename) {
  if (!filename || filename === '') return;
  let dir = '';
  if (settings.enableDefaultDirectory) {
    dir = settings.defaultDirectory
  }
  if (!isAbsolutePath(dir)) {
    try {
      const client = await getRPCClient();
      const globalOption = await client.getGlobalOption();
      dir = globalOption?.dir ? joinPaths(globalOption.dir, dir) : dir;
    } catch (e) {
      console.warn('获取aria2默认下载目录失败:', e);
    }
  }
  if (!settings.enableFileClassification) return dir;
  let subDir = ''
  const match = filename.match(/\.([^.]+)$/);
  subDir = settings.fileClassification[match[1].toLowerCase()] || '';
  dir = joinPaths(dir, subDir);
  return dir;
}

async function isProxyAlive(proxyUrl, timeout = 1500) {
  const { hostname, port } = new URL(proxyUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    await fetch(`http://${hostname}:${port}`, {
      signal: controller.signal,
      mode: 'no-cors', // 避免 CORS 报错，不需要读响应内容
    });
    return true; // 有响应（含网络错误响应）→ 端口活
  } catch (e) {
    if (e.name === 'AbortError') return false; // 超时 → 端口没开
    return true; // 其他网络错误（协议不匹配等）→ 端口活
  } finally {
    clearTimeout(timer);
  }
}

async function downloadWithUrl(url, options = {}) {
  if (settings.enableProxy) {
    // 验证代理是否有效
    const alive = await isProxyAlive(settings.proxyUrl);
    if (alive) {
      options = {
        ...options,
        'all-proxy': settings.proxyUrl
      };
    }
  }
  const client = await getRPCClient();
  const result = await client.addUri([url], options);
  return result;
}

async function getCookieStringForUrl(url) {
  try {
    const cookies = await chrome.cookies.getAll({ url });
    // 拼接成 "name1=value1; name2=value2" 格式
    return cookies.map(c => `${c.name}=${c.value}`).join('; ');
  } catch (err) {
    console.warn('获取 Cookie 失败:', err);
    return '';
  }
}

async function buildHeadersFromDownload(downloadItem) {
  const headers = [];
  if (downloadItem.referrer) {
    headers.push(`Referer: ${downloadItem.referrer}`);
  }
  const cookieString = await getCookieStringForUrl(downloadItem.url);
  if (cookieString) {
    headers.push(`Cookie: ${cookieString}`);
  }
  return headers;
}

// ========== 拦截浏览器下载（完整版） ==========
chrome.downloads.onCreated.addListener(async (downloadItem) => {
  if (!settings.autoSendDownloads) return;


  // 拦截的最小文件
  if (settings.minFileSize) {
    const THRESHOLD = settings.minFileSize * 1024 * 1024; // MB
    // 1. 优先用 downloadItem.fileSize（服务器有返回 Content-Length 时有效）
    let fileSize = downloadItem.fileSize || 0;

    // 2. fileSize 为 0 时，发 HEAD 请求补充获取
    if (fileSize === 0) {
      try {
        const res = await fetch(downloadItem.url, { method: 'HEAD', redirect: 'follow' });
        const contentLength = res.headers.get('Content-Length');
        if (contentLength) fileSize = parseInt(contentLength, 10);
      } catch {
        // HEAD 失败则 fileSize 保持 0，视为未知大小，继续走 aria2
      }
    }

    // 3. 已知大小且低于阈值 → 放行，不拦截
    if (fileSize > 0 && fileSize < THRESHOLD) return;
  }


  // 先取消浏览器原生下载
  try {
    await chrome.downloads.cancel(downloadItem.id);
  } catch (err) {
    console.warn('取消下载失败:', err);
    return;
  }

  const url = downloadItem.url;
  const filename = await getFileNameFromUrl(url);
  try {
    const options = {};
    // 获取目录和 headers（含 Cookie）
    const [dir, headers] = await Promise.all([
      getFileDir(filename),
      buildHeadersFromDownload(downloadItem)
    ]);
    if (dir) options.dir = dir;
    options.header = headers;
    downloadWithUrl(url, options);
  } catch (err) {
    console.error('转发到 Aria2 失败:', err);
  }
});

chrome.runtime.onInstalled.addListener(() => {
  // 创建菜单项
  chrome.contextMenus.create({
    id: "download-with-aria2",
    title: "使用 Aria2 下载",
    contexts: ["link"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'download-with-aria2') return;

  // 1. 提取下载 URL
  let downloadUrl = info.linkUrl;
  if (!downloadUrl) {
    console.warn('无法获取下载链接', info);
    return;
  }
  const headers = [];
  if (info.referrerUrl) {
    headers.push(`Referer: ${info.referrerUrl}`);
  }
  const cookieString = await getCookieStringForUrl(downloadUrl);
  if (cookieString) {
    headers.push(`Cookie: ${cookieString}`);
  }
  const options = {};
  const dir = await getFileDir(await getFileNameFromUrl(downloadUrl))
  if (dir) options.dir = dir;
  if (headers.length) options.header = headers;
  downloadWithUrl(downloadUrl, options);
});

// ===== 消息处理（新增 getTasks, pauseTask, resumeTask, removeTask）=====
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      switch (request.action) {
        case 'checkConnection': {
          try {
            const client = await getRPCClient();
            await client.send('aria2.getVersion', []);
            return { connected: true };
          } catch {
            return { connected: false };
          }
        }

        case 'addDownload': {
          const dir = await getFileDir(await getFileNameFromUrl(request.url));
          const options = {};
          if (dir) options.dir = dir;
          downloadWithUrl(request.url, options);
          return { success: true };
        }

        case 'addLocalTorrent': {
          // request.fileData 为 ArrayBuffer
          let result;
          const client = await getRPCClient();
          const base64 = btoa(String.fromCharCode(...new Uint8Array(request.fileData)));
          result = await client.addTorrent(base64, []);
          return { success: true, result };
        }

        case 'reconnect': {
          if (rpcClient) {
            rpcClient.close();
            rpcClient = null;
          }
          await getRPCClient();
          return true;
        }

        // ========== 新增任务控制接口 ==========
        case 'getTasks': {
          const client = await getRPCClient();
          const tasks = await getAllTasks(client);
          return { tasks };
        }

        case 'pauseTask': {
          const client = await getRPCClient();
          await client.forcePause(request.taskId);
          return { success: true };
        }

        case 'resumeTask': {
          const client = await getRPCClient();
          await client.unpause(request.taskId);
          return { success: true };
        }

        case 'removeTask': {
          const client = await getRPCClient();
          const taskId = request.taskId;
          const result = await client.tellStatus(taskId);
          const status = result.status;
          if (status === 'active' || status === 'waiting' || status === 'paused') {
            await client.remove(taskId);
            let retries = 10;
            while (retries-- > 0) {
              try {
                const check = await client.tellStatus(taskId);
                if (check.status === 'removed') {
                  await client.removeDownloadResult(taskId);
                  break;
                }
              } catch (e) {
                // tellStatus 可能因 gid 不存在而报错，视为已清理
                break;
              }
              await new Promise(r => setTimeout(r, 500));
            }
          } else {
            client.removeDownloadResult(taskId);
          }
          return { success: true };
        }

        default:
          throw new Error('未知操作');
      }
    } catch (err) {
      return Promise.reject(err.message || '操作失败');
    }
  })().then(sendResponse).catch(err => sendResponse({ error: err.message || err }));
  return true;
});

async function notifiyIcon() {
  const client = await getRPCClient();
  const [active] = await Promise.all([
    client.send('aria2.tellActive').catch(() => []),
  ]);
  // 设置图标通知
  if (active.length !== 0) {
    chrome.action.setBadgeText({ text: `${active.length}` });
    chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
    chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
  } else {
    chrome.action.setBadgeText({ text: '' })
  }
}

setInterval(notifiyIcon, 1000);