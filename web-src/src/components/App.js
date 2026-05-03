import React, { Suspense, lazy, useState, useCallback, useEffect } from 'react'
import { Provider, defaultTheme, View, Heading, Text, Button, ProgressCircle, IllustratedMessage } from '@adobe/react-spectrum'
import ErrorBoundary from 'react-error-boundary'
import { HashRouter as Router, Routes, Route, useNavigate, Navigate } from 'react-router-dom'
import { NotificationProvider } from './NotificationProvider'
import { AppProvider, useApp } from './AppContext'
import SideBar from './SideBar'
import HeaderBar from './HeaderBar'

// Lazy-loaded route components
const Dashboard = lazy(() => import('./Dashboard'))
const FileList = lazy(() => import('./FileList'))
const FileUpload = lazy(() => import('./FileUpload'))
const FileDetail = lazy(() => import('./FileDetail'))
const QueryConsole = lazy(() => import('./QueryConsole'))
const SchemaManager = lazy(() => import('./SchemaManager'))
const AuditLogs = lazy(() => import('./AuditLogs'))
const RecordManager = lazy(() => import('./RecordManager'))
const AppSettings = lazy(() => import('./AppSettings'))
const ArchiveManager = lazy(() => import('./ArchiveManager'))
const AdminConsole = lazy(() => import('./AdminConsole'))
const PartnerConsole = lazy(() => import('./PartnerConsole'))
const UserManagement = lazy(() => import('./UserManagement'))

function RouteLoading () {
  return (
    <View padding='size-400'>
      <ProgressCircle aria-label='Loading...' isIndeterminate size='L' />
    </View>
  )
}

