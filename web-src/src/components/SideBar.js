import React from 'react'
import { NavLink } from 'react-router-dom'
import { View, Text, Divider } from '@adobe/react-spectrum'
import Dashboard from '@spectrum-icons/workflow/Dashboard'
import FolderOpen from '@spectrum-icons/workflow/FolderOpen'
import FileAdd from '@spectrum-icons/workflow/FileAdd'
import Code from '@spectrum-icons/workflow/Code'
import Clock from '@spectrum-icons/workflow/Clock'
import Data from '@spectrum-icons/workflow/Data'
import Settings from '@spectrum-icons/workflow/Settings'
import Archive from '@spectrum-icons/workflow/Archive'
import Help from '@spectrum-icons/workflow/Help'
import GraphBarVertical from '@spectrum-icons/workflow/GraphBarVertical'
import UserGroup from '@spectrum-icons/workflow/UserGroup'
import LockClosed from '@spectrum-icons/workflow/LockClosed'
import { useApp } from './AppContext'

function SideBar ({ onNavigate }) {
  const { hasPermission, userLoading } = useApp()

  return (
    <View height='100%' UNSAFE_className='mdm-sidebar'>
      {/* Brand Header */}
      <div className='mdm-sidebar__brand'>
        <div className='mdm-sidebar__brand-icon'>
          <Data size='S' />
        </div>
        <div className='mdm-sidebar__brand-text'>
          <Text UNSAFE_className='mdm-sidebar__brand-title'>DataHub</Text>
          <Text UNSAFE_className='mdm-sidebar__brand-subtitle'>Enterprise Data Platform</Text>
        </div>
      </div>

      <Divider size='S' />

      {/* Navigation */}
      <nav className='mdm-sidebar__nav'>
        <div className='mdm-sidebar__section'>
          <span className='mdm-sidebar__section-label'>Overview</span>
          <ul className='SideNav'>
            {hasPermission('dashboard') && (
              <SideNavItem to='/' icon={<Dashboard size='S' />} label='Dashboard' end onNavigate={onNavigate} />
            )}
          </ul>
        </div>

        {(hasPermission('masters') || hasPermission('import_data') || hasPermission('record_management') || hasPermission('schema_management') || hasPermission('archive_management')) && (
          <div className='mdm-sidebar__section'>
            <span className='mdm-sidebar__section-label'>Data Management</span>
            <ul className='SideNav'>
              {(hasPermission('masters') || hasPermission('record_management') || hasPermission('schema_management') || hasPermission('archive_management')) && (
                <SideNavItem to='/masters' icon={<FolderOpen size='S' />} label='Masters' onNavigate={onNavigate} />
              )}
              {hasPermission('import_data') && (
                <SideNavItem to='/upload' icon={<FileAdd size='S' />} label='Import Data' onNavigate={onNavigate} />
              )}
            </ul>
          </div>
        )}

        {hasPermission('query_console') && (
          <div className='mdm-sidebar__section'>
            <span className='mdm-sidebar__section-label'>Tools</span>
            <ul className='SideNav'>
              <SideNavItem to='/api-console' icon={<Code size='S' />} label='Query Console' onNavigate={onNavigate} />
            </ul>
          </div>
        )}

        {(hasPermission('activity_log') || hasPermission('partners') || hasPermission('admin_console') || hasPermission('settings') || hasPermission('user_management')) && (
          <div className='mdm-sidebar__section'>
            <span className='mdm-sidebar__section-label'>Administration</span>
            <ul className='SideNav'>
              {hasPermission('activity_log') && (
                <SideNavItem to='/audit' icon={<Clock size='S' />} label='Activity Log' onNavigate={onNavigate} />
              )}
              {hasPermission('partners') && (
                <SideNavItem to='/partners' icon={<UserGroup size='S' />} label='Partners' onNavigate={onNavigate} />
              )}
              {hasPermission('admin_console') && (
                <SideNavItem to='/admin' icon={<GraphBarVertical size='S' />} label='Admin Console' onNavigate={onNavigate} />
              )}
              {hasPermission('settings') && (
                <SideNavItem to='/settings' icon={<Settings size='S' />} label='Settings' onNavigate={onNavigate} />
              )}
              {hasPermission('user_management') && (
                <SideNavItem to='/users' icon={<LockClosed size='S' />} label='Users & Roles' onNavigate={onNavigate} />
              )}
            </ul>
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className='mdm-sidebar__footer'>
        <Divider size='S' />
        <div className='mdm-sidebar__env-badge'>
          <span className='mdm-sidebar__env-dot' />
          <Text UNSAFE_className='mdm-sidebar__env-text'>Connected</Text>
        </div>
        <Text UNSAFE_className='mdm-sidebar__version-text'>v2.0.0</Text>
      </div>
    </View>
  )
}

function SideNavItem ({ to, icon, label, end, onNavigate }) {
  return (
    <li className='SideNav-item'>
      <NavLink
        className={({ isActive }) => `SideNav-itemLink ${isActive ? 'is-selected' : ''}`}
        to={to}
        end={end}
        onClick={onNavigate}
      >
        <span className='SideNav-itemIcon'>{icon}</span>
        <span className='SideNav-itemLabel'>{label}</span>
      </NavLink>
    </li>
  )
}

export default SideBar
