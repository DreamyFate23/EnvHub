/**
 * EnvHub 环境数据库
 * ------------------------------------------------------------------
 * 每个环境条目描述:
 *   id           唯一标识
 *   name         显示名
 *   category     分类: language | runtime | database | tool | container
 *   icon         展示用 emoji/标识
 *   color        主题色
 *   homepage     官网
 *   binaries     用于 PATH 探测的主可执行文件名
 *   versionCmd   探测版本的命令模板 {bin} 会被替换为实际路径
 *   versionRegex 从命令输出里提取版本的正则
 *   registries   注册表探测键 (64/32 位 Uninstall 节点)
 *   paths        标准安装目录 (相对系统盘或盘符)，用于兜底探测
 *   installer    安装策略, 见 installer-strategies.js
 *   latest       远端最新版本查询配置
 *   uninstall    卸载策略
 *   sizeHint     典型安装体积描述
 */

const R = n => `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${n}`

// 用于 json2 类型的两段式查询
const { httpGet } = require('../http')

const CATEGORIES = [
  { id: 'language', name: '编程语言', icon: '⌨️' },
  { id: 'runtime', name: '运行时', icon: '⚙️' },
  { id: 'container', name: '容器与数据库', icon: '🐳' },
  { id: 'tool', name: '工具链', icon: '🧰' }
]

