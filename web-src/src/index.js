/* 
* <license header>
*/

import 'core-js/stable'
import 'regenerator-runtime/runtime'
import ReactDOM from 'react-dom'

import Runtime, { init } from '@adobe/exc-app'

import App from './components/App'
import { registerSession, deregisterSession } from './components/actionInvoker'
import './index.css'

window.React = require('react')
/* Here you can bootstrap your application and configure the integration with the Adobe Experience Cloud Shell */
try {
  // attempt to load the Experience Cloud Runtime
  require('./exc-runtime')
  // if there are no errors, bootstrap the app in the Experience Cloud Shell
  init(bootstrapInExcShell)
} catch (e) {
  console.log('application not running in Adobe Experience Cloud Shell')
  // fallback mode, run the application without the Experience Cloud Runtime
  bootstrapRaw()
}

function bootstrapRaw () {
  /* Standalone mode - use token from environment or local storage */
  const mockRuntime = { on: () => {} }

  // In standalone mode, attempt to get IMS token from:
  // 1. localStorage (set by developer via console or dev tooling)
  // 2. URL query param (for testing: ?imsToken=xxx&imsOrg=xxx)
  const urlParams = new URLSearchParams(window.location.search)
  const token = urlParams.get('imsToken') || localStorage.getItem('mdm_ims_token') || ''
  const org = urlParams.get('imsOrg') || localStorage.getItem('mdm_ims_org') || ''

  if (token) {
    localStorage.setItem('mdm_ims_token', token)
  }
  if (org) {
    localStorage.setItem('mdm_ims_org', org)
  }

  const mockIms = { token, org }

  if (!token) {
    console.warn('MDM: No IMS token found. Set via localStorage: localStorage.setItem("mdm_ims_token", "<your-token>") and reload.')
  }

  // render the actual react application and pass along the runtime object to make it available to the App
  ReactDOM.render(
    <App runtime={mockRuntime} ims={mockIms} />,
    document.getElementById('root')
  )
}

function bootstrapInExcShell () {
  // get the Experience Cloud Runtime object
  const runtime = Runtime()

  // use this to set a favicon
  // runtime.favicon = 'url-to-favicon'

  // use this to respond to clicks on the app-bar title
  // runtime.heroClick = () => window.alert('Did I ever tell you you\'re my hero?')

  // ready event brings in authentication/user info
  runtime.on('ready', ({ imsOrg, imsToken, imsProfile, locale }) => {
    // tell the exc-runtime object we are done
    runtime.done()
    console.log('Ready! received imsProfile:', imsProfile)
    const ims = {
      profile: imsProfile,
      org: imsOrg,
      token: imsToken
    }

    // Persist token to localStorage for use across navigations and fallback
    if (imsToken) {
      localStorage.setItem('mdm_ims_token', imsToken)
    }
    if (imsOrg) {
      localStorage.setItem('mdm_ims_org', imsOrg)
    }

    // Register user session — deferred to avoid competing with resolveCurrentUser
    // The resolve call is the critical path; session registration is fire-and-forget
    setTimeout(() => {
      registerSession(ims).then(() => {
        console.log('User session registered')
      }).catch(err => {
        console.warn('Session registration failed:', err.message)
      })
    }, 2000)

    // Clean up session on page unload / logout
    window.addEventListener('beforeunload', () => {
      deregisterSession(ims).catch(() => {})
    })

    // render the actual react application and pass along the runtime and ims objects to make it available to the App
    ReactDOM.render(
      <App runtime={runtime} ims={ims} />,
      document.getElementById('root')
    )
  })

  // set solution info, shortTitle is used when window is too small to display full title
  runtime.solution = {
    icon: 'AdobeExperienceCloud',
    title: 'DataHub — Enterprise Data Platform',
    shortTitle: 'DataHub'
  }
  runtime.title = 'DataHub'
}
