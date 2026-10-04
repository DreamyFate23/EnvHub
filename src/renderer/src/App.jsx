import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'

const api = window.envhub

/* ================= 通用组件 ================= */

function Spinner() {
  return <span className="spinner" />
}

function Empty({ icon = '📦', title, hint }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 5 }}>{title}</div>
      {hint && <div style={{ fontSize: 12 }}>{hint}</div>}
    </div>
  )
}

/* ================= 环境卡片 ================= */

function EnvCard({ env, det, update, onDetail, onInstall, onUninstall, busy }) {
  const installed = det?.installed
  const hasUpdate = update?.hasUpdate

  return (
    <div className={`env-card ${installed ? 'installed' : ''} ${hasUpdate ? 'update' : ''}`}>
      <div className="env-head">
        <div className="env-icon" style={{ background: env.color || '#444' }}>
          {env.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="env-name">
            {env.name}
            {installed && !hasUpdate && <span className="badge badge-ok">已安装</span>}
            {hasUpdate && <span className="badge badge-upd">可更新</span>}
            {!installed && <span className="badge badge-new">未安装</span>}
          </div>
          <div className="env-desc">{env.description}</div>
        </div>
      </div>

      <div className="env-meta">
        {installed && det.version && (
          <span className="env-ver">v{det.version}</span>
        )}
        {hasUpdate && update.latest && (
          <span className="env-ver" style={{ color: 'var(--yellow)' }}>→ v{update.latest}</span>
        )}
        {env.adminRequired && <span className="badge badge-admin">需管理员</span>}
        {env.strategy === 'zip' && <span className="badge badge-zip">绿色版</span>}
        {env.heavy && <span className="badge badge-admin" style={{ background: 'var(--red-bg)', color: 'var(--red)' }}>体积大</span>}
        <span style={{ color: 'var(--text-faint)' }}>{env.sizeHint}</span>
      </div>

      {det?.exePath && (
        <div
          className="env-path"
          title={`${det.exePath}\n点击打开所在目录`}
          onClick={() => api.env.openDir(det.exePath.replace(/[\\/][^\\/]+$/, '')).catch(() => {})}
        >
          {det.exePath}
        </div>
      )}

      <div className="env-actions">
        <button className="btn btn-sm" onClick={() => onDetail(env, det)}>详情</button>
        {!installed ? (
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => onInstall(env)}>
            {busy ? <Spinner /> : '安装'}
          </button>
        ) : (
          <>
            {hasUpdate && (
              <button className="btn btn-sm btn-success" disabled={busy} onClick={() => onInstall(env, update.latest)}>
                {busy ? <Spinner /> : `更新到 ${update.latest}`}
              </button>
            )}
            <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => onUninstall(env, det)}>
              {busy ? <Spinner /> : '卸载'}
            </button>
          </>
        )}
        <button className="btn btn-sm btn-ghost" onClick={() => api.env.openExternal(env.homepage)}>官网</button>
      </div>
    </div>
  )
}

/* ================= 环境详情抽屉 ================= */

