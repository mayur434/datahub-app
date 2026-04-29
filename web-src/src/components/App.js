import React from 'react'
import { Provider, defaultTheme, Grid, View, Heading, Text, Button } from '@adobe/react-spectrum'
import ErrorBoundary from 'react-error-boundary'
import { HashRouter as Router, Routes, Route, useNavigate } from 'react-router-dom'
import { NotificationProvider } from './NotificationProvider'
import SideBar from './SideBar'
import HeaderBar from './HeaderBar'
import Dashboard from './Dashboard'
import FileList from './FileList'
import FileUpload from './FileUpload'
import FileDetail from './FileDetail'
import QueryConsole from './QueryConsole'
import SchemaManager from './SchemaManager'
import VersionManager from './VersionManager'
import AuditLogs from './AuditLogs'
import RecordManager from './RecordManager'
import AppSettings from './AppSettings'
import ArchiveManager from './ArchiveManager'

function App (props) {
  console.log('runtime object:', props.runtime)
  console.log('ims object:', props.ims)

  props.runtime.on('configuration', ({ imsOrg, imsToken, locale }) => {
    console.log('configuration change', { imsOrg, imsToken, locale })
  })
  props.runtime.on('history', ({ type, path }) => {
    console.log('history change', { type, path })
  })

  return (
    <ErrorBoundary onError={onError} FallbackComponent={fallbackComponent}>
      <Router>
        <Provider theme={defaultTheme} colorScheme='light'>
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
                <Routes>
                  <Route path='/' element={<Dashboard runtime={props.runtime} ims={props.ims} />} />
                  <Route path='/files' element={<FileList runtime={props.runtime} ims={props.ims} />} />
                  <Route path='/upload' element={<FileUpload runtime={props.runtime} ims={props.ims} />} />
                  <Route path='/files/:entity' element={<FileDetail runtime={props.runtime} ims={props.ims} />} />
                  <Route path='/files/:entity/records' element={<RecordManager runtime={props.runtime} ims={props.ims} />} />
                  <Route path='/files/:entity/schema' element={<SchemaManager runtime={props.runtime} ims={props.ims} />} />
                  <Route path='/files/:entity/versions' element={<VersionManager runtime={props.runtime} ims={props.ims} />} />
                  <Route path='/files/:entity/archives' element={<ArchiveManager runtime={props.runtime} ims={props.ims} />} />
                  <Route path='/api-console' element={<QueryConsole runtime={props.runtime} ims={props.ims} />} />
                  <Route path='/audit' element={<AuditLogs runtime={props.runtime} ims={props.ims} />} />
                  <Route path='/settings' element={<AppSettings runtime={props.runtime} ims={props.ims} />} />
                  <Route path='*' element={<NotFound />} />
                </Routes>
              </View>
            </Grid>
          </NotificationProvider>
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
      <details>
        <summary>Technical Details</summary>
        <pre>{error.message}{'\n'}{componentStack}</pre>
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
