import React, { Suspense, lazy } from 'react'
import { Provider, defaultTheme, Grid, View, Heading, Text, Button, ProgressCircle } from '@adobe/react-spectrum'
import ErrorBoundary from 'react-error-boundary'
import { HashRouter as Router, Routes, Route, useNavigate } from 'react-router-dom'
import { NotificationProvider } from './NotificationProvider'
import { AppProvider } from './AppContext'
import SideBar from './SideBar'
import HeaderBar from './HeaderBar'

// Lazy-loaded route components
const Dashboard = lazy(() => import('./Dashboard'))
const FileList = lazy(() => import('./FileList'))
const FileUpload = lazy(() => import('./FileUpload'))
const FileDetail = lazy(() => import('./FileDetail'))
const QueryConsole = lazy(() => import('./QueryConsole'))
const SchemaManager = lazy(() => import('./SchemaManager'))
const VersionManager = lazy(() => import('./VersionManager'))
const AuditLogs = lazy(() => import('./AuditLogs'))
const RecordManager = lazy(() => import('./RecordManager'))
const AppSettings = lazy(() => import('./AppSettings'))
const ArchiveManager = lazy(() => import('./ArchiveManager'))
const AdminConsole = lazy(() => import('./AdminConsole'))
const PartnerConsole = lazy(() => import('./PartnerConsole'))

function RouteLoading () {
  return (
    <View padding='size-400'>
      <ProgressCircle aria-label='Loading...' isIndeterminate size='L' />
    </View>
  )
}

function App (props) {
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
              <Grid
                areas={[
                  'sidebar header',
                  'sidebar content'
                ]}
                columns={['260px', '1fr']}
                rows={['auto', '1fr']}
                height='100vh'
                gap='size-0'
              >
                <View
                  gridArea='sidebar'
                  backgroundColor='gray-50'
                  borderEndWidth='thin'
                  borderEndColor='gray-200'
                  overflow='auto'
                  UNSAFE_className='mdm-sidebar-container'
                >
                  <SideBar />
                </View>
                <View gridArea='header'>
                  <HeaderBar ims={props.ims} />
                </View>
                <View gridArea='content' padding='size-400' overflow='auto' UNSAFE_className='mdm-main-content'>
                  <Suspense fallback={<RouteLoading />}>
                    <Routes>
                      <Route path='/' element={<Dashboard runtime={props.runtime} ims={props.ims} />} />
                      <Route path='/masters' element={<FileList runtime={props.runtime} ims={props.ims} />} />
                      <Route path='/upload' element={<FileUpload runtime={props.runtime} ims={props.ims} />} />
                      <Route path='/masters/:master' element={<FileDetail runtime={props.runtime} ims={props.ims} />} />
                      <Route path='/masters/:master/records' element={<RecordManager runtime={props.runtime} ims={props.ims} />} />
                      <Route path='/masters/:master/schema' element={<SchemaManager runtime={props.runtime} ims={props.ims} />} />
                      <Route path='/masters/:master/versions' element={<VersionManager runtime={props.runtime} ims={props.ims} />} />
                      <Route path='/masters/:master/archives' element={<ArchiveManager runtime={props.runtime} ims={props.ims} />} />
                      <Route path='/api-console' element={<QueryConsole runtime={props.runtime} ims={props.ims} />} />
                      <Route path='/audit' element={<AuditLogs runtime={props.runtime} ims={props.ims} />} />
                      <Route path='/settings' element={<AppSettings runtime={props.runtime} ims={props.ims} />} />
                      <Route path='/admin' element={<AdminConsole runtime={props.runtime} ims={props.ims} />} />
                      <Route path='/partners' element={<PartnerConsole runtime={props.runtime} ims={props.ims} />} />
                      <Route path='*' element={<NotFound />} />
                    </Routes>
                  </Suspense>
                </View>
              </Grid>
            </NotificationProvider>
          </AppProvider>
        </Provider>
      </Router>
    </ErrorBoundary>
  )
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
