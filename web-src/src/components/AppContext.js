import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { resolveCurrentUser } from './actionInvoker'

const AppContext = createContext({ runtime: null, ims: null, userRole: null, permissions: {}, userLoading: true, userError: null, appSettings: {}, refetchUser: () => {} })

export function AppProvider ({ runtime, ims, children }) {
  const [userRole, setUserRole] = useState(null)
  const [permissions, setPermissions] = useState({})
  const [userInfo, setUserInfo] = useState(null)
  const [userLoading, setUserLoading] = useState(true)
  const [userError, setUserError] = useState(null)
  const [appSettings, setAppSettings] = useState({})

  const fetchUser = useCallback(async () => {
    if (!ims || !ims.token) {
      setUserLoading(false)
      return
    }
    try {
      setUserLoading(true)
      setUserError(null)
      const result = await resolveCurrentUser(ims)
      if (result.authorized) {
        setUserRole(result.roleName)
        setPermissions(result.permissions || {})
        setUserInfo({ email: result.email, firstName: result.firstName, lastName: result.lastName, roleId: result.roleId })
        if (result.appSettings) setAppSettings(result.appSettings)
      } else {
        setUserRole(null)
        setPermissions({})
        setUserInfo(null)
        setUserError(result.reason || 'Access denied')
      }
    } catch (e) {
      console.error('Failed to resolve user permissions:', e)
      setUserError('Failed to load user permissions. Please reload.')
    } finally {
      setUserLoading(false)
    }
  }, [ims])

  useEffect(() => {
    fetchUser()
  }, [fetchUser])

  /**
   * Check if current user has a specific feature permission.
   */
  function hasPermission (featureKey) {
    if (!permissions || !userRole) return false
    return permissions[featureKey] === true
  }

  return (
    <AppContext.Provider value={{ runtime, ims, userRole, permissions, userInfo, userLoading, userError, appSettings, hasPermission, refetchUser: fetchUser }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp () {
  return useContext(AppContext)
}
