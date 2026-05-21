// 与 background 通信的辅助函数
function sendMessage(action, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action, ...params }, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(response);
      }
    });
  });
}

// 更新连接状态指示器
function updateConnectionStatus(connected) {
  const dot = document.getElementById('statusDot');
  dot.classList.toggle('connected', connected);
  dot.classList.toggle('disconnected', !connected);
  dot.title = connected ? '已连接' : '未连接';
}

// 检查连接状态
async function checkConnection() {
  try {
    const status = await sendMessage('checkConnection');
    updateConnectionStatus(status.connected);
    return status.connected;
  } catch (err) {
    updateConnectionStatus(false);
    return false;
  }
}

// 存储每个任务对应的 DOM 元素（Map: taskId -> element）
const taskElements = new Map();
let refreshInterval = null;

// 获取任务列表
async function fetchTasks() {
  try {
    const response = await sendMessage('getTasks');
    return response.tasks || [];
  } catch (err) {
    console.error('获取任务列表失败', err);
    return [];
  }
}

// 辅助函数：格式化速度
function formatSpeed(bytesPerSec) {
  if (bytesPerSec >= 1024 * 1024) return (bytesPerSec / (1024 * 1024)).toFixed(1) + ' MB';
  if (bytesPerSec >= 1024) return (bytesPerSec / 1024).toFixed(1) + ' KB';
  return bytesPerSec + ' B';
}

