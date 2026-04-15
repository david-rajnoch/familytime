import { createHashRouter, RouterProvider, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PeopleGrid } from './pages/PeopleGrid'
import { PersonDetail } from './pages/PersonDetail'
import { UnknownFaces } from './pages/UnknownFaces'
import { MediaViewer } from './components/MediaViewer'
import { IndexingDrawer } from './components/IndexingDrawer'
import { PersonMergeModal } from './components/PersonMergeModal'
import { useUIStore } from './store/ui'
import { useJobs } from './api/indexing'

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 60_000, gcTime: 5 * 60_000 } },
})

function Nav() {
  const navigate = useNavigate()
  const location = useLocation()
  const setDrawerOpen = useUIStore((s) => s.setDrawerOpen)
  const { data: jobs } = useJobs()
  const activeJobs = jobs?.filter((j) => j.status === 'running' || j.status === 'clustering') ?? []

  const page = location.pathname.startsWith('/unknown') ? 'unknown' : 'people'

  return (
    <nav style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '0 24px',
      height: 56, background: '#1a1a1f', borderBottom: '1px solid #2e2e36',
      position: 'sticky', top: 0, zIndex: 100, flexShrink: 0,
    }}>
      <div
        onClick={() => navigate('/')}
        style={{ fontWeight: 700, fontSize: 18, letterSpacing: -0.5, cursor: 'pointer', userSelect: 'none' }}
      >
        Family<span style={{ color: '#7c6af7' }}>Time</span>
      </div>

      <div style={{ display: 'flex', gap: 4, marginLeft: 24 }}>
        {[
          { id: 'people' as const, label: 'People', path: '/' },
          { id: 'unknown' as const, label: 'Unknown Faces', path: '/unknown' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => navigate(t.path)}
            style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 14, cursor: 'pointer', border: 'none',
              background: page === t.id ? '#242429' : 'transparent',
              color: page === t.id ? '#e8e8f0' : '#888',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1 }} />

      {activeJobs.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#7c6af7' }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', background: '#7c6af7',
            display: 'inline-block', animation: 'pulse 1.2s infinite',
          }} />
          Indexing… ({activeJobs.length})
        </div>
      )}

      <button
        onClick={() => setDrawerOpen(true)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '7px 16px',
          background: '#7c6af7', color: '#fff', border: 'none', borderRadius: 8,
          fontSize: 14, fontWeight: 500, cursor: 'pointer',
        }}
      >
        + Index Drive
      </button>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:.4} }
        button:focus { outline: none; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif; }
        input:focus { outline: none; }
        select:focus { outline: none; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #0f0f11; }
        ::-webkit-scrollbar-thumb { background: #2e2e36; border-radius: 3px; }
      `}</style>
    </nav>
  )
}

function Layout() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100vh',
      background: '#0f0f11', color: '#e8e8f0', overflow: 'hidden',
    }}>
      <Nav />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <Outlet />
      </div>
      <MediaViewer />
      <IndexingDrawer />
      <PersonMergeModal />
    </div>
  )
}

const router = createHashRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <PeopleGrid /> },
      { path: 'person/:personId', element: <PersonDetail /> },
      { path: 'unknown', element: <UnknownFaces /> },
    ],
  },
])

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