function EnvDrawer({ env, det, update, onClose, onInstall, onUninstall, busy }) {
  if (!env) return null
  const installed = det?.installed

  return (
    <>
      <div className="drawer-mask" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-head">
          <div className="env-icon" style={{ background: env.color || '#444', width: 46, height: 46, fontSize: 15 }}>
            {env.icon}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 600 }}>{env.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
              {installed ? `已安装 ${det.version ? `v${det.version}` : ''}` : '未安装'}
            </div>
          </div>
          <button className="close-x" onClick={onClose}>×</button>
        </div>

        <div className="drawer-body">
          <div>
            <div className="section-title">简介</div>
            <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-dim)' }}>{env.description}</div>
          </div>

          <div>
            <div className="section-title">安装信息</div>
            <table className="kv-table">
              <tbody>
                <tr><td>安装体积</td><td>{env.sizeHint}</td></tr>
                <tr><td>安装方式</td><td>{strategyLabel(env.strategy)}</td></tr>
                <tr><td>是否需管理员</td><td>{env.adminRequired ? '需要（会弹出 UAC）' : '不需要'}</td></tr>
                <tr><td>可自动更新</td><td>{env.hasVersionApi ? '支持' : '不支持（跟随官方最新版）'}</td></tr>
                <tr><td>卸载方式</td><td>{uninstallLabel(env.uninstallStrategy)}</td></tr>
                {update?.latest && <tr><td>官方最新版本</td><td style={{ color: 'var(--yellow)' }}>{update.latest}</td></tr>}
              </tbody>
            </table>
          </div>

          {installed && (
            <div>
              <div className="section-title">本机信息</div>
              <table className="kv-table">
                <tbody>
                  <tr><td>可执行文件</td><td>{det.exePath || '未在 PATH 中找到'}</td></tr>
                  <tr><td>安装目录</td><td>{det.installDir || '未知'}</td></tr>
                  <tr><td>识别方式</td><td>{sourceLabel(det.source)}</td></tr>
                  <tr><td>注册表键</td><td>{det.registryKey || '无'}</td></tr>
                </tbody>
              </table>
            </div>
          )}

          {env.adminRequired && (
            <div className="warn-box">
              此环境需要管理员权限安装，点击安装后会在系统弹出 UAC 授权窗口，请选择「是」。
            </div>
          )}
          {env.heavy && (
            <div className="warn-box">
              体积较大，安装可能需要 10 分钟以上。安装包为官方 Visual Studio Build Tools 引导程序，
              会联网下载组件。
            </div>
          )}
          {env.uninstallHint && (
            <div className="tip-box">卸载说明：{env.uninstallHint}</div>
          )}
          {env.tips && <div className="tip-box">💡 {env.tips}</div>}
        </div>

        <div className="drawer-foot">
          <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy} onClick={() => onInstall(env, update?.latest)}>
            {busy ? <Spinner /> : installed ? (update?.hasUpdate ? `更新到 ${update.latest}` : '重新安装') : '安装'}
          </button>
          {installed && (
            <button className="btn btn-danger" disabled={busy} onClick={() => onUninstall(env, det)}>
              {busy ? <Spinner /> : '卸载'}
            </button>
          )}
          <button className="btn" onClick={() => api.env.openExternal(env.homepage)}>官网</button>
        </div>
      </div>
    </>
  )
}

function strategyLabel(s) {
  return ({
    msi: 'MSI 静默安装 (msiexec)',
    exe: '官方 EXE 静默安装',
    zip: '绿色版解压安装',
    rustup: 'rustup 官方安装器',
    bootstrapper: '官方引导程序'
  })[s] || s || '未知'
}

function uninstallLabel(s) {
  return ({
    registry: '调用官方卸载程序（静默）',
    manual: '删除目录并清理 PATH',
    'rustup-self': 'rustup self uninstall'
  })[s] || s || '未知'
}

function sourceLabel(s) {
  return ({
    path: 'PATH 环境变量',
    registry: '注册表卸载项',
    both: 'PATH + 注册表双重确认'
  })[s] || '未识别'
}

/* ================= 环境变量编辑器 ================= */