// 辅助函数：格式化字节大小（新增）
function formatBytes(bytes) {
  if (bytes == null || isNaN(bytes)) return '';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return val.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

// HTML转义（用于文本内容，避免 XSS）
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function (m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '…' : str;
}

function showTemporaryError(msg) {
  const errorEl = document.getElementById('errorMsg');
  if (!errorEl) return;
  errorEl.textContent = msg;
  errorEl.style.color = '#ef4444';
  setTimeout(() => {
    if (errorEl.textContent === msg) {
      errorEl.textContent = '';
      errorEl.style.color = '';
    }
  }, 3000);
}

// 生成任务显示名称
function getTaskDisplayName(task) {
  const taskId = task.id;
  return task.name || task.filename || task.url?.split('/').pop() || taskId;
}

// 获取任务状态类型（用于比较）
function getTaskStatusInfo(status) {
  const isActive = (status === 'active');
  const isWaiting = (status === 'waiting');
  const isPaused = (status === 'paused');
  const isComplete = (status === 'complete');
  const isError = (status === 'error');
  let statusText = '';
  let statusClass = '';
  if (isActive) { statusText = '下载中'; statusClass = 'status-active'; }
  else if (isWaiting) { statusText = '等待中'; statusClass = 'status-waiting'; }
  else if (isPaused) { statusText = '已暂停'; statusClass = 'status-paused'; }
  else if (isComplete) { statusText = '已完成'; statusClass = 'status-complete'; }
  else if (isError) { statusText = '错误'; statusClass = 'status-error'; }
  else { statusText = status; statusClass = ''; }
  return { statusText, statusClass, isPaused, isComplete, isError, isActive, isWaiting };
}

// 创建任务 DOM 结构（首次创建，之后只更新内容）
function createTaskDOM(task) {
  const taskId = task.id;
  const div = document.createElement('div');
  div.className = 'task-item';
  div.dataset.id = taskId;

  // 内部结构（一次性创建，后续通过更新函数修改具体属性）
  div.innerHTML = `
    <div class="task-info">
      <div style="display: flex;flex-direction: column;">
        <div>
          <span class="task-status-dot"></span>
          <span class="task-status"></span>
        </div>
        <div class="task-name" title=""></div>
      </div>
      <div class="task-meta">
        <div>
          <span>📶</span>
          <span class="task-progress">--</span>
        </div>
        <div>
          <span>⏬</span>
          <span class="task-speed">--</span>
        </div>
        <div>
          <span>📦</span>
          <span class="task-size-info">--/--</span>
        </div>
        <div>
          <span>🕒</span>
          <span class="task-remaining-time">--</span>
        </div>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: 0%"></div>
      </div>
    </div>
    <div class="task-actions">
      <button class="btn-icon pause-resume" data-action="pause" data-gid="${taskId}" title="暂停">⏸️</button>
      <button class="btn-icon remove" data-action="remove" data-gid="${taskId}" title="删除">🗑️</button>
    </div>
  `;

  // 缓存常用子元素以便快速更新
  div._cache = {
    nameDiv: div.querySelector('.task-name'),
    statusDotSpan: div.querySelector('.task-status-dot'),
    statusSpan: div.querySelector('.task-status'),
    progressSpan: div.querySelector('.task-progress'),
    speedSpan: div.querySelector('.task-speed'),
    sizeInfoSpan: div.querySelector('.task-size-info'),
    remainingTimeSpan: div.querySelector('.task-remaining-time'),
    progressFill: div.querySelector('.progress-fill'),
    pauseResumeBtn: div.querySelector('.pause-resume'),
    removeBtn: div.querySelector('.remove')
  };
  return div;
}

// 更新单个任务 DOM（细粒度：只修改变化的属性和文本）
function updateTaskDOM(element, task) {
  const taskId = task.id || task.gid;
  const name = getTaskDisplayName(task);
  const progress = task.progress || 0;
  const speed = task.speed || 0;
  const remainingSeconds = task.remainingSeconds || 0;
  const statusInfo = getTaskStatusInfo(task.status || 'unknown');
  const { statusText, statusClass, isPaused, isComplete, isError, isActive, isWaiting } = statusInfo;

  const cache = element._cache;
  if (!cache) return;

  // 更新任务名称（如果变化）
  const escapedName = escapeHtml(truncate(name, 40));
  if (cache.nameDiv.textContent !== escapedName) {
    cache.nameDiv.textContent = escapedName;
    cache.nameDiv.title = escapeHtml(name);
  }

  // 更新状态文本和类名
  if (cache.statusSpan.textContent !== statusText) {
    cache.statusSpan.textContent = statusText;
  }
  // 更新状态样式类（只保留正确的类）
  const status = [isActive, isWaiting, isPaused, isComplete, isError]
  const statusDotClassNames = ['status-dot-active', 'status-dot-waiting', 'status-dot-paused', 'status-dot-complete', 'status-dot-error'];
  const statusClassNames = ['status-active', 'status-waiting', 'status-paused', 'status-complete', 'status-error'];
  for (let i = 0; i < status.length; i++) {
    if (status[i]) {
      cache.statusDotSpan.classList.add(statusDotClassNames[i]);
      cache.statusSpan.classList.add(statusClassNames[i]);
    } else {
      cache.statusDotSpan.classList.remove(statusDotClassNames[i]);
      cache.statusSpan.classList.remove(statusClassNames[i]);
    }
  }

  // 更新进度百分比文本
  const progressText = progress ? `${progress.toFixed(1)}%` : '--';
  if (cache.progressSpan.textContent !== progressText) {
    cache.progressSpan.textContent = progressText;
  }

  // 更新进度条宽度
  const newWidth = progress ? `${progress}%` : '--';
  if (cache.progressFill.style.width !== newWidth) {
    cache.progressFill.style.width = newWidth;
  }

  // 更新速度显示
  const speedText = speed ? `${formatSpeed(speed)}/s` : '--';
  if (cache.speedSpan.textContent !== speedText) {
    cache.speedSpan.textContent = speedText;
  }

  // 更新剩余时间
  let text = '';
  if (remainingSeconds > 0) {
    const hours = Math.floor(remainingSeconds / 3600);
    const minutes = Math.floor((remainingSeconds % 3600) / 60);
    const seconds = Math.floor(remainingSeconds % 60);
    if (hours > 0) {
      text += `${hours}小时`;
    }
    if (minutes > 0) {
      text += `${minutes}分钟`;
    }
    if (seconds > 0) {
      text += `${seconds}秒`;
    }
  }
  const remainingTimeText = text !== '' ? text : '--';
  if (cache.remainingTimeSpan.textContent !== remainingTimeText)
    cache.remainingTimeSpan.textContent = remainingTimeText;

  const totalSize = task.totalLength;
  const downloadedSize = task.completedLength;
  let sizeText = '';
  let showSize = false;

  if (downloadedSize != null) {
    const downStr = formatBytes(downloadedSize);
    if (totalSize != null) {
      const totalStr = formatBytes(totalSize);
      sizeText = `${downStr}/${totalStr}`;
    } else {
      sizeText = downStr;
    }
    showSize = true;
  } else if (totalSize != null) {
    sizeText = `?/${formatBytes(totalSize)}`;
    showSize = true;
  }

  if (cache.sizeInfoSpan.textContent !== sizeText) {
    cache.sizeInfoSpan.textContent = sizeText;
  }
  cache.sizeInfoSpan.style.display = showSize ? '' : 'none';

  // 更新按钮状态（根据任务状态显示/隐藏暂停恢复按钮）
  const showPauseResume = !isComplete && !isError;
  const currentAction = cache.pauseResumeBtn.dataset.action;
  const newAction = isPaused ? 'resume' : 'pause';
  const newIcon = isPaused ? '▶️' : '⏸️';
  const newTitle = isPaused ? '恢复' : '暂停';

  if (showPauseResume) {
    if (cache.pauseResumeBtn.style.display === 'none') {
      cache.pauseResumeBtn.style.display = '';
    }
    if (currentAction !== newAction) {
      cache.pauseResumeBtn.dataset.action = newAction;
    }
    if (cache.pauseResumeBtn.textContent !== newIcon) {
      cache.pauseResumeBtn.textContent = newIcon;
    }
    if (cache.pauseResumeBtn.title !== newTitle) {
      cache.pauseResumeBtn.title = newTitle;
    }
  } else {
    if (cache.pauseResumeBtn.style.display !== 'none') {
      cache.pauseResumeBtn.style.display = 'none';
    }
  }
}

// 同步任务列表（差分更新 + 细粒度局部刷新）
async function syncTaskList() {
  const container = document.getElementById('taskList');
  if (!container) return;

  // 获取最新任务数据
  const newTasks = await fetchTasks();

  // 移除已不存在的任务 DOM
  const newTaskIds = new Set(newTasks.map(t => t.id));
  for (const [id, element] of taskElements.entries()) {
    if (!newTaskIds.has(id)) {
      element.remove();
      taskElements.delete(id);
    }
  }

  for (let i = 0; i < newTasks.length; i++) {
    const task = newTasks[i];
    const taskId = task.id;
    let element = taskElements.get(taskId);
    if (!element) {
      element = createTaskDOM(task);
      updateTaskDOM(element, task);
      taskElements.set(taskId, element);
      container.insertBefore(element, container.lastChild);
    } else {
      updateTaskDOM(element, task);
    }
  }

  // 处理空状态显示
  if (newTasks.length === 0) {
    if (container.children.length === 0 || !container.querySelector('.empty-tasks')) {
      container.innerHTML = '<div class="empty-tasks">暂无任务</div>';
    }
  } else {
    const emptyDiv = container.querySelector('.empty-tasks');
    if (emptyDiv) emptyDiv.remove();
  }
}

// 对外暴露的刷新函数
async function refreshTasks() {
  await syncTaskList();
}

function startTaskRefresh() {
  if (refreshInterval) clearInterval(refreshInterval);
  refreshTasks(); // 立即刷新一次
  refreshInterval = setInterval(refreshTasks, 1000);
}

function stopTaskRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

// ========== 事件委托（处理所有按钮点击）==========
function bindGlobalEvents() {
  const container = document.getElementById('taskList');
  if (!container) return;

  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-icon');
    if (!btn) return;
    e.stopPropagation();

    const action = btn.dataset.action;
    const gid = btn.dataset.gid;
    if (!gid) return;

    try {
      if (action === 'pause' || action === 'resume') {
        const messageAction = action === 'pause' ? 'pauseTask' : 'resumeTask';
        await sendMessage(messageAction, { taskId: gid });
      } else if (action === 'remove') {
        const result = await sendMessage('removeTask', { taskId: gid });
        if (!result.success) {
          throw new Error(result.error || '删除失败');
        }
      }
      // 操作成功后刷新列表（差分更新会自动处理）
      refreshTasks();
    } catch (err) {
      console.error('操作失败', err);
      showTemporaryError(err.message || '操作失败');
    }
  });
}

