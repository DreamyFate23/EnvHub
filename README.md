# EnvHub — 开发环境管理客户端

一站式管理 Windows 开发环境：自动检测、静默安装、一键更新、完整卸载、环境变量可视化编辑。

## 功能

| 功能 | 说明 |
|---|---|
| 环境库 | 收录 34 个主流环境，覆盖编程语言、运行时、容器与数据库、工具链 |
| 自动检测 | 三层探测：PATH 可执行文件 → 注册表卸载项 → 标准安装目录扫描 |
| 静默安装 | 自动下载官方安装包并按对应安装器类型静默执行，无需手动点确认 |
| 一键更新 | 对比官方最新版本，标记可更新环境并支持原地升级 |
| 完整卸载 | 调用官方卸载程序（静默）；绿色版自动删目录并清理 PATH 残留 |
| 环境变量 | 可视化编辑用户级/系统级 PATH，支持增删、上下移动排序、备份还原 |
| 其它变量 | 设置 JAVA_HOME / GOROOT / GOPATH 等常用变量 |

## 安装包

```
release\EnvHub-Setup-1.0.0-x64.exe
```

- 大小约 78 MB
- NSIS 格式，安装时自动注册到「Windows 设置 → 应用」的可卸载列表
- 安装过程中可在开始菜单与桌面创建快捷方式

## 覆盖的环境（34 个）

**编程语言**：Node.js、Python、Java JDK、Go、Rust、.NET SDK、Ruby、PHP、Perl、Flutter SDK、Scala、Deno、Bun

**运行时 / 工具链**：Gradle、Maven、CMake、Ninja、MSYS2

**容器与数据库**：Docker Desktop、MySQL Server、PostgreSQL、Redis、MongoDB

**工具链**：Git、Visual Studio Code、GitHub CLI、Visual Studio Build Tools、Postman、Unity Hub、Android Studio、Firefox、Obsidian、PowerToys、7-Zip

## 项目结构

```
envhub/
├─ src/
│  ├─ main/                     主进程
│  │  ├─ main.js                应用入口 + IPC 注册
│  │  ├─ catalog/
│  │  │  └─ environments.js     环境数据库（34 个环境的完整定义）
│  │  ├─ detector.js            检测引擎 + 版本查询
│  │  ├─ installer.js           安装/更新引擎
│  │  ├─ uninstaller.js         卸载引擎
│  │  ├─ envvars.js             环境变量读写与备份
│  │  ├─ downloader.js          带进度的下载器
│  │  ├─ http.js                HTTP 客户端（证书降级策略）
│  │  └─ utils.js               命令执行、UAC 提权、zip 解压
│  ├─ preload/preload.js        安全桥接层
│  └─ renderer/                 React 界面
├─ build/icon.ico               应用图标（7 种尺寸）
└─ release/                     打包产物
```

## 新增一个环境

在 `src/main/catalog/environments.js` 的 `ENVIRONMENTS` 数组中追加：

```js
{
  id: 'mytool',
  name: 'MyTool',
  category: 'tool',              // language | runtime | container | tool
  icon: 'MT',
  color: '#3B82F6',
  homepage: 'https://example.com',
  description: '一句话简介，显示在卡片上。',
  binaries: ['mytool'],          // 用于 PATH 探测
  versionCmd: '"$BIN" --version',
  versionRegex: '(\\d+\\.\\d+\\.\\d+)',
  registryMatch: '^MyTool',      // 注册表 DisplayName 正则（防误匹配）
  paths: ['C:\\Program Files\\MyTool\\mytool.exe'],
  sizeHint: '约 50 MB',
  installer: {
    strategy: 'msi',            // msi | exe | zip | rustup | bootstrapper
    urlTemplate: 'https://example.com/mytool-{{version}}.msi',
    args: ['/i', '{{file}}', '/qn', '/norestart']
  },
  latest: {
    type: 'api',
    url: 'https://example.com/api/latest.json',
    pick: j => j.version
  },
  uninstall: { strategy: 'registry' },
  tips: '补充说明，显示在详情页。'
}
```

保存后重启客户端即可生效，无需改动其它文件。

### `installer.strategy` 对应的静默参数

| strategy | 执行方式 | 静默参数 |
|---|---|---|
| `msi` | `msiexec /i` | `/qn /norestart` |
| `exe` | 直接运行安装包 | 各安装器自带（NSIS `/S`、Inno `/VERYSILENT`、Burn `--quiet`） |
| `zip` | 解压到 `installDirDefault` | 免安装，随后自动写入 PATH |
| `rustup` | rustup-init | `-y --default-toolchain stable` |
| `bootstrapper` | VS 官方引导程序 | `--quiet --wait` |

### `latest.type` 可选值

`json` / `api`（配 `pick` 函数）、`html` / `text`（配 `regex`）、`json2`（两段式查询，配 `transform`）、`static`（固定值）

## 开发与构建

```bash
npm install                 # 安装依赖
npm run dev                 # 开发模式（热重载）
npm run build:renderer      # 仅构建前端
npm run dist                # 构建 Windows 安装包
```

### 自测脚本

```bash
node test-detect.js         # 检测本机环境，打印识别结果
node test-latest.js         # 实测所有环境的版本查询接口
node test-install.js        # 校验安装 URL 与静默参数
node test-e2e.js deno       # 端到端：安装 Deno（加 --uninstall 测卸载）
node test-e2e.js nodejs --force --uninstall   # 强制重装并卸载
```

## 实现要点

**注册表匹配防串台**
不同环境的 DisplayName 高度相似（如 `Visual Studio Code` 与 `Visual Studio Build Tools`），
宽松的模糊匹配会导致多个环境共享同一条注册表记录、显示错误版本号。
`detector.js` 中的 `matchRegistryEntry` 采用三级策略：精确键 → 声明式正则 → 全词边界匹配。

**版本号可信性校验**
注册表 `DisplayVersion` 常出现 `3.12.8150.0` 这类四段构建号，无法用于版本对比。
`isPlausibleVersion()` 只接受两到三段的语义版本，避免产生"永远可更新"的误报。

**安装结果校验**
绿色版安装后会检查主程序是否真实存在，解压失败或结构不符时直接报错，
不会像某些实现那样"解压失败却报告成功"。

**证书降级**
企业内网代理常使用自签证书。`http.js` 先做正常校验，仅当错误明确是证书问题时
才降级为不校验重试一次，并在日志中明示。

**命令解析**
可执行文件路径含空格时（如 `C:\Program Files\Git\cmd\git.exe`），
不能用空格分割取命令。`runVersionCmd` 按引号边界解析，并处理 `$BIN` 已带引号的情况。

## 已知限制

- Perl、Scala、Android Studio、Firefox 的最新版本查询依赖网页解析，
  这些站点为动态渲染，解析可能失败。此时自动降级为"跟随官方最新版"，不影响安装功能。
- 卸载时若目标程序正在运行，部分安装器会拒绝卸载，需先手动关闭程序。
- 部分环境安装后需要重启终端才能生效（PATH 变更对新进程生效）。

## 环境变量备份

自动保存在 `%USERPROFILE%\.envhub\backups\`，每次保存 PATH 前自动备份一次。
「环境变量 → 备份当前」可手动创建，还原时会同时恢复用户级与系统级。