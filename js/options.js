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

let cachedOS = null;
chrome.runtime.getPlatformInfo(info => { cachedOS = info.os; });

function populateForm(settings) {
  document.getElementById('aria2Url').value = settings.aria2Url || '';
  document.getElementById('aria2Secret').value = settings.aria2Secret || '';
  document.getElementById('enableDefaultDirectory').checked = !!settings.enableDefaultDirectory;
  document.getElementById('defaultDirectory').value = settings.defaultDirectory || '';
  document.getElementById('autoSendDownloads').checked = !!settings.autoSendDownloads;
  document.getElementById('enableFileClassification').checked = !!settings.enableFileClassification;

  renderMappings(settings.fileClassification || {});
}

// ===== 文件映射管理 =====
let mappings = []; // 当前显示的映射数组 [{ folder, ext }]

function renderMappings(fileClassification) {
  const transferred = {};
  for (const [ext, folder] of Object.entries(fileClassification)) {
    if (!transferred[folder]) transferred[folder] = [];
    transferred[folder].push(ext);
  }
  mappings = Object.entries(transferred).map(([folder, exts]) => ({
    folder,
    exts: exts.join(',')   // 一次性拼接
  }));
  renderMappingsFromArray();
}

// 从当前 mappings 数组重新渲染（保留顺序）
function renderMappingsFromArray() {
  const list = document.getElementById('mappingList');
  list.innerHTML = '';
  mappings.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'mapping-row';

    const folderInput = document.createElement('input');
    folderInput.type = 'text';
    folderInput.placeholder = '文件夹名';
    folderInput.value = item.folder;
    folderInput.addEventListener('input', (e) => { mappings[index].folder = e.target.value.trim(); });

    const extInput = document.createElement('input');
    extInput.type = 'text';
    extInput.placeholder = '扩展名（多个以逗号分隔）';
    extInput.value = item.exts;
    extInput.addEventListener('input', (e) => { mappings[index].exts = e.target.value.trim(); });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-icon';
    deleteBtn.innerHTML = '🗑️';
    deleteBtn.addEventListener('click', () => {
      mappings.splice(index, 1);
      renderMappingsFromArray();
    });

    row.appendChild(folderInput);
    row.appendChild(extInput);
    row.appendChild(deleteBtn);
    list.appendChild(row);
  });
}

document.getElementById('addMappingBtn').addEventListener('click', () => {
  mappings.push({ folder: '', exts: '' });
  renderMappingsFromArray();
});

// ===== 保存设置 =====
function showStatus(message, type = 'success') {
  const statusEl = document.getElementById('statusMessage');
  statusEl.textContent = message;
  statusEl.className = `status-message status-${type}`;
  setTimeout(() => {
    statusEl.className = 'status-message';
  }, 3000);
}

function isAbsolutePathWin(p) {
  if (typeof p !== 'string') return false;
  // Windows 绝对路径：如 C:\ 或 C:/ 或 \\server\share
  if (/^[a-zA-Z]:[\\/]/.test(p)) return true;
  // Windows UNC 路径
  if (/^\\\\/.test(p)) return true;
  return false;
}

function isAbsolutePathPosix(p) {
  if (typeof p !== 'string') return false;
  // POSIX 绝对路径：以 / 开头
  if (p.startsWith('/')) return true;
  return false;
}

function validateSettings(settings) {
  if (!settings.aria2Url) {
    showStatus('WebSocket 地址不能为空', 'error');
    return false;
  }

  if (!URL.canParse(settings.aria2Url)) {
    showStatus('WebSocket 地址格式不正确', 'error');
    return false;
  }

  if (settings.enableDefaultDirectory && !settings.defaultDirectory) {
    showStatus('默认下载目录不能为空', 'error');
    return false;
  }

  if (settings.defaultDirectory) {
    // 在这里处理结果
    if (cachedOS === "win") {
      // Windows 系统的相关逻辑
      if (!isAbsolutePathWin(settings.defaultDirectory)) {
        showStatus('绝对路径格式不正确', 'error');
        return false;
      }
    } else {
      console.log(settings.defaultDirectory)
      if (!isAbsolutePathPosix(settings.defaultDirectory)) {
        showStatus('绝对路径格式不正确', 'error');
        return false;
      }
    }
  }

  if (settings.enableFileClassification) {
    for (const item of mappings) {
      if (item.exts.length > 0 && item.folder.trim() === '') {
        showStatus('文件夹名不能为空', 'error');
        return false;
      }
    }
  }
  return true;
}

document.getElementById('saveBtn').addEventListener('click', async () => {
  const settings = {
    aria2Url: document.getElementById('aria2Url').value.trim(),
    aria2Secret: document.getElementById('aria2Secret').value.trim(),
    autoSendDownloads: document.getElementById('autoSendDownloads').checked,
    enableDefaultDirectory: document.getElementById('enableDefaultDirectory').checked,
    defaultDirectory: document.getElementById('defaultDirectory').value.trim(),
    enableFileClassification: document.getElementById('enableFileClassification').checked,
    fileClassification: {}
  };

  // 从映射数组构建对象，忽略空的 ext 或 folder
  mappings.forEach(item => {
    if (item.exts.length > 0 && item.folder) {
      item.exts.split(',').map(ext => ext.trim()).forEach(ext => {
        if (!!ext && ext != '')
          settings.fileClassification[ext] = item.folder;
      });
    }
  });

  if (!validateSettings(settings)) {
    return;
  }

  try {
    await new Promise((resolve, reject) => {
      chrome.storage.sync.set(settings, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
    showStatus('设置已保存 ✅');
  } catch (err) {
    showStatus('保存失败: ' + err.message, 'error');
  }
});

document.getElementById('resetBtn').addEventListener('click', async () => {
  if (!confirm('确定要重置为默认设置吗？这将覆盖当前所有设置。')) {
    return;
  }
  const settings = DEFAULT_SETTINGS;
  try {
    await new Promise((resolve, reject) => {
      chrome.storage.sync.set(settings, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  } catch (err) {
    showStatus('保存失败: ' + err.message, 'error');
    return;
  }
  populateForm(settings);
  showStatus('设置已重置为默认值 ✅');
});

// ===== 初始化 =====
(async function init() {
  try {
    const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    populateForm(settings);
  } catch (err) {
    showStatus('无法加载设置', 'error');
  }
})();
