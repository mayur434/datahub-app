import React from 'react'
import { Flex, Text, ActionButton, View, Tooltip, TooltipTrigger } from '@adobe/react-spectrum'
import { useLocation, useNavigate } from 'react-router-dom'
import Bell from '@spectrum-icons/workflow/Bell'
import Settings from '@spectrum-icons/workflow/Settings'
import User from '@spectrum-icons/workflow/User'
import Help from '@spectrum-icons/workflow/Help'
import Light from '@spectrum-icons/workflow/Light'
import Moon from '@spectrum-icons/workflow/Moon'

import ShowMenu from '@spectrum-icons/workflow/ShowMenu'
import { useTheme } from './ThemeProvider'

function HeaderBar ({ ims, onToggleSidebar, isMobile }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()

  function getBreadcrumbs () {
    const path = location.pathname
    const parts = path.split('/').filter(Boolean)
    const crumbs = [{ label: 'Home', path: '/' }]

    if (parts[0] === 'files') {
      crumbs.push({ label: 'Entities', path: '/files' })
      if (parts[1]) {
        crumbs.push({ label: decodeURIComponent(parts[1]), path: `/files/${parts[1]}` })
        if (parts[2] === 'records') crumbs.push({ label: 'Records', path: null })
        else if (parts[2] === 'schema') crumbs.push({ label: 'Schema', path: null })
        else if (parts[2] === 'versions') crumbs.push({ label: 'Versions', path: null })
        else if (parts[2] === 'archives') crumbs.push({ label: 'Archives', path: null })
      }
    } else if (parts[0] === 'upload') {
      crumbs.push({ label: 'Import Data', path: null })
    } else if (parts[0] === 'api-console') {
      crumbs.push({ label: 'Query Console', path: null })
    } else if (parts[0] === 'audit') {
      crumbs.push({ label: 'Activity Log', path: null })
    } else if (parts[0] === 'settings') {
      crumbs.push({ label: 'Settings', path: null })
    }

    return crumbs
  }

  const crumbs = getBreadcrumbs()
  const userName = ims?.profile?.name || ims?.profile?.email || 'Administrator'
  const userInitials = userName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()

  return (
    <View
      paddingX='size-300'
      paddingY='size-150'
      borderBottomWidth='thin'
      borderBottomColor='gray-300'
      backgroundColor='gray-50'
      UNSAFE_className='mdm-header'
    >
      <Flex justifyContent='space-between' alignItems='center'>
        <Flex alignItems='center' gap='size-100'>
          {/* Mobile hamburger toggle */}
          {isMobile && (
            <ActionButton isQuiet aria-label='Toggle navigation' onPress={onToggleSidebar} UNSAFE_className='mdm-hamburger-btn'>
              <ShowMenu />
            </ActionButton>
          )}
          {/* Breadcrumbs */}
          <nav className='mdm-breadcrumbs' aria-label='Breadcrumb'>
          {crumbs.map((crumb, idx) => (
            <React.Fragment key={idx}>
              {idx > 0 && <span className='mdm-breadcrumbs__separator'>/</span>}
              {crumb.path ? (
                <button className='mdm-breadcrumbs__link' onClick={() => navigate(crumb.path)}>
                  {crumb.label}
                </button>
              ) : (
                <span className='mdm-breadcrumbs__current'>{crumb.label}</span>
              )}
            </React.Fragment>
          ))}
        </nav>
        </Flex>

        {/* Right side: user info & actions */}
        <Flex alignItems='center' gap='size-100'>
          <TooltipTrigger>
            <ActionButton isQuiet aria-label='Help & Documentation'>
              <Help />
            </ActionButton>
            <Tooltip>Documentation</Tooltip>
          </TooltipTrigger>
          <TooltipTrigger>
            <ActionButton isQuiet aria-label='Settings' onPress={() => navigate('/settings')}>
              <Settings />
            </ActionButton>
            <Tooltip>Settings</Tooltip>
          </TooltipTrigger>
          <TooltipTrigger>
            <button
              className='mdm-theme-toggle'
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Light size='S' /> : <Moon size='S' />}
            </button>
            <Tooltip>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</Tooltip>
          </TooltipTrigger>
          <View
            UNSAFE_className='mdm-header__user-badge'
          >
            <Flex alignItems='center' gap='size-100'>
              <div className='mdm-header__avatar'>{userInitials}</div>
              <Text UNSAFE_style={{ fontSize: '12px', fontWeight: 500 }}>
                {userName}
              </Text>
            </Flex>
          </View>
        </Flex>
      </Flex>
    </View>
  )
}

export default HeaderBar