// ========== 手动添加下载 ==========
document.getElementById('sendDownloadBtn').addEventListener('click', async () => {
  const urlInput = document.getElementById('downloadUrl');
  const url = urlInput.value.trim();
  const errorEl = document.getElementById('errorMsg');
  errorEl.textContent = '';

  if (!url) {
    errorEl.textContent = '请输入下载链接';
    return;
  }

  try {
    await sendMessage('addDownload', { url });
    urlInput.value = '';
    await refreshTasks();
    errorEl.style.color = '#10b981';
    errorEl.textContent = '已添加到下载';
    setTimeout(() => {
      errorEl.textContent = '';
      errorEl.style.color = '';
    }, 2000);
  } catch (err) {
    errorEl.textContent = err.message || '下载失败';
  }
});

// 重新连接按钮
document.getElementById('reconnectBtn').addEventListener('click', async () => {
  const btn = document.getElementById('reconnectBtn');
  btn.disabled = true;
  btn.textContent = '连接中...';
  try {
    const connected = await sendMessage('reconnect');
    updateConnectionStatus(connected);
    if (connected) await refreshTasks();
  } catch (err) {
    updateConnectionStatus(false);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 重新连接';
  }
});

// 打开设置页
document.getElementById('openOptions').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// 刷新按钮事件
const refreshBtn = document.getElementById('refreshTasksBtn');
if (refreshBtn) {
  refreshBtn.addEventListener('click', () => {
    refreshTasks();
  });
}

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  bindGlobalEvents();
  const connected = await checkConnection();
  updateConnectionStatus(connected);
  startTaskRefresh();
});

// 如果 popup 被重新打开，刷新状态
window.addEventListener('focus', () => {
  checkConnection();
  refreshTasks();
});

// popup 关闭时停止定时刷新
window.addEventListener('beforeunload', () => {
  stopTaskRefresh();
});