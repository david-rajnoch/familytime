import { useState } from 'react'
import { useJobs, useStartIndex, useTriggerClustering, useCancelJob, useFolders, useDeleteFolders, useExtractDates, type IndexJob } from '../api/indexing'
import { useUIStore } from '../store/ui'
import { apiFetch } from '../api/client'

function JobCard({ job }: { job: IndexJob }) {
  const cancelJob = useCancelJob()
  const pct = job.files_total > 0 ? Math.round((job.files_done / job.files_total) * 100) : 0
  const isActive = job.status === 'running' || job.status === 'clustering'
  const statusColor =
    job.status === 'done' ? '#34d399' :
    job.status === 'error' ? '#f87171' :
    job.status === 'cancelled' ? '#888' :
    '#7c6af7'
  const statusLabel =
    job.status === 'running' ? 'Indexing…' :
    job.status === 'clustering' ? 'Clustering faces…' :
    job.status === 'done' ? '✓ Complete' :
    job.status === 'cancelled' ? '◼ Stopped' :
    `Error: ${job.error_msg ?? 'unknown'}`

  return (
    <div style={{ background: '#242429', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {job.root_path}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isActive && (
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, display: 'inline-block', animation: 'pulse 1.2s infinite' }} />
          )}
          <span style={{ color: statusColor }}>{statusLabel}</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isActive && (
            <button
              onClick={() => cancelJob.mutate(job.id)}
              disabled={cancelJob.isPending}
              title="Stop indexing"
              style={{
                padding: '3px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                background: 'transparent', border: '1px solid #f87171', color: '#f87171',
                opacity: cancelJob.isPending ? 0.5 : 1,
              }}
            >
              Stop
            </button>
          )}
          <span style={{ color: '#555', fontSize: 12 }}>
            {job.finished_at ? new Date(job.finished_at).toLocaleDateString() : ''}
          </span>
        </span>
      </div>
      <div style={{ height: 6, background: '#1a1a1f', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${job.status === 'done' ? 100 : pct}%`,
          background: job.status === 'done' ? '#34d399' : job.status === 'cancelled' ? '#555' : 'linear-gradient(90deg, #7c6af7, #34d399)',
          borderRadius: 3,
          transition: 'width 1s',
        }} />
      </div>
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#555' }}>
        <span>{job.files_done.toLocaleString()} / {job.files_total.toLocaleString()} files</span>
        <span>{job.faces_found.toLocaleString()} faces</span>
      </div>
    </div>
  )
}

function FolderManager() {
  const { data: folders, isLoading } = useFolders()
  const deleteFolders = useDeleteFolders()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)

  const toggle = (label: string) =>
    setSelected((s) => { const n = new Set(s); n.has(label) ? n.delete(label) : n.add(label); return n })

  const handleDelete = async () => {
    await deleteFolders.mutateAsync([...selected])
    setSelected(new Set())
    setConfirming(false)
  }

  if (isLoading) return <div style={{ color: '#555', fontSize: 13 }}>Loading folders…</div>
  if (!folders?.length) return <div style={{ color: '#555', fontSize: 13 }}>No indexed folders yet.</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {selected.size > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {confirming ? (
            <>
              <span style={{ fontSize: 13, color: '#f87171', flex: 1 }}>
                Delete {selected.size} folder{selected.size > 1 ? 's' : ''}? This cannot be undone.
              </span>
              <button
                onClick={handleDelete}
                disabled={deleteFolders.isPending}
                style={{ padding: '5px 12px', background: '#f87171', border: 'none', borderRadius: 7, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                {deleteFolders.isPending ? 'Deleting…' : 'Confirm'}
              </button>
              <button
                onClick={() => setConfirming(false)}
                style={{ padding: '5px 12px', background: '#242429', border: '1px solid #2e2e36', borderRadius: 7, color: '#888', fontSize: 12, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <span style={{ fontSize: 13, color: '#888', flex: 1 }}>{selected.size} selected</span>
              <button
                onClick={() => setSelected(new Set())}
                style={{ padding: '5px 10px', background: 'transparent', border: '1px solid #2e2e36', borderRadius: 7, color: '#555', fontSize: 12, cursor: 'pointer' }}
              >
                Clear
              </button>
              <button
                onClick={() => setConfirming(true)}
                style={{ padding: '5px 12px', background: 'transparent', border: '1px solid #f87171', borderRadius: 7, color: '#f87171', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                Delete selected
              </button>
            </>
          )}
        </div>
      )}

      {folders.map((f) => {
        const isSelected = selected.has(f.label)
        const dateStr = f.first_date
          ? new Date(f.first_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })
          : ''
        return (
          <div
            key={f.label}
            onClick={() => toggle(f.label)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: isSelected ? '#1e1a35' : '#242429',
              border: `1px solid ${isSelected ? '#7c6af7' : '#2e2e36'}`,
              borderRadius: 9, padding: '10px 12px', cursor: 'pointer',
              transition: 'border-color .12s, background .12s',
            }}
          >
            <div style={{
              width: 16, height: 16, borderRadius: 4, flexShrink: 0,
              border: `2px solid ${isSelected ? '#7c6af7' : '#555'}`,
              background: isSelected ? '#7c6af7' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, color: '#fff',
            }}>
              {isSelected ? '✓' : ''}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.label}
              </div>
              <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>
                {f.file_count} files · {f.face_count} faces
                {f.photo_count > 0 && ` · ${f.photo_count} photos`}
                {f.video_count > 0 && ` · ${f.video_count} videos`}
              </div>
            </div>
            <div style={{ fontSize: 11, color: '#555', flexShrink: 0 }}>{dateStr}</div>
          </div>
        )
      })}
    </div>
  )
}

export function IndexingDrawer() {
  const { drawerOpen, setDrawerOpen } = useUIStore()
  const [tab, setTab] = useState<'index' | 'folders'>('index')
  const [path, setPath] = useState('')
  const [picking, setPicking] = useState(false)
  const [intervalS, setIntervalS] = useState(3)
  const [sceneDetect, setSceneDetect] = useState(true)
  const { data: jobs } = useJobs()
  const startIndex = useStartIndex()
  const recluster = useTriggerClustering()
  const extractDates = useExtractDates()

  const handleBrowse = async () => {
    setPicking(true)
    try {
      const res = await apiFetch<{ path: string }>('/system/pick-folder')
      setPath(res.path)
    } catch {
      // 204 = user cancelled, anything else = error — either way just do nothing
    } finally {
      setPicking(false)
    }
  }

  const handleStart = async () => {
    if (!path.trim()) return
    await startIndex.mutateAsync({
      path: path.trim(),
      video_sample_interval_s: intervalS,
      scene_detection: sceneDetect,
    })
  }

  if (!drawerOpen) return null

  return (
    <>
      <div
        onClick={() => setDrawerOpen(false)}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 150 }}
      />
      <div style={{
        position: 'fixed', right: 0, top: 0, bottom: 0, width: 400,
        background: '#1a1a1f', borderLeft: '1px solid #2e2e36',
        zIndex: 151, padding: 24, display: 'flex', flexDirection: 'column', gap: 20,
        overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Manage Index</div>
          <button
            onClick={() => setDrawerOpen(false)}
            style={{ background: 'none', border: 'none', color: '#888', fontSize: 20, cursor: 'pointer' }}
          >✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, background: '#242429', borderRadius: 10, padding: 4 }}>
          {([['index', 'Index Drive'], ['folders', 'Indexed Folders']] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{
                flex: 1, padding: '7px 0', borderRadius: 7, border: 'none', fontSize: 13,
                fontWeight: tab === id ? 600 : 400, cursor: 'pointer',
                background: tab === id ? '#1a1a1f' : 'transparent',
                color: tab === id ? '#e8e8f0' : '#888',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'folders' && <FolderManager />}

        {tab === 'index' && <>
        {/* Path input + browse button */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            onClick={handleBrowse}
            disabled={picking}
            style={{
              width: '100%', padding: '11px 16px', borderRadius: 10,
              background: '#242429', border: '2px dashed #3a3a45',
              color: picking ? '#555' : '#e8e8f0', fontSize: 14, cursor: picking ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'border-color .15s',
            }}
            onMouseEnter={e => !picking && ((e.currentTarget as HTMLElement).style.borderColor = '#7c6af7')}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.borderColor = '#3a3a45')}
          >
            <span style={{ fontSize: 18 }}>📁</span>
            {picking ? 'Opening folder picker…' : 'Choose Folder…'}
          </button>

          {path && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#242429', border: '1px solid #2e2e36',
              borderRadius: 8, padding: '8px 12px',
            }}>
              <span style={{ fontSize: 14 }}>📂</span>
              <span style={{
                flex: 1, fontSize: 13, color: '#e8e8f0',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {path}
              </span>
              <button
                onClick={() => setPath('')}
                style={{ background: 'none', border: 'none', color: '#555', fontSize: 16, cursor: 'pointer', flexShrink: 0, lineHeight: 1 }}
              >✕</button>
            </div>
          )}
        </div>

        {/* Settings */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14 }}>
            <span style={{ color: '#888' }}>Video sampling</span>
            <select
              value={intervalS}
              onChange={(e) => setIntervalS(Number(e.target.value))}
              style={{ background: '#242429', border: '1px solid #2e2e36', borderRadius: 7, padding: '6px 10px', color: '#e8e8f0', fontSize: 13 }}
            >
              <option value={3}>Every 3 seconds (thorough)</option>
              <option value={10}>Every 10 seconds</option>
              <option value={30}>Every 30 seconds</option>
            </select>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14 }}>
            <span style={{ color: '#888' }}>Scene detection</span>
            <select
              value={sceneDetect ? '1' : '0'}
              onChange={(e) => setSceneDetect(e.target.value === '1')}
              style={{ background: '#242429', border: '1px solid #2e2e36', borderRadius: 7, padding: '6px 10px', color: '#e8e8f0', fontSize: 13 }}
            >
              <option value="1">Enabled</option>
              <option value="0">Disabled</option>
            </select>
          </div>
        </div>

        <button
          onClick={handleStart}
          disabled={!path.trim() || startIndex.isPending}
          style={{
            padding: 11, background: '#7c6af7', border: 'none', borderRadius: 10,
            color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer',
            opacity: path.trim() ? 1 : 0.5,
          }}
        >
          {startIndex.isPending ? 'Starting…' : 'Start Indexing'}
        </button>

        <button
          onClick={() => recluster.mutate()}
          disabled={recluster.isPending}
          style={{
            padding: 9, background: '#242429', border: '1px solid #2e2e36', borderRadius: 10,
            color: '#888', fontSize: 13, cursor: 'pointer',
          }}
        >
          {recluster.isPending ? 'Clustering…' : 'Re-run Clustering'}
        </button>

        <button
          onClick={() => extractDates.mutate()}
          disabled={extractDates.isPending}
          style={{
            padding: 9, background: '#242429', border: '1px solid #2e2e36', borderRadius: 10,
            color: '#888', fontSize: 13, cursor: 'pointer',
          }}
        >
          {extractDates.isPending ? 'Starting…' : 'Extract Video Dates'}
        </button>

        {/* Jobs list */}
        <div style={{ borderTop: '1px solid #2e2e36', paddingTop: 16 }}>
          <div style={{ fontSize: 12, color: '#555', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 12 }}>
            Jobs
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {jobs?.map((job) => <JobCard key={job.id} job={job} />) ?? (
              <div style={{ color: '#555', fontSize: 13 }}>No jobs yet</div>
            )}
          </div>
        </div>

        </>}

        <style>{`@keyframes pulse { 0%,100%{opacity:1}50%{opacity:.4} }`}</style>
      </div>
    </>
  )
}