function App (props) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)

  useEffect(() => {
    const onResize = () => {
      const mobile = window.innerWidth < 768
      setIsMobile(mobile)
      if (!mobile) setSidebarOpen(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const toggleSidebar = useCallback(() => setSidebarOpen(prev => !prev), [])
  const closeSidebar = useCallback(() => setSidebarOpen(false), [])

  props.runtime.on('configuration', ({ imsOrg, imsToken, locale }) => {
    // configuration change handler
  })
  props.runtime.on('history', ({ type, path }) => {
    // history change handler
  })

  return (
    <ErrorBoundary onError={onError} FallbackComponent={fallbackComponent}>
      <Router>
        <Provider theme={defaultTheme} colorScheme='light'>
          <AppProvider runtime={props.runtime} ims={props.ims}>
            <NotificationProvider>
              <AppShell runtime={props.runtime} ims={props.ims} isMobile={isMobile} sidebarOpen={sidebarOpen} closeSidebar={closeSidebar} toggleSidebar={toggleSidebar} />
            </NotificationProvider>
          </AppProvider>
        </Provider>
      </Router>
    </ErrorBoundary>
  )
}

/**
 * Inner shell component — can use useApp() because it's inside AppProvider.
 */
function AppShell ({ runtime, ims, isMobile, sidebarOpen, closeSidebar, toggleSidebar }) {
  const { userLoading, userError, hasPermission, permissions } = useApp()

  // Show loading while resolving user permissions
  if (userLoading) {
    return (
      <View padding='size-600' UNSAFE_style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <ProgressCircle aria-label='Loading user permissions...' isIndeterminate size='L' />
        <Text marginTop='size-200'>Loading your permissions...</Text>
      </View>
    )
  }

  // Show access denied if user is not authorized
  if (userError) {
    return (
      <View padding='size-600' UNSAFE_style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', textAlign: 'center' }}>
        <Heading level={1}>Access Denied</Heading>
        <Text marginTop='size-200'>{userError}</Text>
        <Text marginTop='size-100' UNSAFE_style={{ color: '#6e6e6e', fontSize: '14px' }}>
          If you believe this is an error, contact your application administrator.
        </Text>
        <Button variant='accent' marginTop='size-300' onPress={() => window.location.reload()}>
          Retry
        </Button>
      </View>
    )
  }

  // Determine first available route for the user (for fallback redirect)
  function getDefaultRoute () {
    if (hasPermission('dashboard')) return '/'
    if (hasPermission('masters') || hasPermission('record_management') || hasPermission('schema_management') || hasPermission('archive_management')) return '/masters'
    if (hasPermission('import_data')) return '/upload'
    if (hasPermission('query_console')) return '/api-console'
    return '/'
  }

  return (
    <div className='mdm-app-shell'>
      {/* Mobile backdrop */}
      {isMobile && (
        <div
          className={`mdm-sidebar-backdrop ${sidebarOpen ? 'mdm-sidebar-backdrop--visible' : ''}`}
          onClick={closeSidebar}
        />
      )}

      {/* Sidebar */}
      <div className={`mdm-sidebar-container ${isMobile && sidebarOpen ? 'mdm-sidebar--open' : ''}`}>
        <SideBar onNavigate={isMobile ? closeSidebar : undefined} />
      </div>

      {/* Main area: header + content */}
      <div className='mdm-main-area'>
        <HeaderBar ims={ims} onToggleSidebar={toggleSidebar} isMobile={isMobile} />
        <div className='mdm-main-content'>
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path='/' element={<ProtectedRoute feature='dashboard'><Dashboard runtime={runtime} ims={ims} /></ProtectedRoute>} />
              <Route path='/masters' element={<ProtectedRoute feature={['masters', 'import_data', 'record_management', 'schema_management', 'archive_management']}><FileList runtime={runtime} ims={ims} /></ProtectedRoute>} />
              <Route path='/upload' element={<ProtectedRoute feature='import_data'><FileUpload runtime={runtime} ims={ims} /></ProtectedRoute>} />
              <Route path='/masters/:master' element={<ProtectedRoute feature={['masters', 'import_data', 'record_management', 'schema_management', 'archive_management']}><FileDetail runtime={runtime} ims={ims} /></ProtectedRoute>} />
              <Route path='/masters/:master/records' element={<ProtectedRoute feature={['masters', 'record_management']}><RecordManager runtime={runtime} ims={ims} /></ProtectedRoute>} />
              <Route path='/masters/:master/schema' element={<ProtectedRoute feature={['masters', 'schema_management']}><SchemaManager runtime={runtime} ims={ims} /></ProtectedRoute>} />
              <Route path='/masters/:master/archives' element={<ProtectedRoute feature={['masters', 'archive_management']}><ArchiveManager runtime={runtime} ims={ims} /></ProtectedRoute>} />
              <Route path='/api-console' element={<ProtectedRoute feature='query_console'><QueryConsole runtime={runtime} ims={ims} /></ProtectedRoute>} />
              <Route path='/audit' element={<ProtectedRoute feature='activity_log'><AuditLogs runtime={runtime} ims={ims} /></ProtectedRoute>} />
              <Route path='/settings' element={<ProtectedRoute feature='settings'><AppSettings runtime={runtime} ims={ims} /></ProtectedRoute>} />
              <Route path='/admin' element={<ProtectedRoute feature='admin_console'><AdminConsole runtime={runtime} ims={ims} /></ProtectedRoute>} />
              <Route path='/partners' element={<ProtectedRoute feature='partners'><PartnerConsole runtime={runtime} ims={ims} /></ProtectedRoute>} />
              <Route path='/users' element={<ProtectedRoute feature='user_management'><UserManagement runtime={runtime} ims={ims} /></ProtectedRoute>} />
              <Route path='*' element={<NotFound />} />
            </Routes>
          </Suspense>
        </div>
      </div>
    </div>
  )
}

/**
 * Route guard — checks if the current user has the required feature permission.
 * Redirects to access-denied view if not.
 */
function ProtectedRoute ({ feature, children }) {
  const { hasPermission, userLoading } = useApp()

  if (userLoading) return <RouteLoading />

  // Support single feature string or array of features (OR logic)
  const features = Array.isArray(feature) ? feature : [feature]
  const allowed = features.some(f => hasPermission(f))

  if (!allowed) {
    return (
      <View UNSAFE_className='mdm-page'>
        <div className='mdm-empty-state'>
          <div className='mdm-empty-state__icon'>403</div>
          <Heading level={2}>Access Denied</Heading>
          <Text>You do not have permission to access this feature.</Text>
          <Text UNSAFE_style={{ color: '#6e6e6e', fontSize: '13px', marginTop: '8px' }}>
            Contact your administrator to request access.
          </Text>
        </div>
      </View>
    )
  }

  return children
}

function onError (e, componentStack) {
  console.error(e, componentStack)
}

function fallbackComponent ({ componentStack, error }) {
  return (
    <div className='mdm-error-fallback'>
      <div className='mdm-error-fallback__icon'>⚠</div>
      <h1>Something went wrong</h1>
      <p>DataHub encountered an unexpected error. Please reload the page to continue.</p>
      <details open>
        <summary>Error Details</summary>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '300px', overflow: 'auto', background: '#1a1a2e', color: '#e94560', padding: '12px', borderRadius: '6px', fontSize: '12px' }}>
{error.message}

Stack Trace:
{error.stack}

Component:
{componentStack}
        </pre>
      </details>
      <button onClick={() => window.location.reload()}>Reload Application</button>
    </div>
  )
}

function NotFound () {
  const navigate = useNavigate()
  return (
    <View UNSAFE_className='mdm-page'>
      <div className='mdm-empty-state'>
        <div className='mdm-empty-state__icon'>404</div>
        <Heading level={2}>Page Not Found</Heading>
        <Text>The page you are looking for does not exist or has been moved.</Text>
        <Button variant='accent' marginTop='size-200' onPress={() => navigate('/')}>
          Go to Dashboard
        </Button>
      </div>
    </View>
  )
}

export default App