const ENVIRONMENTS = [
  // ============================ 编程语言 ============================
  {
    id: 'nodejs',
    name: 'Node.js',
    category: 'language',
    icon: 'JS',
    color: '#5FA04E',
    homepage: 'https://nodejs.org',
    description: '基于 V8 的 JavaScript 运行时，npm / npx / yarn / pnpm 生态基础。',
    binaries: ['node'],
    versionCmd: '"$BIN" --version',
    versionRegex: 'v?(\\d+\\.\\d+\\.\\d+)',
    registries: [`${R('Node.js')}`],
    registryMatch: '^Node\\.js',
    paths: ['C:\\Program Files\\nodejs\\node.exe'],
    sizeHint: '约 30 MB',
    installer: {
      strategy: 'msi',
      urlTemplate: 'https://nodejs.org/dist/v{{version}}/node-v{{version}}-x64.msi',
      args: ['/i', '{{file}}', '/qn', '/norestart', 'ADDLOCAL=ALL']
    },
    latest: { type: 'json', url: 'https://nodejs.org/dist/index.json', pick: m => m.find(x => x.lts)?.version },
    uninstall: { strategy: 'registry', key: `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Node.js` },
    tips: 'LTS 版本更稳定，适合生产环境；最新版特性更新更快。'
  },
  {
    id: 'python',
    name: 'Python',
    category: 'language',
    icon: 'Py',
    color: '#3776AB',
    homepage: 'https://www.python.org',
    description: '通用编程语言，数据科学与后端开发主力，附带 pip 包管理器。',
    binaries: ['python'],
    versionCmd: '"$BIN" --version',
    versionRegex: '(\\d+\\.\\d+\\.\\d+)',
    registries: [
      `HKLM\\SOFTWARE\\Python\\PythonCore`,
      `HKLM\\SOFTWARE\\WOW6432Node\\Python\\PythonCore`
    ],
    // Python 会注册十余个子条目 (Core Interpreter / Standard Library / pip ...)，
// 优先匹配主条目；正则要求以 "Python x.y" 开头，避免命中 "Python Launcher"
    registryMatch: '^Python \\d+\\.\\d+.*\\(\\d+-bit\\)$',
    paths: [
      'C:\\Python*\\python.exe',
      `${process.env.LOCALAPPDATA || '%LOCALAPPDATA%'}\\Programs\\Python\\Python*\\python.exe`
    ],
    sizeHint: '约 25 MB',
    installer: {
      strategy: 'exe',
      urlTemplate: 'https://www.python.org/ftp/python/{{version}}/python-{{version}}-amd64.exe',
      args: ['/quiet', 'InstallAllUsers=1', 'PrependPath=1', 'Include_test=0', 'AssociateFiles=1'],
      exeName: 'python-{{version}}-amd64.exe'
    },
    latest: {
      // python.org/downloads 为动态渲染页面，正则不可靠。
      // 改用 FTP 目录索引，它由服务端直接生成且结构稳定。
      type: 'html',
      url: 'https://www.python.org/ftp/python/',
      // 排除预发布版本 (3.14.0a1 / 3.15.0rc2)
      regex: /href="(3\.\d+\.\d+)(?![ab]\d|\d?rc)[^"]*"/g,
      transformAll: (text) => {
        const all = [...text.matchAll(/href="(3\.\d+\.\d+)(?![ab]\d|\d?rc)[^"]*"/g)]
          .map(m => m[1])
        if (!all.length) return null
        // FTP 列表按版本分组，取主版本号最大的分支中最高的修订号
        const byMajor = {}
        for (const v of all) {
          const [maj, min, pat] = v.split('.').map(Number)
          const key = `${maj}.${min}`
          if (!byMajor[key] || pat > byMajor[key]) byMajor[key] = pat
        }
        const best = Object.entries(byMajor).sort((a, b) => {
          const [amaj, amin] = a[0].split('.').map(Number)
          const [bmaj, bmin] = b[0].split('.').map(Number)
          return bmaj - amaj || bmin - amin
        })[0]
        return best ? `${best[0]}.${best[1]}` : null
      },
      optional: true
    },
    uninstall: { strategy: 'registry', key: null },
    tips: '安装时已勾选 Add Python to PATH，无需手动配置环境变量。'
  },
  {
    id: 'java',
    name: 'Java JDK',
    category: 'language',
    icon: 'Jv',
    color: '#F89820',
    homepage: 'https://adoptium.net',
    description: 'Java 开发工具包，Eclipse Temurin 是官方推荐的 OpenJDK 发行版。',
    binaries: ['java', 'javac'],
    versionCmd: '"$BIN" -version',
    versionRegex: '"(\\d+\\.\\d+\\.\\d+)[^"]*"',
    versionFlag: '-version',
    registries: [
      `${R('Eclipse Adoptium JDK')}`,
      `${R('Java(TM) SE Development Kit')}`,
      `${R('Microsoft JDK')}`,
      `${R('OpenJDK')}`
    ],
    registryMatch: '^(Eclipse Adoptium|Java\\(TM\\)|Java |Microsoft |Zulu|OpenJDK|Temurin).*(JDK|Java Development Kit)',
    paths: [
      'C:\\Program Files\\Eclipse Adoptium\\jdk-*\\bin\\java.exe',
      'C:\\Program Files\\Java\\jdk-*\\bin\\java.exe'
    ],
    sizeHint: '约 190 MB',
    installer: {
      strategy: 'msi',
      urlTemplate: 'https://api.adoptium.net/v3/binary/latest/{{version}}/ga/windows/x64/jdk/hotspot/normal/eclipse',
      args: ['/i', '{{file}}', '/qn', '/norestart', 'ADDLOCAL=FeatureMain,FeatureEnvironment,FeatureJarFileRunWith,FeatureJavaHome']
    },
    latest: {
      type: 'api',
      url: 'https://api.adoptium.net/v3/assets/feature_releases/21/ga?architecture=x64&image_type=jdk&os=windows&page=0&page_size=1&project=jdk&sort_order=DESC',
      // release_name 形如 "jdk-21.0.12.1+1"，需剥离前缀
      pick: j => j?.[0]?.release_name?.replace(/^jdk-/, '').split('+')[0]
    },
    uninstall: { strategy: 'registry', key: null },
    tips: '推荐安装 JDK 而非 JRE，否则无法编译 Java 程序。'
  },
  {
    id: 'go',
    name: 'Go',
    category: 'language',
    icon: 'Go',
    color: '#00ADD8',
    homepage: 'https://go.dev/dl/',
    description: 'Google 出品的静态编译语言，云原生与后端服务开发利器。',
    binaries: ['go'],
    versionCmd: '"$BIN" version',
    versionRegex: 'go(\\d+\\.\\d+(\\.\\d+)?)',
    registries: [
      `${R('Go Programming Language')}`,
      `${R('Go Programming Language amd64')}`
    ],
    paths: [
      'C:\\Program Files\\Go\\bin\\go.exe',
      'C:\\Go\\bin\\go.exe'
    ],
    sizeHint: '约 140 MB',
    installer: {
      strategy: 'msi',
      urlTemplate: 'https://go.dev/dl/go{{version}}.windows-amd64.msi',
      args: ['/i', '{{file}}', '/qn', '/norestart']
    },
    latest: { type: 'html', url: 'https://go.dev/dl/?mode=json', regex: /go(\d+\.\d+(\.\d+)?)\.windows-amd64\.msi/ },
    uninstall: { strategy: 'registry', key: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Go Programming Language amd64' },
    tips: 'Go 官方 MSI 安装包会自动配置 GOPATH 与 PATH。'
  },
  {
    id: 'rust',
    name: 'Rust',
    category: 'language',
    icon: 'Rs',
    color: '#DEA584',
    homepage: 'https://www.rust-lang.org/tools/install',
    description: '注重性能与安全性的系统级语言，cargo 包管理器，WebAssembly 首选。',
    binaries: ['rustc', 'cargo'],
    versionCmd: '"$BIN" --version',
    versionRegex: '(\\d+\\.\\d+\\.\\d+)',
    registries: [],
    paths: ['%USERPROFILE%\\.cargo\\bin\\rustc.exe'],
    sizeHint: '约 350 MB',
    installer: {
      strategy: 'rustup',
      urlTemplate: 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe',
      args: ['-y', '--default-toolchain', 'stable', '--profile', 'default', '--no-modify-path'],
      exeName: 'rustup-init.exe'
    },
    latest: {
      type: 'text',
      url: 'https://static.rust-lang.org/dist/channel-rust-stable.toml',
      // 该 toml 中各包的 version 字段都带构建后缀，
      // 如 "0.100.0 (5f94df478 2026-08-27)"，直接取会得到错误版本。
      // 改为从 rustc 的下载 URL 中提取纯版本号。
      regex: /rustc-(\d+\.\d+\.\d+)-x86_64-pc-windows-msvc/
    },
    uninstall: { strategy: 'rustup-self', hint: '执行 rustup self uninstall 移除所有工具链' },
    tips: '安装后需重启终端；Windows 上编译原生扩展还需要 MSVC 生成工具（Visual Studio Build Tools）。'
  },
  {
    id: 'dotnet',
    name: '.NET SDK',
    category: 'language',
    icon: 'N.',
    color: '#512BD4',
    homepage: 'https://dotnet.microsoft.com/download',
    description: '微软跨平台 .NET 开发框架，C# / F# 语言基座，跨平台应用首选。',
    binaries: ['dotnet'],
    versionCmd: '"$BIN" --version',
    versionRegex: '(\\d+\\.\\d+\\.\\d+)',
    // .NET 注册表中有大量 Runtime / Host / FX Resolver 子条目，
    // 必须严格匹配 SDK 本身，否则会拿到 "64.28.16731" 这类构建号
    registryMatch: '^\\.NET SDK \\d|^Microsoft \\.NET SDK \\d',
    paths: ['C:\\Program Files\\dotnet\\dotnet.exe'],
    sizeHint: '约 220 MB',
    installer: {
      strategy: 'exe',
      urlTemplate: 'https://dotnetcli.azureedge.net/dotnet/WindowsDesktopSDK/{{version}}/windowsdesktop-sdk-{{version}}-win-x64.exe',
      args: ['/install', '/quiet', '/norestart', '/ceip', 'off'],
      exeName: 'windowsdesktop-sdk-{{version}}-win-x64.exe',
      fallback: {
        urlTemplate: 'https://dotnetcli.azureedge.net/dotnet/Sdk/{{version}}/dotnet-sdk-{{version}}-win-x64.exe',
        args: ['/install', '/quiet', '/norestart', '/ceip', 'off'],
        exeName: 'dotnet-sdk-{{version}}-win-x64.exe'
      }
    },
    latest: {
      type: 'json2',
      url: 'https://builds.dotnet.microsoft.com/dotnet/release-metadata/releases-index.json',
      // 索引里没有 sdk 版本，先取 LTS 渠道号，再请求该渠道详情
      transform: async j => {
        // 索引结构: { "releases-index": [ {channel-version, latest-sdk, releases.json, ...} ] }
        const channels = (j['releases-index'] || []).filter(c => c['support-phase'] === 'active')
        const target = channels.find(c => c['release-type'] === 'lts') || channels[0]
        if (!target) return target?.['latest-sdk'] || null
        if (target['latest-sdk']) return target['latest-sdk']
        const detail = JSON.parse(await httpGet(target['releases.json'], 20000, true))
        return detail['latest-sdk'] || detail.releases?.[0]?.sdk?.version || null
      }
    },
    uninstall: { strategy: 'registry', key: null },
    tips: '安装的是包含 WPF/WinForms 的 WindowsDesktop SDK，适合做 Windows 桌面应用。'
  },
  {
    id: 'ruby',
    name: 'Ruby',
    category: 'language',
    icon: 'Rb',
    color: '#CC342D',
    homepage: 'https://rubyinstaller.org',
    description: '动态语言，Ruby on Rails 的基础，语法优雅，脚本能力极强。',
    binaries: ['ruby'],
    versionCmd: '"$BIN" --version',
    versionRegex: 'ruby\\s+(\\d+\\.\\d+\\.\\d+)',
    registries: [`${R('RubyInstaller')}`],
    paths: ['C:\\Ruby*\\bin\\ruby.exe', 'C:\\tools\\ruby*\\bin\\ruby.exe'],
    sizeHint: '约 130 MB',
    installer: {
      strategy: 'exe',
      urlTemplate: 'https://github.com/oneclick/rubyinstaller2/releases/download/RubyInstaller-{{version}}-x64/rubyinstaller-{{version}}-x64.exe',
      args: ['/verysilent', '/dir={{installDir}}', '/tasks="assocfiles,modpath"', '/noicons'],
      exeName: 'rubyinstaller-{{version}}-x64.exe'
    },
    latest: {
      type: 'api',
      url: 'https://api.github.com/repos/oneclick/rubyinstaller2/releases/latest',
      pick: j => j.tag_name?.replace(/^RubyInstaller-/, '').replace(/-x64$/, '')
    },
    uninstall: { strategy: 'registry', key: null },
    tips: 'RubyInstaller 提供原生 Windows 版本，无需 WSL。'
  },
  {
    id: 'php',
    name: 'PHP',
    category: 'language',
    icon: 'PHP',
    color: '#777BB4',
    homepage: 'https://windows.php.net/download/',
    description: '服务端脚本语言，WordPress / Laravel 生态基础，内置 Web 服务器。',
    binaries: ['php'],
    versionCmd: '"$BIN" --version',
    versionRegex: 'PHP\\s+(\\d+\\.\\d+\\.\\d+)',
    registries: [],
    paths: ['C:\\php\\php.exe', 'C:\\tools\\php*\\php.exe', 'C:\\xampp\\php\\php.exe'],
    sizeHint: '约 30 MB',
    installer: {
      strategy: 'zip',
      urlTemplate: 'https://windows.php.net/downloads/releases/php-{{version}}-nts-Win32-vs16-x64.zip',
      args: [],
      exeName: null,
      installDirDefault: 'C:\\tools\\php',
      targetName: 'php.exe',
    },
    latest: {
      type: 'html',
      url: 'https://windows.php.net/download/',
      regex: /php-(\d+\.\d+\.\d+)-nts-Win32/i
    },
    uninstall: { strategy: 'manual', hint: '绿色版，卸载即删除安装目录并移除 PATH 条目' },
    tips: '绿色免安装版本，解压后需手动把 php 目录加入 PATH。'
  },
  {
    id: 'perl',
    name: 'Perl',
    category: 'language',
    icon: 'Pl',
    color: '#39457E',
    homepage: 'https://strawberryperl.com',
    description: '经典脚本语言，文本处理利器，Strawberry Perl 是 Windows 上的主流发行版。',
    binaries: ['perl'],
    versionCmd: '"$BIN" -v',
    versionRegex: 'v?(\\d+\\.\\d+\\.\\d+)',
    registries: [`${R('Strawberry Perl')}`],
    paths: ['C:\\Strawberry\\perl\\bin\\perl.exe', 'C:\\Perl64\\bin\\perl.exe'],
    sizeHint: '约 200 MB',
    installer: {
      strategy: 'exe',
      urlTemplate: 'https://strawberryperl.com/download/5.40.0.1/strawberry-perl-{{version}}-64bit-portable.exe',
      args: ['/S'],
      exeName: 'strawberry-perl-{{version}}-64bit-portable.exe'
    },
    // Strawberry Perl 官网首页标注了最新版本，但页面结构
    // 可能变动；解析失败时静默降级为跟随官方安装包
    latest: {
      type: 'html',
      url: 'https://strawberryperl.com/releases/',
      regex: /Strawberry Perl (\d+\.\d+\.\d+)/i,
      optional: true
    },
    uninstall: { strategy: 'registry', key: null },
    tips: '自带完整的 CPAN 模块仓库与编译工具链。'
  },
  {
    id: 'flutter',
    name: 'Flutter SDK',
    category: 'language',
    icon: 'Fl',
    color: '#02569B',
    homepage: 'https://docs.flutter.dev/get-started/install/windows',
    description: 'Google 的跨平台 UI 框架，一套代码同时构建 Android / iOS / Web / Windows。',
    binaries: ['flutter'],
    versionCmd: '"$BIN" --version',
    versionRegex: '(\\d+\\.\\d+\\.\\d+)',
    registries: [],
    paths: ['C:\\src\\flutter\\bin\\flutter.bat', '%LOCALAPPDATA%\\flutter\\bin\\flutter.bat'],
    sizeHint: '约 3 GB',
    installer: {
      strategy: 'zip',
      urlTemplate: 'https://storage.googleapis.com/flutter_infra_release/releases/stable/windows/flutter_windows_{{version}}-stable.zip',
      args: [],
      exeName: null,
      installDirDefault: 'C:\\src',
      innerFolder: 'flutter',
    },
    latest: {
      type: 'api',
      url: 'https://storage.googleapis.com/flutter_infra_release/releases/releases_windows.json',
      pick: j => j.releases?.find(r => r.channel === 'stable')?.version
    },
    uninstall: { strategy: 'manual', hint: '绿色版，卸载即删除 SDK 目录并移除 PATH 条目' },
    tips: '解压后需把 flutter\bin 加入 PATH；首次运行会自动下载 Dart SDK。'
  },
  {
    id: 'scala',
    name: 'Scala',
    category: 'language',
    icon: 'Sc',
    color: '#DC322F',
    homepage: 'https://www.scala-lang.org/download/',
    description: '面向 JVM 的函数式与面向对象混合语言，Akka / Spark 生态核心。',
    binaries: ['scala'],
    versionCmd: '"$BIN" -version',
    versionRegex: 'version\\s+(\\d+\\.\\d+\\.\\d+)',
    registries: [],
    paths: ['C:\\scala\\bin\\scala.bat'],
    sizeHint: '约 30 MB',
    installer: {
      strategy: 'zip',
      urlTemplate: 'https://downloads.lightbend.com/scala/{{version}}/scala-{{version}}.zip',
      args: [],
      exeName: null,
      installDirDefault: 'C:\\tools\\scala',
    },
    latest: {
      type: 'html',
      url: 'https://www.scala-lang.org/download/',
      regex: /scala-(2\.13|3\.\d+)\.(\d+)\.(\d+)\.zip/,
      transform: m => `${m[1]}.${m[2]}.${m[3]}`,
      optional: true
    },
    uninstall: { strategy: 'manual', hint: '绿色版，卸载即删除安装目录并移除 PATH 条目' },
    tips: '需要预先安装 Java JDK 才能运行 Scala。'
  },

  // ============================ 运行时 / 中间件 ============================
  {
    id: 'gradle',
    name: 'Gradle',
    category: 'runtime',
    icon: 'Gr',
    color: '#02303A',
    homepage: 'https://gradle.org/install/',
    description: '高性能构建工具，Java / Android / JVM 生态的默认选择，支持依赖缓存。',
    binaries: ['gradle'],
    versionCmd: '"$BIN" --version',
    versionRegex: 'Gradle\\s+(\\d+\\.\\d+(\\.\\d+)?)',
    registries: [],
    paths: ['C:\\gradle\\bin\\gradle.bat', 'C:\\tools\\gradle\\*\\bin\\gradle.bat'],
    sizeHint: '约 130 MB',
    installer: {
      strategy: 'zip',
      urlTemplate: 'https://services.gradle.org/distributions/gradle-{{version}}-bin.zip',
      args: [],
      exeName: null,
      installDirDefault: 'C:\\tools\\gradle',
    },
    latest: { type: 'html', url: 'https://services.gradle.org/versions/current', regex: /"version"\s*:\s*"([^"]+)"/ },
    uninstall: { strategy: 'manual', hint: '绿色版，删除目录并移除 PATH 条目即可' },
    tips: '若使用 Android Studio，通常已内置 Gradle，无需单独安装。'
  },
  {
    id: 'maven',
    name: 'Maven',
    category: 'runtime',
    icon: 'Mv',
    color: '#C41A16',
    homepage: 'https://maven.apache.org/download.cgi',
    description: 'Java 项目管理与构建标准工具，依赖坐标解析与生命周期管理。',
    binaries: ['mvn'],
    versionCmd: '"$BIN" --version',
    versionRegex: 'Apache Maven\\s+(\\d+\\.\\d+\\.\\d+)',
    registries: [],
    paths: ['C:\\apache-maven-*\\bin\\mvn.cmd', 'C:\\tools\\apache-maven-*\\bin\\mvn.cmd'],
    sizeHint: '约 10 MB',
    installer: {
      strategy: 'zip',
      urlTemplate: 'https://archive.apache.org/dist/maven/maven-3/{{version}}/binaries/apache-maven-{{version}}-bin.zip',
      args: [],
      exeName: null,
      installDirDefault: 'C:\\tools\\maven',
    },
    latest: { type: 'html', url: 'https://maven.apache.org/download.cgi', regex: /apache-maven-(\d+\.\d+\.\d+)-bin\.zip/ },
    uninstall: { strategy: 'manual', hint: '绿色版，删除目录并移除 PATH 条目即可' },
    tips: '需设置 M2_HOME / MAVEN_HOME 环境变量并将其 bin 加入 PATH。'
  },
  {
    id: 'cmake',
    name: 'CMake',
    category: 'runtime',
    icon: 'CM',
    color: '#064F8C',
    homepage: 'https://cmake.org/download/',
    description: '跨平台构建系统生成器，C / C++ 项目标配，几乎所有 SDK 都依赖它。',
    binaries: ['cmake'],
    versionCmd: '"$BIN" --version',
    versionRegex: 'cmake version\\s+(\\d+\\.\\d+\\.\\d+)',
    registries: [`${R('CMake')}`],
    paths: ['C:\\Program Files\\CMake\\bin\\cmake.exe'],
    sizeHint: '约 90 MB',
    installer: {
      strategy: 'msi',
      urlTemplate: 'https://github.com/Kitware/CMake/releases/download/v{{version}}/cmake-{{version}}-windows-x86_64.msi',
      args: ['/i', '{{file}}', '/qn', '/norestart', 'ADD_TO_PATH=1']
    },
    latest: {
      type: 'api',
      url: 'https://api.github.com/repos/Kitware/CMake/releases/latest',
      // CMake 的 release 无 tag_name，版本需从资源文件名中提取
      pick: j => {
        const asset = j.assets?.find(a => /-windows-x86_64\.msi$/.test(a.name))
        const m = asset?.name?.match(/^cmake-(\d+\.\d+\.\d+)/)
        return m ? m[1] : null
      }
    },
    uninstall: { strategy: 'registry', key: null },
    tips: '安装包中的 CMake 通常自带 MinGW-w64 的 GCC，可直接编译 C/C++。'
  },
  {
    id: 'ninja',
    name: 'Ninja',
    category: 'runtime',
    icon: 'Nj',
    color: '#4B8B3B',
    homepage: 'https://github.com/ninja-build/ninja/releases',
    description: 'Google 出品的小巧极速构建工具，CMake 的默认后端，比 Make 快数倍。',
    binaries: ['ninja'],
    versionCmd: '"$BIN" --version',
    versionRegex: '(\\d+\\.\\d+(\\.\\d+)?)',
    registries: [],
    paths: ['C:\\Program Files\\CMake\\bin\\ninja.exe', 'C:\\ProgramData\\chocolatey\\bin\\ninja.exe'],
    sizeHint: '约 3 MB',
    installer: {
      strategy: 'zip',
      urlTemplate: 'https://github.com/ninja-build/ninja/releases/download/v{{version}}/ninja-win.zip',
      args: [],
      exeName: null,
      installDirDefault: 'C:\\tools\\ninja',
      targetName: 'ninja.exe',
      targetSubdir: 'bin',
    },
    latest: {
      type: 'api',
      url: 'https://api.github.com/repos/ninja-build/ninja/releases/latest',
      pick: j => j.tag_name?.replace(/^v/, '')
    },
    uninstall: { strategy: 'manual', hint: '绿色版，删除目录并移除 PATH 条目即可' },
    tips: '很多 CMake 项目会自动捆绑 Ninja，通常无需单独安装。'
  },
  {
    id: 'msys2',
    name: 'MSYS2',
    category: 'runtime',
    icon: 'M2',
    color: '#2B6CB0',
    homepage: 'https://www.msys2.org/',
    description: 'Windows 上的精简 Unix 环境，提供 pacman 包管理器与 MinGW-w64 工具链。',
    binaries: ['bash', 'pacman'],
    versionCmd: '"$BIN" --version',
    versionRegex: '(\\d+\\.\\d+\\.\\d+)',
    registries: [`${R('MSYS2')}`],
    paths: ['C:\\msys64\\usr\\bin\\bash.exe', 'C:\\tools\\msys64\\usr\\bin\\bash.exe'],
    sizeHint: '约 400 MB',
    installer: {
      strategy: 'exe',
      urlTemplate: 'https://github.com/msys2/msys2-installer/releases/download/{{version}}/msys2-x86_64-{{version}}.exe',
      args: ['in', '--confirm-command', '--accept-messages', '--root', 'C:/msys64'],
      exeName: 'msys2-x86_64-{{version}}.exe'
    },
    // MSYS2 官方只发布 nightly 构建 (tag 恒为 nightly-x86_64)，
    // 没有可对比的版本号，因此固定跟随官方安装器
    latest: { type: 'static', value: 'latest' },
    uninstall: { strategy: 'registry', key: null },
    tips: '推荐用它来获取 GCC、MinGW-w64 等 Unix 风格开发工具。'
  },

  // ============================ 容器与数据库 ============================
  {
    id: 'docker',
    name: 'Docker Desktop',
    category: 'container',
    icon: 'Dk',
    color: '#2496ED',
    homepage: 'https://www.docker.com/products/docker-desktop/',
    description: '容器与镜像管理平台，附带 Compose、Kubernetes 与图形化界面。',
    binaries: ['docker'],
    versionCmd: '"$BIN" --version',
    versionRegex: '(\\d+\\.\\d+\\.\\d+)',
    // Docker 需 WSL2 就绪才能响应版本命令，探测失败不代表未安装
    tolerateProbeFailure: true,
    registries: [`${R('Docker Desktop')}`],
    paths: ['C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe'],
    sizeHint: '约 600 MB',
    installer: {
      strategy: 'exe',
      urlTemplate: 'https://desktop.docker.com/win/main/amd64/{{version}}/Docker%20Desktop%20Installer.exe',
      args: ['install', '--quiet', '--accept-license', '--backend=wsl-2'],
      exeName: 'Docker Desktop Installer.exe',
      adminRequired: true
    },
    // Docker 官方未提供稳定的版本查询接口，且安装链接本身
    // 指向 latest，因此固定跟随官方最新版
    latest: { type: 'static', value: 'latest' },
    uninstall: { strategy: 'registry', key: null },
    tips: '需要开启 WSL2 或 Hyper-V；企业版可填入授权密钥激活。'
  },
  {
    id: 'mysql',
    name: 'MySQL Server',
    category: 'container',
    icon: 'My',
    color: '#00758F',
    homepage: 'https://dev.mysql.com/downloads/installer/',
    description: '世界上最流行的开源关系型数据库，MySQL 协议兼容实现。',
    binaries: ['mysql'],
    versionCmd: '"$BIN" --version',
    versionRegex: '(\\d+\\.\\d+\\.\\d+)',
    registries: [
      `${R('MySQL Server 8.4')}`,
      `${R('MySQL Server 8.0')}`,
      `${R('MySQL Community Server')}`
    ],
    paths: ['C:\\Program Files\\MySQL\\MySQL Server *\\bin\\mysql.exe'],
    sizeHint: '约 400 MB',
    installer: {
      strategy: 'msi',
      urlTemplate: 'https://dev.mysql.com/get/Downloads/MySQLInstaller/mysql-installer-community-{{version}}.msi',
      args: ['/i', '{{file}}', '/qn', '/norestart'],
      adminRequired: true
    },
    latest: {
      // MySQL 官网为动态渲染页面，正则解析不稳定，
      // 而安装器本身也总是指向最新社区版，故固定跟随
      type: 'static',
      value: 'latest'
    },
    uninstall: { strategy: 'registry', key: null },
    tips: '静默安装仅部署 Server 组件；首次使用需手动初始化数据目录与 root 密码。'
  },
  {
    id: 'postgresql',
    name: 'PostgreSQL',
    category: 'container',
    icon: 'Pg',
    color: '#336791',
    homepage: 'https://www.postgresql.org/download/windows/',
    description: '功能完备的开源对象关系型数据库，SQL 标准兼容度最高。',
    binaries: ['psql'],
    versionCmd: '"$BIN" --version',
    versionRegex: '(\\d+\\.\\d+(\\.\\d+)?)',
    registries: [`${R('PostgreSQL')}`],
    registryMatch: '^PostgreSQL \\d',
    paths: ['C:\\Program Files\\PostgreSQL\\*\\bin\\psql.exe'],
    sizeHint: '约 350 MB',
    installer: {
      strategy: 'exe',
      urlTemplate: 'https://get.enterprisedb.com/postgresql/postgresql-{{version}}-windows-x64.exe',
      args: [
        '--mode', 'unattended',
        '--unattendedmodeui', 'none',
        '--prefix', '{{installDir}}',
        '--datadir', '{{installDir}}\\data',
        '--superpassword', 'postgres',
        '--servicename', 'postgresql-x64-{{version}}',
        '--serverport', '5432'
      ],
      exeName: 'postgresql-{{version}}-windows-x64.exe',
      adminRequired: true,
      installDirDefault: 'C:\\Program Files\\PostgreSQL\\{{version}}'
    },
    latest: {
      type: 'html',
      url: 'https://www.postgresql.org/ftp/source/',
      regex: /v(\d+\.\d+)/,
      optional: true
    },
    uninstall: { strategy: 'registry', key: null },
    tips: '静默安装默认 superuser 密码为 postgres，安装后建议立即修改。'
  },
  {
    id: 'redis',
    name: 'Redis',
    category: 'container',
    icon: 'Rd',
    color: '#DC382D',
    homepage: 'https://redis.io/docs/latest/operate/oss_and_stack/install/install-redis/install-redis-on-windows/',
    description: '内存键值数据库，缓存、消息队列、分布式锁场景的事实标准。',
    binaries: ['redis-server', 'redis-cli'],
    versionCmd: '"$BIN" --version',
    versionRegex: 'v?(\\d+\\.\\d+\\.\\d+)',
    registries: [`${R('Redis')}`],
    registryMatch: '^Redis',
    paths: ['C:\\Program Files\\Redis\\redis-server.exe', 'C:\\tools\\redis\\redis-server.exe'],
    sizeHint: '约 20 MB',
    installer: {
      strategy: 'zip',
      urlTemplate: 'https://github.com/redis-windows/redis-windows/releases/download/{{version}}/Redis-{{version}}-Windows-x64-msys2.zip',
      args: [],
      exeName: null,
      installDirDefault: 'C:\\tools\\redis',
      targetName: 'redis-server.exe',
      startService: 'redis-server.exe --daemonize no'
    },
    latest: {
      type: 'api',
      url: 'https://api.github.com/repos/redis-windows/redis-windows/releases/latest',
      pick: j => j.tag_name,
      optional: true
    },
    uninstall: { strategy: 'manual', hint: '绿色版，删除目录并移除 PATH 条目即可' },
    tips: 'Windows 版由社区维护，官方推荐在 WSL2 或 Docker 中运行生产版 Redis。'
  },
  {
    id: 'mongodb',
    name: 'MongoDB',
    category: 'container',
    icon: 'Mg',
    color: '#47A248',
    homepage: 'https://www.mongodb.com/try/download/community',
    description: '文档型数据库，BSON 存储结构，Node.js 与 Python 生态常用。',
    binaries: ['mongod', 'mongosh'],
    versionCmd: '"$BIN" --version',
    versionRegex: 'v?(\\d+\\.\\d+\\.\\d+)',
    registries: [`${R('MongoDB Server')}`],
    registryMatch: '^MongoDB (Server|Database Server)',
    paths: ['C:\\Program Files\\MongoDB\\Server\\*\\bin\\mongod.exe'],
    sizeHint: '约 500 MB',
    installer: {
      strategy: 'msi',
      urlTemplate: 'https://fastdl.mongodb.org/windows/MONGODB-WINDOWS-x86_64-{{version}}-signed.msi',
      args: [
        '/i', '{{file}}', '/qn', '/norestart',
        'INSTALLDIR="{{installDir}}"',
        'ADDLOCAL="ServerService,Client"',
        'SVCNAME="MongoDB"',
        'SVCSTARTUPTYPE=2',
        'ENABLESERVICE=1'
      ],
      adminRequired: true,
      installDirDefault: 'C:\\Program Files\\MongoDB\\Server\\{{version}}'
    },
    latest: {
      type: 'html',
      url: 'https://www.mongodb.com/try/download/community',
      regex: /mongodb-windows-x86_64-(\d+\.\d+\.\d+)/i,
      optional: true
    },
    uninstall: { strategy: 'registry', key: null },
    tips: '静默安装默认注册为 Windows 服务，卸载时需先停止 MongoDB 服务。'
  },

  // ============================ 工具链 ============================
  {
    id: 'git',
    name: 'Git',
    category: 'tool',
    icon: 'Gt',
    color: '#F05032',
    homepage: 'https://git-scm.com/download/win',
    description: '分布式版本控制工具，开发者必备，几乎所有协作流程的基础。',
    binaries: ['git'],
    versionCmd: '"$BIN" --version',
    versionRegex: '(\\d+\\.\\d+(\\.\\d+)?)',
    registries: [`${R('Git')}`, `${R('Git version *')}`],
    registryMatch: '^Git version',
    paths: ['C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Program Files (x86)\\Git\\cmd\\git.exe'],
    sizeHint: '约 70 MB',
    installer: {
      strategy: 'exe',
      urlTemplate: 'https://github.com/git-for-windows/git/releases/download/v{{version}}.windows.1/git-{{version}}-64-bit.exe',
      args: [
        '/VERYSILENT', '/NORESTART', '/NOCANCEL', '/SP-',
        '/SUPPRESSMSGBOXES', '/CLOSEAPPLICATIONS', '/RESTARTAPPLICATIONS',
        '/COMPONENTS="icons,ext\reg,libcurl2,assoc,assoc_sh"'
      ],
      exeName: 'git-{{version}}-64-bit.exe'
    },
    latest: {
      type: 'api',
      url: 'https://api.github.com/repos/git-for-windows/git/releases/latest',
      pick: j => j.tag_name?.replace(/^v/, '').replace(/\.windows\.1$/, '')
    },
    uninstall: { strategy: 'registry', key: null },
    tips: 'Git 内部使用 MinTTY 终端，若需配合 MSYS2 使用可选择「从 Windows 终端使用 Git」。'
  },
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    category: 'tool',
    icon: 'Vs',
    color: '#007ACC',
    homepage: 'https://code.visualstudio.com/download',
    description: '微软的免费代码编辑器，扩展生态极其丰富，内置 Git、调试器与终端。',
    binaries: ['code'],
    versionCmd: '"$BIN" --version',
    versionRegex: '(\\d+\\.\\d+\\.\\d+)',
    registries: [`${R('Microsoft Visual Studio Code')}`],
    registryMatch: '^Microsoft Visual Studio Code',
    paths: [
      'C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd',
      `${process.env.LOCALAPPDATA || '%LOCALAPPDATA%'}\\Programs\\Microsoft VS Code\\bin\\code.cmd`
    ],
    sizeHint: '约 350 MB',
    installer: {
      strategy: 'exe',
      urlTemplate: 'https://update.code.visualstudio.com/{{version}}/win32-x64-user/stable',
      args: ['/silent', '/mergetasks=!runcode,addcontextmenufiles,addcontextmenufolders,addtopath'],
      exeName: 'VSCodeUserSetup-x64.exe'
    },
    latest: {
      type: 'api',
      url: 'https://update.code.visualstudio.com/api/update/win32-x64-user/stable/latest',
      // 注意: 该接口的 version 字段是 commit hash，
      // 真实版本号在 productVersion 中
      pick: j => j.productVersion || j.name
    },
    uninstall: { strategy: 'registry', key: null },
    tips: '默认安装为当前用户版（无需管理员权限）；如需全局安装可改为 system 版安装包。'
  },
  {
    id: 'gh',
    name: 'GitHub CLI',
    category: 'tool',
    icon: 'GH',
    color: '#24292F',
    homepage: 'https://cli.github.com/',
    description: '官方的 GitHub 命令行工具，管理仓库、Issue、PR 与 Actions。',
    binaries: ['gh'],
    versionCmd: '"$BIN" --version',
    versionRegex: '(\\d+\\.\\d+\\.\\d+)',
    registries: [`${R('GitHub CLI')}`],
    paths: [
      'C:\\Program Files\\GitHub CLI\\gh.exe',
      `${process.env.LOCALAPPDATA || '%LOCALAPPDATA%'}\\Programs\\GitHub CLI\\gh.exe`
    ],
    sizeHint: '约 50 MB',
    installer: {
      strategy: 'msi',
      urlTemplate: 'https://github.com/cli/cli/releases/download/v{{version}}/gh_{{version}}_windows_amd64.msi',
      args: ['/i', '{{file}}', '/qn', '/norestart']
    },
    latest: {
      type: 'api',
      url: 'https://api.github.com/repos/cli/cli/releases/latest',
      pick: j => j.tag_name?.replace(/^v/, '')
    },
    uninstall: { strategy: 'registry', key: null },
    tips: '安装后运行 gh auth login 完成 GitHub 账号授权。'
  },
  {
    id: 'vs',
    name: 'Visual Studio Build Tools',
    category: 'tool',
    icon: 'VS',
    color: '#5C2D91',
    homepage: 'https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio',
    description: 'MSVC 编译器与 Windows SDK，编译 Node.js 原生模块、Rust、Python C 扩展必备。',
    binaries: ['cl', 'msbuild'],
    versionCmd: '"$BIN" 2>&1',
    versionRegex: null,
    registries: [
      `${R('Microsoft Visual Studio')}`,
      `${R('Microsoft Visual Studio Build Tools')}`,
      `${R('Microsoft Visual Studio 17 2022')}`
    ],
    paths: ['C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools'],
    registryMatch: '^Microsoft Visual Studio (\\d+.*)?(Build Tools|Professional|Enterprise|Community)',
    sizeHint: '约 7 GB',
    installer: {
      strategy: 'bootstrapper',
      urlTemplate: 'https://aka.ms/vs/17/release/vs_BuildTools.exe',
      args: [
        '--quiet', '--wait', '--norestart', '--nocache',
        '--add', 'Microsoft.VisualStudio.Workload.VCTools',
        '--add', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        '--add', 'Microsoft.VisualStudio.Component.Windows11SDK.22621'
      ],
      exeName: 'vs_BuildTools.exe',
      adminRequired: true,
      heavy: true
    },
    latest: { type: 'static', value: 'latest' },
    uninstall: { strategy: 'registry', key: null },
    tips: '体积巨大（完整安装约 7GB），建议按需选择组件；Rust / Node.js 原生模块编译离不开它。'
  },
  {
    id: 'postman',
    name: 'Postman',
    category: 'tool',
    icon: 'Pm',
    color: '#FF6C37',
    homepage: 'https://www.postman.com/downloads/',
    tolerateProbeFailure: true,
    description: '广受欢迎的 API 调试与测试工具，集合共享、环境变量管理。',
    binaries: ['postman'],
    versionCmd: '"$BIN" --version',
    versionRegex: '(\\d+\\.\\d+\\.\\d+)',
    registries: [`${R('Postman')}`],
    paths: [`${process.env.LOCALAPPDATA || '%LOCALAPPDATA%'}\\Postman\\Postman.exe`],
    sizeHint: '约 400 MB',
    installer: {
      strategy: 'exe',
      urlTemplate: 'https://dl.pstmn.io/download/latest/win64',
      args: ['/S'],
      exeName: 'Postman-win64.exe'
    },
    latest: { type: 'static', value: 'latest' },
    uninstall: { strategy: 'registry', key: null },
    tips: '下载链接始终指向最新稳定版（latest），因此版本号可能与显示略有滞后。'
  },
  {
    id: 'unity',
    name: 'Unity Hub',
    category: 'tool',
    icon: 'Un',
    color: '#222C37',
    homepage: 'https://unity.com/download',
    tolerateProbeFailure: true,
    description: 'Unity 游戏引擎的版本管理器与编辑器安装器。',
    binaries: ['unityhub'],
    versionCmd: '"$BIN" --version',
    versionRegex: '(\\d+\\.\\d+\\.\\d+)',
    registries: [`${R('Unity Hub')}`],
    paths: [`${process.env.PROGRAMFILES || '%PROGRAMFILES%'}\\Unity Hub\\Unity Hub.exe`],
    sizeHint: '约 1.2 GB',
    installer: {
      strategy: 'exe',
      urlTemplate: 'https://public-cdn.cloud.unity3d.com/hub/prod/UnityHubSetup.exe',
      args: ['/S'],
      exeName: 'UnityHubSetup.exe',
      adminRequired: true
    },
    latest: { type: 'static', value: 'latest' },
    uninstall: { strategy: 'registry', key: null },
    tips: 'Unity Hub 本体较小，具体引擎版本需在 Hub 界面内按需安装。'
  },
  {
    id: 'androidstudio',
    name: 'Android Studio',
    category: 'tool',
    icon: 'As',
    color: '#3DDC84',
    homepage: 'https://developer.android.com/studio',
    tolerateProbeFailure: true,
    description: 'Android 官方 IDE，内置 Android SDK、模拟器与 Gradle 支持。',
    binaries: ['studio64'],
    versionCmd: null,
    registries: [`${R('Android Studio')}`],
    paths: [
      'C:\\Program Files\\Android\\Android Studio\\bin\\studio64.exe',
      `${process.env.LOCALAPPDATA || '%LOCALAPPDATA%'}\\Programs\\Android Studio\\bin\\studio64.exe`
    ],
    sizeHint: '约 1.5 GB',
    installer: {
      strategy: 'exe',
      urlTemplate: 'https://redirector.gvt1.com/edgedl/android/studio/install/{{version}}/android-studio-{{version}}-windows.exe',
      args: ['/S'],
      exeName: 'android-studio-{{version}}-windows.exe'
    },
    latest: {
      type: 'html',
      url: 'https://developer.android.com/studio',
      regex: /android-studio-(\d+\.\d+\.\d+)-windows\.exe/,
      optional: true
    },
    uninstall: { strategy: 'registry', key: null },
    tips: '体积大且需管理员权限；首次启动会额外下载 Android SDK 组件。'
  },
  {
    id: 'firefox',
    name: 'Firefox',
    category: 'tool',
    icon: 'Ff',
    color: '#FF7139',
    homepage: 'https://www.mozilla.org/firefox/new/',
    tolerateProbeFailure: true,
    description: 'Mozilla 出品的开源浏览器，对 Web 标准支持最为严格。',
    binaries: ['firefox'],
    versionCmd: '"$BIN" --version',
    versionRegex: '(\\d+\\.\\d+(\\.\\d+)?)',
    registries: [`${R('Mozilla Firefox')}`],
    paths: [
      'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
      'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe'
    ],
    sizeHint: '约 300 MB',
    installer: {
      strategy: 'msi',
      urlTemplate: 'https://download.mozilla.org/?product=firebox-latest-ssl&os=win64&lang={{lang}}',
      args: ['/i', '{{file}}', '/qn', '/norestart'],
      exeName: null
    },
    latest: {
      type: 'html',
      url: 'https://www.mozilla.org/firefox/new/',
      regex: /Firefox\s+(\d+)\.(\d+(?:\.\d+)?)/,
      optional: true
    },
    uninstall: { strategy: 'registry', key: null },
    tips: '卸载后个人配置目录默认保留，如需彻底清除需手动删除 %APPDATA%\\Mozilla。'
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    category: 'tool',
    icon: 'Ob',
    color: '#7C3AED',
    homepage: 'https://obsidian.md/download',
    tolerateProbeFailure: true,
    description: '基于本地 Markdown 文件的知识库与笔记应用，插件生态丰富。',
    binaries: ['obsidian'],
    versionCmd: '"$BIN" --version',
    versionRegex: '(\\d+\\.\\d+\\.\\d+)',
    registries: [`${R('Obsidian')}`],
    paths: [`${process.env.LOCALAPPDATA || '%LOCALAPPDATA%'}\\Obsidian\\Obsidian.exe`],
    sizeHint: '约 200 MB',
    installer: {
      strategy: 'exe',
      urlTemplate: 'https://github.com/obsidianmd/obsidian-releases/releases/download/v{{version}}/Obsidian-{{version}}.exe',
      args: ['/S'],
      exeName: 'Obsidian-{{version}}.exe'
    },
    latest: {
      type: 'api',
      url: 'https://api.github.com/repos/obsidianmd/obsidian-releases/releases/latest',
      pick: j => j.tag_name?.replace(/^v/, '')
    },
    uninstall: { strategy: 'registry', key: null },
    tips: '笔记内容保存在你自己的 Markdown 文件夹中，卸载应用不会丢失。'
  },
  {
    id: 'powertoys',
    name: 'PowerToys',
    category: 'tool',
    icon: 'Pt',
    color: '#012456',
    homepage: 'https://learn.microsoft.com/windows/powertoys/',
    description: '微软官方 Windows 效率工具集，包含窗口管理、批量重命名、颜色选择器等实用模块。',
    binaries: ['PowerToys'],
    versionCmd: null,
    registries: [`${R('PowerToys')}`],
    paths: [`${process.env.PROGRAMFILES || '%PROGRAMFILES%'}\\PowerToys\\PowerToys.exe`],
    sizeHint: '约 350 MB',
    installer: {
      strategy: 'exe',
      urlTemplate: 'https://github.com/microsoft/PowerToys/releases/download/v{{version}}/PowerToysUserSetup-{{version}}-x64.exe',
      args: ['--quiet'],
      exeName: 'PowerToysUserSetup-{{version}}-x64.exe'
    },
    latest: {
      type: 'api',
      url: 'https://api.github.com/repos/microsoft/PowerToys/releases/latest',
      pick: j => j.tag_name?.replace(/^v/, '')
    },
    uninstall: { strategy: 'registry', key: null },
    tips: '包含 FancyZones 窗口分区、PowerRename 批量改名、Always On Top 置顶等高频功能。'
  },
  {
    id: 'sevenzip',
    name: '7-Zip',
    category: 'tool',
    icon: '7z',
    color: '#EE7C25',
    homepage: 'https://www.7-zip.org/download.html',
    tolerateProbeFailure: true,
    description: '开源高压缩率归档工具，Windows 系统自带压缩器的有力替代品。',
    binaries: ['7z'],
    versionCmd: '"$BIN" i',
    versionRegex: '7-Zip\\s+(\\d+\\.\\d+)',
    registries: [`${R('7-Zip')}`, `HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\7-Zip`],
    paths: ['C:\\Program Files\\7-Zip\\7z.exe'],
    sizeHint: '约 5 MB',
    installer: {
      strategy: 'exe',
      urlTemplate: 'https://www.7-zip.org/a/7z{{version}}-x64.exe',
      args: ['/S'],
      exeName: '7z{{version}}-x64.exe'
    },
    latest: {
      type: 'html',
      url: 'https://www.7-zip.org/download.html',
      // 形如 7z2603-x64.exe，需转成 26.03 便于版本对比
      regex: /7z(\d{2})(\d{2})-x64\.exe/,
      transform: m => `${m[1]}.${m[2]}`,
      optional: true
    },
    uninstall: { strategy: 'registry', key: null },
    tips: '7-Zip 的解压性能与压缩率通常优于系统自带压缩工具。'
  },
  {
    id: 'deno',
    name: 'Deno',
    category: 'language',
    icon: 'D',
    color: '#000000',
    homepage: 'https://deno.com',
    description: '新一代 JavaScript / TypeScript 运行时，原生支持 TypeScript，权限模型更安全。',
    binaries: ['deno'],
    versionCmd: '"$BIN" --version',
    versionRegex: 'deno\\s+(\\d+\\.\\d+\\.\\d+)',
    registries: [],
    paths: ['%USERPROFILE%\\.deno\\bin\\deno.exe', 'C:\\tools\\deno\\deno.exe'],
    sizeHint: '约 80 MB',
    installer: {
      strategy: 'zip',
      urlTemplate: 'https://github.com/denoland/deno/releases/download/v{{version}}/deno-x86_64-pc-windows-msvc.zip',
      args: [],
      exeName: null,
      // zip 内只有一个 deno.exe，无子目录
      installDirDefault: 'C:\\tools\\deno',
      targetName: 'deno.exe',
    },
    latest: {
      type: 'api',
      url: 'https://api.github.com/repos/denoland/deno/releases/latest',
      pick: j => j.tag_name?.replace(/^v/, '')
    },
    uninstall: { strategy: 'manual', hint: '绿色版，删除目录并移除 PATH 条目即可' },
    tips: 'Deno 是零依赖的单文件运行时，解压即用。'
  },
  {
    id: 'bun',
    name: 'Bun',
    category: 'language',
    icon: 'Bn',
    color: '#FBF1DF',
    homepage: 'https://bun.sh/docs/installation',
    description: '一体化 JS 运行时与工具链，集成了包管理器、测试运行器和 Bundler。',
    binaries: ['bun'],
    versionCmd: '"$BIN" --version',
    versionRegex: '(\\d+\\.\\d+\\.\\d+)',
    registries: [],
    paths: ['%USERPROFILE%\\.bun\\bin\\bun.exe', 'C:\\tools\\bun\\bun.exe'],
    sizeHint: '约 90 MB',
    installer: {
      strategy: 'zip',
      urlTemplate: 'https://github.com/oven-sh/bun/releases/download/bun-v{{version}}/bun-windows-x64.zip',
      args: [],
      exeName: null,
      installDirDefault: 'C:\\tools\\bun',
      targetName: 'bun.exe',
      targetSubdir: 'bun-windows-x64',
      pathEntry: 'bun-windows-x64',
    },
    latest: {
      type: 'api',
      url: 'https://api.github.com/repos/oven-sh/bun/releases/latest',
      pick: j => j.tag_name?.replace(/^bun-v/, '')
    },
    uninstall: { strategy: 'manual', hint: '绿色版，删除目录并移除 PATH 条目即可' },
    tips: '启动速度与安装速度显著优于 Node.js，适合脚本与构建工具。'
  }
]

const ENV_MAP = Object.fromEntries(ENVIRONMENTS.map(e => [e.id, e]))

module.exports = { ENVIRONMENTS, CATEGORIES, ENV_MAP }