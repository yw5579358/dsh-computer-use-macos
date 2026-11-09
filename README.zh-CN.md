# DeepSeek Harness macOS Computer Use

[English](README.md) · [浏览器配置](docs/browser.md) · [测试报告](docs/testing.md)

让 DeepSeek Harness 直接操作 Mac 应用和网页。新建一个 PTC 会话，说明要打开哪个应用、填写什么内容、点击哪个按钮，模型就可以读取界面、执行操作，再检查结果。

这个项目参考了 [Codex Computer Use](https://learn.chatgpt.com/docs/computer-use) 的使用方式：先选择应用或标签页，读取界面和截图，完成操作后重新观察。应用和窗口以对象的形式保留在 PTC 中，连续操作时可以沿用这些对象。

底层使用 [DeepSeek Harness 的原生 CUA](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/experimental/cua-macos) （`@deepseek-ai/dsh-cua` 与 `@deepseek-ai/dsh-experimental-cua-macos`）处理 macOS 窗口、辅助功能和输入；网页部分通过 [Playwright](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp) 连接专用 Chrome，按网页元素的角色、标签和文本定位。

在这两层能力之上，插件补上了统一的应用/窗口接口、PTC 模块加载、操作后的状态检查、浏览器连接管理和截图回传。授权、调用日志和图片附件都沿用 Harness 的处理流程。

## 使用效果

**电脑应用**：选择应用和窗口，读取辅助功能树、获取窗口截图，完成点击、中文输入、快捷键、滚动、文本选择和粘贴。

**网页**：读取页面内容，填写输入框、点击按钮、提取表格，通过 DOM 定位元素，也可以获取当前页面截图。

任务结束后，浏览器连接会释放，后续会话可以重新接入。需要留给用户检查的页面，可以在任务中标记保留。

`0.1.1` 已在真实 Harness 桌面版中跑通中文填表、按钮点击、结果读回、截图和跨会话连接。本机与 GitHub CI 的 **44 项自动测试**全部通过，另有 **12 项原生桌面检查**通过。具体环境和记录见[测试报告](docs/testing.md)。

## 安装

运行环境：

- macOS 14+
- DeepSeek Harness `0.2.2-rc.1`
- Node.js 24.9+；截图需要使用支持图片输入的模型
- 为 `DSH Computer Use.app` 开启辅助功能和屏幕录制权限

### 桌面版

1. 打开「插件」，启用实验性功能「自定义插件索引」。
2. 进入「发现」，添加下面的 JSON 地址。
3. 选择「macOS 电脑操作」，核对版本和来源，点击「安装 → 立即启用」。
4. 在「设置 → Agent 预设」中选择 **PTC 模式**，然后新建会话。

```text
https://raw.githubusercontent.com/yw5579358/dsh-computer-use-macos/codex/initial-release/plugin-index.json
```

也可以通过「添加插件」安装 [Release](https://github.com/yw5579358/dsh-computer-use-macos/releases) 中的压缩包。索引中的每个版本都固定到具体 Git 提交，仓库包含构建好的 `lib/`。

升级第三方插件时，先备份 profile 配置，再在桌面版中卸载旧版、安装新版。已有会话会保留原来的模式。

### CLI profile

独立 CLI profile 使用：

```sh
dsh plugin --profile computer-demo add ./dsh-computer-use-macos-0.1.1.tgz
dsh --profile computer-demo --dump-config
```

桌面版的 `desktop` profile 由应用管理，安装和卸载都在插件页面完成。同一个 profile 使用一个原生 Computer Use provider。

## 直接用自然语言操作

电脑控制：

```text
使用 Computer Use 打开计算器，计算 123 × 456，读取界面上的结果。
```

```text
使用电脑控制打开文本编辑，新建文稿，输入标题“本周计划”和三条待办事项。保留窗口供我检查。
```

浏览器 DOM：

```text
使用浏览器 DOM 打开 http://localhost:3000，检查导航链接和主要按钮，截图记录结果。完成后保留标签页供我查看。
```

```text
使用浏览器 DOM 打开指定后台，等我登录后读取当前页的表格，统计各状态的记录数量。
```

把网址、应用名和任务内容换成自己的目标即可。需要保留网页时，在指令里加上「完成后保留标签页」。

## 启用浏览器 DOM

先启动专用 Chrome：

```sh
"$HOME/.dsh/profiles/desktop/node_modules/dsh-computer-use-macos/scripts/start-browser.command"
```

启动器使用 `$HOME/.dsh/browser-dom/profile` 保存浏览器数据，调试连接位于 `127.0.0.1:9222`。需要登录的网站，在这个窗口中登录；关闭浏览器后，再次运行启动器即可。

在 profile 的 `cordis.patch.yml` 中配置：

```yaml
- id: macos-computer-use-compat
  name: dsh-computer-use-macos
  config:
    configuredCDPEndpoint: http://127.0.0.1:9222
    browserTimeoutMs: 15000
    browserMaxElements: 400
```

保存后新建 PTC 会话。配置项、页面保留和连接排查见[浏览器文档](docs/browser.md)。

## 在 PTC 中调用

原生应用：

```js
const entry = await tools.computer_use_bootstrap({})
const { connectComputerUse } = await import(entry.nativeBridgeUrl)
const cua = connectComputerUse(() => tools.cua, {
  text: value => console.log(value),
})
const app = await cua.getApp('Calculator')
await app.getAXState()
// elementIndex 使用本次界面观察中的控件编号。
await app.click(elementIndex)
await app.getAXState()
```

浏览器：

```js
const { connectBrowser } = await import(entry.browserBridgeUrl)
const browser = connectBrowser(() => tools.computer_browser)
const tab = await browser.createBrowserTab('chromium', 'http://localhost:3000')
await tab.playwright.getByRole('button', { name: '继续', exact: true }).click()
await tab.getAXState()
await tab.markHandoff()
```

每次调用通过 getter 获取当前的工具绑定。输入后重新读取状态；浏览器任务进入空闲后，下次操作先重新选择标签页。截图由 Harness 作为附件送入模型上下文。

## 开发与文档

```sh
npm ci --ignore-scripts
npm run check
npm pack
```

浏览器测试使用临时 Chrome Profile 和本地合成页面；原生测试使用自建 AppKit 窗口。

- [API 与能力说明](docs/capabilities.md)
- [浏览器配置](docs/browser.md)
- [测试报告](docs/testing.md)
- [参考资料与设计](docs/research.md)
- [参与开发](CONTRIBUTING.md)
- [安全说明](docs/security.md)
- [第三方许可](THIRD_PARTY_NOTICES.md)

## 卸载

桌面版进入插件详情，点击「卸载」。独立 CLI profile 使用：

```sh
dsh plugin --profile computer-demo remove dsh-computer-use-macos
```

macOS 权限和 Harness 中保存的应用授权，可分别在系统设置及 Computer Use 权限页面管理。

## License

[MIT](LICENSE)
