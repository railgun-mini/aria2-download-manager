# Aria2 Download Manager

这是一个基于 Chrome 内核的扩展，用于将浏览器下载和链接发送到 aria2 进行下载。

## 功能
- 拦截浏览器下载并发送到 aria2
- 支持手动右键菜单 "Send link to aria2"
- 支持当前页面 URL 发送
- 支持 aria2 RPC 配置和自动下载拦截

## 安装
1. 在 Chrome/Edge 中打开 `chrome://extensions/`。
2. 启用“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择此文件夹。

## 使用
1. 打开扩展设置页面，填写 aria2 RPC 地址、端口和 Secret Token。
2. 扩展默认开启自动拦截下载功能，浏览器下载将自动发送到 aria2。
3. 也可以右键页面或链接选择“Send link to aria2”。
4. 点击扩展图标，可以快速发送当前页面 URL 或打开设置页面。

## 控制下载任务

- 点击扩展图标打开弹出面板，面板会列出 aria2 中的活动/等待/已停止任务。
- 每个任务右侧有“暂停/恢复”和“删除”按钮，支持手动控制任务状态。
- 使用“刷新任务”按钮刷新任务列表，使用“清除已完成”可以批量移除已完成的任务。

## aria2 RPC 示例启动

```bash
aria2c --enable-rpc --rpc-listen-all=false --rpc-allow-origin-all --rpc-listen-port=6800
```

## 注意
- 需要 aria2 启用 RPC。
- 如果使用 Secret Token，请在设置页面填写 `token:` 之前的值。