function PathEditor({ scope, entries, onChange, onSave, dirty, onBackup, onRestore, backups }) {
  const [newEntry, setNewEntry] = useState('')
  const [filter, setFilter] = useState('')
  const listRef = useRef(null)

  const add = () => {
    const v = newEntry.trim()
    if (!v) return
    if (entries.some(e => e.toLowerCase() === v.toLowerCase())) return
    onChange([...entries, v])
    setNewEntry('')
  }

  const move = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= entries.length) return
    const next = [...entries]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  const remove = (i) => {
    const next = entries.filter((_, idx) => idx !== i)
    onChange(next)
  }

  const visible = useMemo(() => {
    const idx = []
    entries.forEach((e, i) => {
      if (!filter || e.toLowerCase().includes(filter.toLowerCase())) idx.push(i)
    })
    return idx
  }, [entries, filter])

  return (
    <>
      <div className="toolbar">
        <input
          className="input mono"
          placeholder="输入新目录路径，回车添加，例如 C:\tools\nodejs\bin"
          value={newEntry}
          onChange={e => setNewEntry(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
        />
        <button className="btn btn-primary" onClick={add} disabled={!newEntry.trim()}>添加</button>
        <button className="btn" onClick={() => setFilter(filter ? '' : 'node')} title="快速筛选常用条目">
          {filter ? '清除筛选' : '筛选'}
        </button>
      </div>

      <div className="toolbar" style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
          共 {entries.length} 个条目
          {dirty && <span style={{ color: 'var(--yellow)', marginLeft: 8 }}>● 有未保存的修改</span>}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button className="btn btn-sm" onClick={onBackup}>备份当前</button>
          {backups.length > 0 && <button className="btn btn-sm" onClick={onRestore}>还原备份</button>}
          <button
            className="btn btn-sm"
            disabled={!dirty}
            onClick={() => onSave(scope, entries)}
          >
            {dirty ? <><Spinner /> 保存到系统</> : '已保存'}
          </button>
        </div>
      </div>

      <div className="path-list">
        {visible.length === 0 && (
          <div className="path-item" style={{ color: 'var(--text-faint)', justifyContent: 'center', padding: 20 }}>
            {filter ? '没有匹配的条目' : '暂无条目，点击上方输入框添加'}
          </div>
        )}
        {visible.map(i => (
          <div className="path-item" key={`${entries[i]}-${i}`}>
            <span className="pidx">{i + 1}</span>
            <span className="ptext">{entries[i]}</span>
            <span className="pacts">
              <button className="icon-btn" title="上移" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
              <button className="icon-btn" title="下移" onClick={() => move(i, 1)} disabled={i === entries.length - 1}>↓</button>
              <button className="icon-btn danger" title="删除" onClick={() => remove(i)}>✕</button>
            </span>
          </div>
        ))}
      </div>
    </>
  )
}

function EnvVarsPage() {
  const [snapshot, setSnapshot] = useState(null)
  const [scope, setScope] = useState('user')
  const [userEntries, setUserEntries] = useState([])
  const [sysEntries, setSysEntries] = useState([])
  const [dirtyUser, setDirtyUser] = useState(false)
  const [dirtySys, setDirtySys] = useState(false)
  const [backups, setBackups] = useState([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState(null)
  const [customName, setCustomName] = useState('')
  const [customValue, setCustomValue] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [snap, bks] = await Promise.all([api.envvars.read(), api.envvars.listBackups()])
    setSnapshot(snap)
    setUserEntries(snap.user.path)
    setSysEntries(snap.system.path)
    setBackups(bks)
    setDirtyUser(false)
    setDirtySys(false)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const flash = (msg, kind = 'ok') => {
    setToast({ msg, kind })
    setTimeout(() => setToast(null), 3200)
  }

  const save = async (which, entries) => {
    if (which === 'system' && !snapshot.isAdmin) {
      const c = await api.app.confirm({
        title: '需要管理员权限',
        message: '修改系统级 PATH 需要管理员权限，将弹出 UAC 授权窗口。是否继续？'
      })
      if (!c.confirmed) return
    }
    try {
      await api.envvars.savePath(which, entries)
      if (which === 'user') { setUserEntries(entries); setDirtyUser(false) }
      else { setSysEntries(entries); setDirtySys(false) }
      flash(which === 'user' ? '用户级 PATH 已保存并生效' : '系统级 PATH 已保存并生效')
    } catch (e) {
      flash(`保存失败: ${e.message}`, 'err')
    }
  }

  const backup = async () => {
    try {
      const r = await api.envvars.backup('manual')
      setBackups(await api.envvars.listBackups())
      flash(`已备份到 ${r.file}`)
    } catch (e) { flash(`备份失败: ${e.message}`, 'err') }
  }

  const restore = async () => {
    const c = await api.app.confirm({
      title: '还原 PATH 备份',
      message: `将用备份文件还原 PATH，共 ${backups.length} 份可选。确定使用最近一份吗？`,
      detail: backups[0]?.file,
      danger: true
    })
    if (!c.confirmed) return
    try {
      await api.envvars.restore(backups[0].file)
      await load()
      flash('已还原备份')
    } catch (e) { flash(`还原失败: ${e.message}`, 'err') }
  }

  const setVar = async () => {
    if (!customName.trim()) return
    try {
      await api.envvars.set(customName.trim(), customValue, 'user')
      setCustomName(''); setCustomValue('')
      await load()
      flash('已设置环境变量')
    } catch (e) { flash(`设置失败: ${e.message}`, 'err') }
  }

  const delVar = async (name) => {
    try {
      await api.envvars.removeVar(name, 'user')
      await load()
      flash(`已删除 ${name}`)
    } catch (e) { flash(`删除失败: ${e.message}`, 'err') }
  }

  if (loading) return <div className="empty"><Spinner /></div>

  const extras = Object.entries(snapshot.extras || {})
  const current = scope === 'user' ? userEntries : sysEntries
  const dirty = scope === 'user' ? dirtyUser : dirtySys

  return (
    <>
      {toast && (
        <div className="banner" style={{
          background: toast.kind === 'err' ? 'var(--red-bg)' : 'var(--green-bg)',
          borderColor: toast.kind === 'err' ? 'rgba(248,81,73,.3)' : 'rgba(63,185,80,.3)',
          color: toast.kind === 'err' ? 'var(--red)' : 'var(--green)'
        }}>
          {toast.kind === 'err' ? '✕' : '✓'} {toast.msg}
        </div>
      )}

      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-val">{snapshot.user.path.length}</div>
          <div className="stat-label">用户级条目</div>
        </div>
        <div className="stat-card">
          <div className="stat-val">{snapshot.system.path.length}</div>
          <div className="stat-label">系统级条目</div>
        </div>
        <div className="stat-card">
          <div className="stat-val" style={{ color: snapshot.isAdmin ? 'var(--green)' : 'var(--yellow)' }}>
            {snapshot.isAdmin ? '是' : '否'}
          </div>
          <div className="stat-label">管理员权限</div>
        </div>
        <div className="stat-card">
          <div className="stat-val" style={{ fontSize: 14, paddingTop: 4 }}>
            {backups.length} 份
          </div>
          <div className="stat-label">历史备份</div>
        </div>
      </div>

      {!snapshot.isAdmin && (
        <div className="banner">
          ⚠ 当前非管理员运行，修改系统级 PATH 时会弹出 UAC 授权窗口。普通环境安装无需此权限。
        </div>
      )}

      <div className="tabs">
        <button className={`tab ${scope === 'user' ? 'active' : ''}`} onClick={() => setScope('user')}>
          用户级 PATH
        </button>
        <button className={`tab ${scope === 'system' ? 'active' : ''}`} onClick={() => setScope('system')}>
          系统级 PATH
        </button>
        <button className={`tab ${scope === 'vars' ? 'active' : ''}`} onClick={() => setScope('vars')}>
          其他变量
        </button>
        <button className={`tab ${scope === 'info' ? 'active' : ''}`} onClick={() => setScope('info')}>
          诊断信息
        </button>
      </div>

      {(scope === 'user' || scope === 'system') && (
        <PathEditor
          scope={scope}
          entries={current}
          dirty={dirty}
          backups={backups}
          onBackup={backup}
          onRestore={restore}
          onSave={save}
          onChange={scope === 'user' ? (v) => { setUserEntries(v); setDirtyUser(true) } : (v) => { setSysEntries(v); setDirtySys(true) }}
        />
      )}

      {scope === 'vars' && (
        <div>
          <div className="section-title" style={{ marginBottom: 10 }}>设置新的环境变量（用户级）</div>
          <div className="toolbar">
            <input className="input mono" style={{ maxWidth: 200 }} placeholder="变量名，如 JAVA_HOME"
              value={customName} onChange={e => setCustomName(e.target.value)} />
            <input className="input mono" placeholder="变量值" value={customValue}
              onChange={e => setCustomValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && setVar()} />
            <button className="btn btn-primary" onClick={setVar} disabled={!customName.trim()}>设置</button>
          </div>

          <div className="section-title" style={{ marginBottom: 10, marginTop: 22 }}>已检测到的常用变量</div>
          {extras.length === 0 ? (
            <div className="path-item" style={{ justifyContent: 'center', color: 'var(--text-faint)', padding: 20 }}>
              未检测到 JAVA_HOME / GOROOT 等常见变量
            </div>
          ) : (
            <div className="path-list">
              {extras.map(([k, v]) => (
                <div className="path-item" key={k}>
                  <span style={{ color: 'var(--accent)', width: 132 }}>{k}</span>
                  <span className="ptext">{v}</span>
                  <span className="pacts">
                    <button className="icon-btn danger" title="删除" onClick={() => delVar(k)}>✕</button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {scope === 'info' && (
        <table className="kv-table">
          <tbody>
            <tr><td>用户级 PATH 原始值</td><td style={{ wordBreak: 'break-all' }}>{snapshot.user.raw || '(空)'}</td></tr>
            <tr><td>系统级 PATH 原始值</td><td style={{ wordBreak: 'break-all' }}>{snapshot.system.raw || '(空)'}</td></tr>
            <tr><td>当前进程 PATH 长度</td><td>{snapshot.processPathCount}</td></tr>
            <tr><td>备份目录</td><td>{backups[0] ? backups[0].file : '暂无备份'}</td></tr>
          </tbody>
        </table>
      )}
    </>
  )
}

/* ================= 关于页 ================= */

function AboutPage({ info }) {
  return (
    <>
      <div className="section-title">EnvHub 客户端</div>
      <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.8, marginBottom: 22 }}>
        一站式开发环境管理工具。收录 {ENV_COUNT} 个常用开发环境，支持自动检测、
        静默安装、一键更新、完整卸载与环境变量管理。
        <br />
        所有安装包均来自各环境官方渠道，EnvHub 仅负责下载调度与静默执行。
      </div>

      <div className="section-title">运行时信息</div>
      <table className="kv-table">
        <tbody>
          <tr><td>EnvHub 版本</td><td>{info?.version}</td></tr>
          <tr><td>Electron</td><td>{info?.electron}</td></tr>
          <tr><td>Chromium</td><td>{info?.chrome}</td></tr>
          <tr><td>Node.js</td><td>{info?.node}</td></tr>
          <tr><td>平台架构</td><td>{info?.platform} / {info?.arch}</td></tr>
          <tr><td>管理员权限</td><td>{info?.isAdmin ? '是' : '否'}</td></tr>
          <tr><td>用户目录</td><td>{info?.home}</td></tr>
          <tr><td>安装包缓存</td><td>{info?.staging}</td></tr>
        </tbody>
      </table>

      <div style={{ marginTop: 22, display: 'flex', gap: 8 }}>
        <button className="btn" onClick={() => api.app.openStaging()}>打开安装包缓存目录</button>
      </div>

      <div className="section-title" style={{ marginTop: 26, marginBottom: 10 }}>使用说明</div>
      <div className="tip-box" style={{ lineHeight: 1.9 }}>
        1. 左侧「环境库」中点击卡片上的「安装」按钮，客户端会自动下载官方安装包并静默安装。<br />
        2. 标注「需管理员」的环境会弹出 UAC 授权窗口，点击「是」即可。<br />
        3. 安装完成后会自动重新扫描环境，已安装的会显示绿色标记与版本号。<br />
        4. 「环境变量」页可编辑用户级与系统级 PATH，保存前系统会自动备份一份。<br />
        5. 卸载绿色版环境会直接删除安装目录并自动清理 PATH 条目。
      </div>
    </>
  )
}

let ENV_COUNT = 0

/* ================= 主应用 ================= */

export default function App() {
  const [page, setPage] = useState('envs')
  const [envs, setEnvs] = useState([])
  const [categories, setCategories] = useState([])
  const [detections, setDetections] = useState({})
  const [updates, setUpdates] = useState({})
  const [query, setQuery] = useState('')
  const [filterCat, setFilterCat] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [scanning, setScanning] = useState(false)
  const [scanLabel, setScanLabel] = useState('')
  const [checking, setChecking] = useState(false)
  const [detail, setDetail] = useState(null)
  const [busyIds, setBusyIds] = useState(new Set())
  const [tasks, setTasks] = useState([])
  const [info, setInfo] = useState(null)
  const [booted, setBooted] = useState(false)

  /* 初始化 */
  useEffect(() => {
    ;(async () => {
      const [list, cats, appInfo] = await Promise.all([
        api.env.list(), api.env.categories(), api.app.info()
      ])
      ENV_COUNT = list.length
      setEnvs(list)
      setCategories(cats)
      setInfo(appInfo)
      await scan(false)
      setBooted(true)
    })()
  }, [])

  /* 任务事件订阅 */
  useEffect(() => {
    return api.events.onTask(evt => {
      const { taskId, ...rest } = evt
      setTasks(prev => {
        let found = false
        const next = prev.map(t => {
          if (t.taskId !== taskId) return t
          found = true
          return { ...t, ...rest, phase: rest.phase || t.phase }
        })
        if (!found && evt.phase === 'start') {
          return [...prev, { taskId, ...rest }]
        }
        return next
      })
      // 终态：3 秒后自动移除卡片
      if (['done', 'error'].includes(evt.phase)) {
        setTimeout(() => setTasks(prev => prev.filter(t => t.taskId !== taskId)), 3000)
      }
    })
  }, [])

  useEffect(() => {
    return api.events.onDetectProgress(p => {
      setScanLabel(`${p.current}/${p.total}  ${p.name}`)
    })
  }, [])

  /* 扫描 */
  const scan = useCallback(async (notify = true) => {
    setScanning(true)
    setScanLabel('正在扫描本机环境…')
    try {
      const results = await api.env.detect()
      const map = {}
      for (const r of results) map[r.id] = r
      setDetections(map)
      if (notify) setScanLabel('扫描完成')
    } finally {
      setScanning(false)
      setTimeout(() => setScanLabel(''), 1500)
    }
  }, [])

  const checkUpdates = useCallback(async () => {
    setChecking(true)
    try {
      const installedList = Object.values(detections).filter(d => d.installed)
      const results = await api.env.checkUpdates(installedList)
      const map = {}
      for (const r of results) map[r.id] = r
      setUpdates(map)
      const n = results.filter(r => r.hasUpdate).length
      setScanLabel(n ? `${n} 个环境有新版本` : '全部环境均为最新')
      setTimeout(() => setScanLabel(''), 3000)
    } catch (e) {
      setScanLabel(`检查更新失败: ${e.message}`)
      setTimeout(() => setScanLabel(''), 3000)
    } finally {
      setChecking(false)
    }
  }, [detections])

  /* 安装 / 卸载 */
  const markBusy = (id, on) => {
    setBusyIds(prev => {
      const s = new Set(prev)
      if (on) s.add(id); else s.delete(id)
      return s
    })
  }

  const doInstall = async (env, version) => {
    markBusy(env.id, true)
    try {
      const r = await api.env.install(env.id, version)
      if (!r.ok) {
        const c = await api.app.confirm({
          title: `${env.name} 安装失败`,
          message: `自动安装未成功：${r.error}`,
          detail: '可以尝试手动下载官方安装包完成安装。是否打开官方页面？',
          danger: true
        })
        if (c.confirmed) api.env.openExternal(env.homepage)
      } else {
        await scan(false)
      }
    } finally {
      markBusy(env.id, false)
      setDetail(null)
    }
  }

  const doUninstall = async (env, det) => {
    const c = await api.app.confirm({
      title: `卸载 ${env.name}`,
      message: `确定要卸载 ${env.name} ${det.version ? `v${det.version}` : ''} 吗？`,
      detail: env.uninstallHint || '卸载后将自动清理残留的 PATH 条目。此操作不可撤销。',
      danger: true
    })
    if (!c.confirmed) return

    markBusy(env.id, true)
    try {
      const r = await api.env.uninstall(env.id, det)
      if (!r.ok) {
        await api.app.confirm({
          title: `${env.name} 卸载未完成`,
          message: r.error,
          detail: '可尝试在「Windows 设置 → 应用」中手动卸载。',
          danger: true
        })
      }
      await scan(false)
    } finally {
      markBusy(env.id, false)
      setDetail(null)
    }
  }

  /* 过滤 */
  const filtered = useMemo(() => {
    return envs.filter(e => {
      if (filterCat !== 'all' && e.category !== filterCat) return false
      const d = detections[e.id]
      const st = filterStatus
      if (st === 'installed' && !d?.installed) return false
      if (st === 'missing' && d?.installed) return false
      if (st === 'update' && !updates[e.id]?.hasUpdate) return false
      if (query) {
        const q = query.toLowerCase()
        const hay = `${e.name} ${e.description} ${e.category}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [envs, detections, updates, filterCat, filterStatus, query])

  const stats = useMemo(() => {
    const all = Object.values(detections)
    const installed = all.filter(d => d.installed).length
    const updatable = Object.values(updates).filter(u => u.hasUpdate).length
    return { total: envs.length, installed, missing: envs.length - installed, updatable }
  }, [detections, updates, envs])

  if (!booted) {
    return (
      <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 14 }}>
        <div className="brand-logo" style={{ width: 48, height: 48, fontSize: 22 }}>E</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-dim)', fontSize: 13 }}>
          <Spinner /> {scanLabel || '正在初始化…'}
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      {/* ============ 侧边栏 ============ */}
      <div className="sidebar">
        <div className="brand">
          <div className="brand-logo">E</div>
          <div>
            <div className="brand-name">EnvHub</div>
            <div className="brand-sub">开发环境管理</div>
          </div>
        </div>

        <button className={`nav-item ${page === 'envs' ? 'active' : ''}`} onClick={() => setPage('envs')}>
          <span className="nav-icon">📦</span> 环境库
          <span className="nav-badge">{stats.installed}/{stats.total}</span>
        </button>

        <button
          className={`nav-item ${filterStatus === 'update' ? 'active' : ''}`}
          onClick={() => { setPage('envs'); setFilterStatus(filterStatus === 'update' ? 'all' : 'update') }}
          disabled={stats.updatable === 0}
          style={stats.updatable === 0 ? { opacity: .45, cursor: 'not-allowed' } : {}}
        >
          <span className="nav-icon">⬆️</span> 可更新
          {stats.updatable > 0 && <span className="nav-badge alert">{stats.updatable}</span>}
        </button>

        <button className={`nav-item ${page === 'vars' ? 'active' : ''}`} onClick={() => setPage('vars')}>
          <span className="nav-icon">🌿</span> 环境变量
        </button>

        <button className={`nav-item ${page === 'about' ? 'active' : ''}`} onClick={() => setPage('about')}>
          <span className="nav-icon">ℹ️</span> 关于
        </button>

        <div className="sidebar-footer">
          <div style={{ color: 'var(--text-dim)' }}>EnvHub v{info?.version}</div>
          <div>收录 {stats.total} 个环境</div>
          <div style={{ color: info?.isAdmin ? 'var(--green)' : 'var(--text-faint)' }}>
            {info?.isAdmin ? '管理员模式' : '标准用户模式'}
          </div>
        </div>
      </div>

      {/* ============ 主区 ============ */}
      <div className="main">
        <div className="topbar">
          <div>
            <div className="topbar-title">
              {page === 'envs' ? '环境库' : page === 'vars' ? '环境变量管理' : '关于 EnvHub'}
            </div>
            {page === 'envs' && (
              <div className="topbar-sub">
                已安装 {stats.installed} · 未安装 {stats.missing}
                {stats.updatable > 0 && ` · ${stats.updatable} 个可更新`}
              </div>
            )}
          </div>

          {page === 'envs' && (
            <>
              <button className="btn btn-sm" onClick={() => scan(true)} disabled={scanning}>
                {scanning ? <Spinner /> : '🔄'} 重新扫描
              </button>
              <button className="btn btn-sm" onClick={checkUpdates} disabled={checking || scanning}>
                {checking ? <Spinner /> : '☁️'} 检查更新
              </button>
              <div className="search">
                <span className="search-icon">🔍</span>
                <input
                  placeholder="搜索环境…"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
              </div>
            </>
          )}
        </div>

        <div className="content">
          {page === 'envs' && (
            <>
              {scanLabel && (
                <div className="banner">
                  {scanning || checking ? <Spinner /> : 'ℹ️'} {scanLabel}
                </div>
              )}

              <div className="stat-row">
                <div className="stat-card">
                  <div className="stat-val">{stats.total}</div>
                  <div className="stat-label">收录环境总数</div>
                </div>
                <div className="stat-card">
                  <div className="stat-val" style={{ color: 'var(--green)' }}>{stats.installed}</div>
                  <div className="stat-label">已安装</div>
                </div>
                <div className="stat-card">
                  <div className="stat-val" style={{ color: 'var(--text-dim)' }}>{stats.missing}</div>
                  <div className="stat-label">未安装</div>
                </div>
                <div className="stat-card">
                  <div className="stat-val" style={{ color: stats.updatable ? 'var(--yellow)' : 'var(--text-dim)' }}>
                    {stats.updatable}
                  </div>
                  <div className="stat-label">可更新</div>
                </div>
              </div>

              <div className="filter-bar">
                <button className={`chip ${filterStatus === 'all' ? 'active' : ''}`}
                  onClick={() => setFilterStatus('all')}>全部</button>
                <button className={`chip ${filterStatus === 'installed' ? 'active' : ''}`}
                  onClick={() => setFilterStatus('installed')}>已安装</button>
                <button className={`chip ${filterStatus === 'missing' ? 'active' : ''}`}
                  onClick={() => setFilterStatus('missing')}>未安装</button>
                <button className={`chip ${filterStatus === 'update' ? 'active' : ''}`}
                  onClick={() => setFilterStatus('update')}>可更新</button>

                <span style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />

                {categories.map(c => (
                  <button key={c.id} className={`chip ${filterCat === c.id ? 'active' : ''}`}
                    onClick={() => setFilterCat(filterCat === c.id ? 'all' : c.id)}>
                    {c.icon} {c.name}
                  </button>
                ))}
              </div>

              {filtered.length === 0 ? (
                <Empty
                  title={query ? '没有匹配的环境' : '当前筛选下没有环境'}
                  hint={query ? '试试其他关键词' : '切换筛选条件看看'}
                />
              ) : (
                <div className="grid">
                  {filtered.map(env => (
                    <EnvCard
                      key={env.id}
                      env={env}
                      det={detections[env.id]}
                      update={updates[env.id]}
                      busy={busyIds.has(env.id)}
                      onDetail={e => setDetail({ env: e, det: detections[e.id] })}
                      onInstall={doInstall}
                      onUninstall={doUninstall}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {page === 'vars' && <EnvVarsPage />}
          {page === 'about' && <AboutPage info={info} />}
        </div>
      </div>

      {/* ============ 抽屉 ============ */}
      {detail && (
        <EnvDrawer
          env={detail.env}
          det={detail.det}
          update={updates[detail.env.id]}
          busy={busyIds.has(detail.env.id)}
          onClose={() => setDetail(null)}
          onInstall={doInstall}
          onUninstall={doUninstall}
        />
      )}

      {/* ============ 任务面板 ============ */}
      <div className="task-dock">
        {tasks.map(t => {
          const pct = t.percent ?? 0
          const isFinal = ['done', 'error', 'warn'].includes(t.phase)
          return (
            <div className="task-card" key={t.taskId}>
              <div className="task-head">
                <span style={{ fontSize: 13 }}>{t.phase === 'uninstall' || t.taskId.startsWith('uninstall') ? '🗑' : '📥'}</span>
                <span className="task-name">
                  {t.message?.match(/^(.+?)(?:\s|$)/)?.[1] || '任务'}
                </span>
                {!isFinal && <Spinner />}
              </div>
              <div className="task-msg">{t.message}</div>
              <div className="progress">
                <div
                  className={`progress-bar ${isFinal ? (t.phase === 'error' ? 'err' : 'ok') : ''}`}
                  style={{
                    width: isFinal ? '100%' : (t.phase === 'download' ? `${pct}%` : undefined),
                    ...(t.phase !== 'download' && !isFinal ? { className: 'progress-bar indeterminate' } : {})
                  }}
                />
              </div>
              {t.phase === 'download' && t.total > 0 && (
                <div style={{ fontSize: 10.5, color: 'var(--text-faint)', marginTop: 5, fontFamily: 'ui-monospace, monospace' }}>
                  {(t.received / 1048576).toFixed(1)} / {(t.total / 1048576).toFixed(1)} MB
                  {t.speed > 0 && ` · ${(t.speed / 1048576).toFixed(1)} MB/s`}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}