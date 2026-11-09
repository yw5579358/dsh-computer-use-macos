# DeepSeek Harness macOS Computer Use 插件

[English](README.md) · [能力对照](docs/capabilities.md) · [安全说明](docs/security.md)

独立社区插件：复用 Harness 官方、MIT 开源的 macOS 原生 CUA，增加原创的 Codex 风格应用/窗口 API 和可选浏览器适配层。没有复制 OpenAI 的实现，也不代表 OpenAI 或 DeepSeek 官方。

支持应用与窗口选择、AX 界面树、窗口截图、点击、悬停、拖动、滚动、Unicode 输入、快捷键、值替换、文本选区、辅助动作及上游剪贴板保护流程。每次输入后要求重新观察，失败输入也不能自动重试。

**不宣称完整复刻 Codex 私有运行时。** 锁屏控制、OpenAI 浏览器扩展及其已有登录 Profile 集成、Appshots、浏览历史授权和 WebMCP 不在本版本能力内。

## 环境与安装

需要 macOS 14+、Node 24.9+、Harness `0.2.2-rc.1`、支持图片输入的模型，以及用户为官方 `DSH Computer Use.app` 授予辅助功能和屏幕录制权限。系统授权与 Harness 逐应用授权是两层独立权限；插件不能自行授予。

**桌面版：**在「插件」中启用实验性「自定义插件索引」，进入「发现」，添加[下方 JSON 索引](#插件发现)。选中本插件，核对仓库和固定提交后「安装 → 立即启用」。在「设置 → Agent 预设」中将新任务默认设为 **PTC 模式**；已有会话保留原模式。

也可在桌面版「添加插件」对话框中选择发布的 tarball 或固定 Git 来源。**不要对桌面版使用 `dsh plugin --profile desktop`：该配置由 Electron 应用独占管理，CLI 会拒绝。**

独立的非桌面 CLI profile 可使用：

```sh
dsh plugin --profile computer-demo add ./dsh-computer-use-macos-0.1.1.tgz
dsh --profile computer-demo --dump-config
```

仓库包含已构建的 `lib/`，不执行安装/prepare 脚本。一个 profile 只能启用一个原生 Computer Use provider。

在 PTC 会话中使用：

```js
const entry = await tools.computer_use_bootstrap({})
const { connectComputerUse } = await import(entry.nativeBridgeUrl)
const cua = connectComputerUse(() => tools.cua, { text: value => console.log(value) })
const app = await cua.getApp('Calculator')
// 使用刚返回的界面编号；操作后重新读取。
await app.click(elementIndex)
await app.getAXState()
```

原生截图已经通过 Host 附件流程进入模型上下文，返回对象保留字节和尺寸，不能重复上传。滚动使用 `scroll({x,y,deltaLinesX,deltaLinesY})`，不是 Codex 的页数签名。保留变量需使用持久 PTC 模式。快捷键和粘贴应先确认目标应用焦点。原始中文 HTML 在部分 AppKit 控件中存在编码限制，优先使用纯文本；详见 [实测范围](docs/testing.md)。

## 插件发现

在实验功能 **Custom plugin indexes** 中添加可信索引：

```text
https://raw.githubusercontent.com/yw5579358/dsh-computer-use-macos/codex/initial-release/plugin-index.json
```

索引将安装来源固定到测试过的 commit；这是自建社区索引，不是官方精选收录。

## 浏览器

DOM 功能已经实现；需要先指定浏览器连接，才注册工具。运行包内的 `scripts/start-browser.command`，在配置中显式填写 `http://127.0.0.1:9222`，再新建 PTC 会话。启动器使用独立、持久的 Chrome Profile，不安装开机常驻服务；关闭后可再次运行。端口若属于其他进程则拒绝复用。

仅连接用户显式配置的 loopback CDP 浏览器。正式模型调用经过 Host 的 `computer_browser` 工具及 Harness 普通审批/日志流程。CDP 能访问该浏览器的所有标签，loopback 限制不等于站点级授权。详见 [浏览器配置](docs/browser.md)。

不会自动接管日常 Chrome；清理只处理插件自己创建且没有标记保留的标签，不关闭外部浏览器进程。公开的 `./browser` 是开发者底层库，不替代 Host 审批。

## 测试与发布

```sh
npm ci --ignore-scripts
npm run check
npm run test:browser
npm pack
```

浏览器测试使用独立 Chrome/Chromium 临时 Profile 与本地夹具。原生桌面测试需要用户系统授权，验证记录见 [测试报告](docs/testing.md)。已有 `0.2.1-rc.5` 不属于支持范围，应先升级，或使用独立 profile 测试。

桌面版卸载：进入插件详情，点击「卸载」。非桌面 CLI profile 使用 `dsh plugin --profile computer-demo remove dsh-computer-use-macos`。卸载不自动撤销 macOS 权限与 Harness 保存的应用授权，请分别在对应权限页面撤销。
