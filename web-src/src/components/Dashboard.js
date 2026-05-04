import React, { useState, useEffect } from 'react'
import {
  Heading, View, Flex, Well, Text, ProgressCircle, Button,
  StatusLight, Divider, ActionButton
} from '@adobe/react-spectrum'
import { useNavigate } from 'react-router-dom'
import { fetchDashboard } from './actionInvoker'
import useSwrCache from './useSwrCache'
import Refresh from '@spectrum-icons/workflow/Refresh'
import Add from '@spectrum-icons/workflow/Add'

function Dashboard ({ runtime, ims }) {
  const navigate = useNavigate()

  // Single SWR cache for dashboard — masters array is now included in the dashboard response
  const dashSwr = useSwrCache('dashboard', () => fetchDashboard(ims).catch(() => ({})), { ttl: 2 * 60 * 1000 })

  const stats = dashSwr.data ? (dashSwr.data.dashboard || dashSwr.data) : null
  const files = stats?.masters || []
  const loading = dashSwr.loading && !dashSwr.data
  const error = dashSwr.error && !dashSwr.data ? dashSwr.error : null
  const isCached = !!dashSwr.data?._cached
  const cachedAt = dashSwr.data?._cachedAt || null
  const stale = dashSwr.stale

  async function refreshDashboard () {
    await dashSwr.refresh()
  }

  if (loading && !stats) {
    return (
      <View UNSAFE_className='mdm-page'>
        <div className='mdm-loading-state'>
          <ProgressCircle aria-label='Loading dashboard...' isIndeterminate size='L' />
          <Text marginTop='size-200'>Loading dashboard data...</Text>
        </div>
      </View>
    )
  }

  if (error) {
    return (
      <View UNSAFE_className='mdm-page'>
        <div className='mdm-empty-state'>
          <div className='mdm-empty-state__icon'>⚠</div>
          <Heading level={2}>Unable to load dashboard</Heading>
          <Text>{error}</Text>
          <Button variant='primary' marginTop='size-200' onPress={refreshDashboard}>Retry</Button>
        </div>
      </View>
    )
  }

  const dashboard = stats || {}
  const publicCount = files.filter(f => f.visibility === 'public').length
  const privateCount = files.filter(f => f.visibility === 'private').length
  const totalRecords = files.reduce((sum, f) => sum + (f.recordCount || 0), 0)
  const latestUpdate = files.length > 0
    ? files.reduce((latest, f) => {
        const ts = f.updatedAt ? new Date(f.updatedAt) : new Date(0)
        return ts > latest ? ts : latest
      }, new Date(0))
    : null

  return (
    <View UNSAFE_className='mdm-page'>
      {/* Page Header */}
      <Flex justifyContent='space-between' alignItems='center' marginBottom='size-400'>
        <View>
          <Heading level={1} UNSAFE_className='mdm-page__title'>Dashboard</Heading>
          <Text UNSAFE_className='mdm-page__subtitle'>
            Platform overview and key metrics
            {cachedAt && (
              <span style={{ marginLeft: 8, fontSize: '0.85em', opacity: 0.7 }}>
                {stale ? '\u23F3 Updating...' : isCached ? '\u26A1 Cached' : '\u2705 Live'}
                {' \u2022 '}
                {new Date(cachedAt).toLocaleTimeString()}
              </span>
            )}
          </Text>
        </View>
        <Flex gap='size-100'>
          <ActionButton onPress={refreshDashboard} isQuiet isDisabled={loading}>
            <Refresh />
            <Text>{loading ? 'Refreshing...' : 'Refresh'}</Text>
          </ActionButton>
          <Button variant='accent' onPress={() => navigate('/upload')}>
            <Add />
            <Text>Import Data</Text>
          </Button>
        </Flex>
      </Flex>

      {/* KPI Cards */}
      <div className='mdm-kpi-grid'>
        <KPICard
          title='Masters'
          value={files.length}
          subtitle={`${publicCount} public \u2022 ${privateCount} private`}
          color='blue'
        />
        <KPICard
          title='Total Records'
          value={totalRecords.toLocaleString()}
          subtitle='Across all masters'
          color='green'
        />
        <KPICard
          title='API Endpoints'
          value={publicCount}
          subtitle='Exposed via API Mesh'
          color='purple'
        />
        <KPICard
          title='Last Modified'
          value={latestUpdate ? latestUpdate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '\u2014'}
          subtitle={latestUpdate ? latestUpdate.toLocaleTimeString() : 'No data yet'}
          color='orange'
        />
      </div>

      {/* Master Health & Activity */}
      <div className='mdm-dashboard-grid'>
        {/* Entities Table */}
        <View UNSAFE_className='mdm-card'>
          <Flex justifyContent='space-between' alignItems='center' marginBottom='size-200'>
            <Heading level={3}>Master Overview</Heading>
            <Button variant='secondary' isQuiet onPress={() => navigate('/masters')}>
              <Text>View All</Text>
            </Button>
          </Flex>
          {files.length === 0 ? (
            <div className='mdm-empty-state mdm-empty-state--compact'>
              <Text>No masters registered yet. Import your first dataset to get started.</Text>
              <Button variant='primary' marginTop='size-100' onPress={() => navigate('/upload')}>
                Import First Dataset
              </Button>
            </div>
          ) : (
            <table className='mdm-table mdm-table--compact'>
              <thead>
                <tr>
                  <th>Master</th>
                  <th>Records</th>
                  <th>Visibility</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {files.slice(0, 8).map(file => (
                  <tr key={file.masterName || file.entityName} className='mdm-table__clickable-row' onClick={() => navigate(`/masters/${file.masterName || file.entityName}`)}>
                    <td>
                      <div className='mdm-entity-cell'>
                        <strong>{file.displayName}</strong>
                        <span className='mdm-entity-cell__sub'>{file.masterName || file.entityName}</span>
                      </div>
                    </td>
                    <td>{(file.recordCount || 0).toLocaleString()}</td>
                    <td>
                      <StatusLight variant={file.visibility === 'public' ? 'positive' : 'neutral'}>
                        {file.visibility}
                      </StatusLight>
                    </td>
                    <td>
                      <StatusLight variant='positive'>Active</StatusLight>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </View>

        {/* Quick Actions + System Health */}
        <View>
          <View UNSAFE_className='mdm-card' marginBottom='size-200'>
            <Heading level={3} marginBottom='size-200'>Quick Actions</Heading>
            <Flex direction='column' gap='size-100'>
              <Button variant='primary' width='100%' onPress={() => navigate('/upload')}>
                Import New Dataset
              </Button>
              <Button variant='secondary' width='100%' onPress={() => navigate('/api-console')}>
                Query Console
              </Button>
              <Button variant='secondary' width='100%' onPress={() => navigate('/audit')}>
                Activity Log
              </Button>
            </Flex>
          </View>

          <View UNSAFE_className='mdm-card'>
            <Heading level={3} marginBottom='size-200'>Platform Status</Heading>
            <Flex direction='column' gap='size-150'>
              <HealthItem label='Database' status='healthy' />
              <HealthItem label='API Mesh' status='healthy' />
              <HealthItem label='Authentication' status='healthy' />
              <HealthItem label='File Storage' status='healthy' />
            </Flex>
          </View>
        </View>
      </div>

      {/* Recent Activity */}
      <View UNSAFE_className='mdm-card'>
        <Heading level={3} marginBottom='size-200'>Recent Activity</Heading>
        {dashboard.recentLogs && dashboard.recentLogs.length > 0 ? (
          <div className='mdm-activity-timeline'>
            {dashboard.recentLogs.slice(0, 8).map((log, idx) => (
              <div key={idx} className='mdm-activity-timeline__item'>
                <div className={`mdm-activity-timeline__dot mdm-activity-timeline__dot--${log.status === 'success' ? 'success' : 'error'}`} />
                <div className='mdm-activity-timeline__content'>
                  <Text UNSAFE_className='mdm-activity-timeline__action'>
                    <strong>{log.operation}</strong> on <em>{log.masterName || log.entityName}</em>
                  </Text>
                  <Text UNSAFE_className='mdm-activity-timeline__meta'>
                    {log.user} • {log.timestamp ? new Date(log.timestamp).toLocaleString() : ''}
                  </Text>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Text UNSAFE_className='mdm-text-muted'>No recent activity to display.</Text>
        )}
      </View>
    </View>
  )
}

const KPICard = React.memo(function KPICard ({ title, value, subtitle, color }) {
  return (
    <View UNSAFE_className={`mdm-kpi-card mdm-kpi-card--${color}`}>
      <Text UNSAFE_className='mdm-kpi-card__title'>{title}</Text>
      <Text UNSAFE_className='mdm-kpi-card__value'>{value}</Text>
      <Text UNSAFE_className='mdm-kpi-card__subtitle'>{subtitle}</Text>
    </View>
  )
})

const HealthItem = React.memo(function HealthItem ({ label, status }) {
  const variants = {
    healthy: 'positive',
    degraded: 'notice',
    unhealthy: 'negative',
    inactive: 'neutral'
  }
  return (
    <Flex justifyContent='space-between' alignItems='center'>
      <Text>{label}</Text>
      <StatusLight variant={variants[status] || 'neutral'}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </StatusLight>
    </Flex>
  )
})

export default Dashboard
