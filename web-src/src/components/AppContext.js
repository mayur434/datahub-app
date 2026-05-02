import React, { createContext, useContext } from 'react'

const AppContext = createContext({ runtime: null, ims: null })

export function AppProvider ({ runtime, ims, children }) {
  return (
    <AppContext.Provider value={{ runtime, ims }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp () {
  return useContext(AppContext)
}
