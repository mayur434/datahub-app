import React, { createContext, useContext, useState, useCallback } from 'react'

const NotificationContext = createContext(null)

let idCounter = 0

export function NotificationProvider ({ children }) {
  const [notifications, setNotifications] = useState([])

  const addNotification = useCallback((message, variant = 'info', duration = 5000) => {
    const id = ++idCounter
    setNotifications(prev => [...prev, { id, message, variant, duration }])
    if (duration > 0) {
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== id))
      }, duration)
    }
    return id
  }, [])

  const removeNotification = useCallback((id) => {
    setNotifications(prev => prev.filter(n => n.id !== id))
  }, [])

  const notify = {
    success: (msg, dur) => addNotification(msg, 'positive', dur),
    error: (msg, dur) => addNotification(msg, 'negative', dur || 8000),
    info: (msg, dur) => addNotification(msg, 'info', dur),
    warning: (msg, dur) => addNotification(msg, 'notice', dur || 6000)
  }

  return (
    <NotificationContext.Provider value={notify}>
      {children}
      {/* Toast Container */}
      <div className='mdm-toast-container'>
        {notifications.map(n => (
          <div key={n.id} className={`mdm-toast mdm-toast--${n.variant}`}>
            <span className='mdm-toast__icon'>
              {n.variant === 'positive' && '✓'}
              {n.variant === 'negative' && '✕'}
              {n.variant === 'info' && 'ℹ'}
              {n.variant === 'notice' && '⚠'}
            </span>
            <span className='mdm-toast__message'>{n.message}</span>
            <button className='mdm-toast__close' onClick={() => removeNotification(n.id)}>×</button>
          </div>
        ))}
      </div>
    </NotificationContext.Provider>
  )
}

export function useNotifications () {
  const ctx = useContext(NotificationContext)
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider')
  return ctx
}
