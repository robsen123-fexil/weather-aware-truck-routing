import { useEffect } from 'react'
import { ensureApiAwake } from './api/client'
import { Dashboard } from './pages/Dashboard'

export default function App() {
  // Kick free-tier Render awake as soon as the page loads.
  useEffect(() => {
    void ensureApiAwake().catch(() => {
      /* first user action will retry */
    })
  }, [])

  return <Dashboard />
}
