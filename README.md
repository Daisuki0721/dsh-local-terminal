# dsh-local-terminal

为 DeepSeek Harness Web UI 提供 VS Code 风格的本机 zsh 终端。

A VS Code-style local zsh terminal plugin for the DeepSeek Harness web UI.

## 功能

- 终端嵌入对话区底部，不遮挡聊天内容和输入框。
- 点击 `Terminal` 展开或收起面板，关闭按钮也可收起。
- 面板顶边可拖动调整高度，双击恢复默认高度。
- 终端与终端列表之间的竖直分割线可拖动调整宽度，双击恢复默认宽度。
- 支持多个相互独立的 zsh 会话。
- 终端列表支持切换、关闭，以及右键重命名或关闭。
- 终端列表标签页支持上下拖动排序。
- 面板收起后保留 PTY、输出、滚动位置和进程状态。
- 面板高度变化时通知对话视图重新布局，避免虚拟列表裁切滞后。
- 使用 xterm.js、Unicode 11 宽度规则和 Nerd Font 回退字体。

## 环境要求

- macOS。
- DeepSeek Harness，且已配置 `web` profile。
- Node.js `22.19` 或更高版本。
- 系统存在 `/bin/zsh`。

插件会启动真实的本机 shell。终端中运行的命令拥有启动 `dsh web` 的用户权限，请只在可信设备和可信 DSH 插件环境中使用。

## 安装

从 GitHub 安装到 DSH 的 `web` profile：

```bash
dsh plugin --profile web add github:Daisuki0721/dsh-local-terminal
```

安装后启动或重启 Web UI：

```bash
dsh web
```

浏览器打开 DSH 页面后，`Terminal` 按钮会显示在 Agent preset 右侧。

### 从本地源码安装

```bash
git clone https://github.com/Daisuki0721/dsh-local-terminal.git
cd dsh-local-terminal
pnpm install
pnpm build
dsh plugin --profile web add "$PWD"
```

## 使用

1. 点击对话区顶部的 `Terminal` 打开底部面板。
2. 点击工具栏的 `+` 创建新的 zsh 会话。
3. 点击右侧终端名称切换会话。
4. 右键终端名称进行重命名或关闭。
5. 拖动面板上边界调整高度；双击上边界恢复默认高度。
6. 拖动终端列表左侧的竖直分割线调整列表宽度；双击恢复默认宽度。
7. 再次点击 `Terminal` 或点击面板右上角的关闭按钮收起面板。

`Clear` 只清除当前终端的可见缓冲区；`Restart` 只重启当前 zsh 会话。

## 安全设计

后端 WebSocket PTY 路由采用以下限制：

- 只接受 `127.0.0.1`、`localhost` 和 IPv6 loopback 请求。
- 校验浏览器请求的 Host、Origin 和同源关系。
- 拒绝浏览器标记为 cross-site 的请求。
- 对 WebSocket 输出设置背压上限。
- 每个 WebSocket 连接对应一个独立 PTY，连接销毁时终止其 shell。

不要把 DSH Web 服务代理到不受信任的公网地址。loopback 校验是本插件安全边界的一部分。

## 更新

```bash
dsh plugin --profile web remove @dsh-external/dsh-local-terminal
dsh plugin --profile web add github:Daisuki0721/dsh-local-terminal
```

## 卸载

```bash
dsh plugin --profile web remove @dsh-external/dsh-local-terminal
```

## 开发

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

项目结构：

```text
src/index.ts             Host 插件入口
src/routes.ts            loopback WebSocket upgrade 路由
src/pty-session.ts       node-pty 会话管理
src/client/              Web UI、终端列表和布局逻辑
cordis.patch.yml         DSH loader 插件声明
```

构建产物位于 `lib/`。插件仅依赖公开发布的 `@deepseek-ai/*` SDK，不需要 DeepSeek Harness 源码 checkout。

## 常见问题

### 安装后没有出现 Terminal 按钮

确认插件存在于 `web` profile，然后完整重启 `dsh web`。单纯刷新浏览器不能加载新的 Host 插件。

## License

[BSD 3-Clause](LICENSE)
