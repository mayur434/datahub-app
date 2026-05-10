import React, { useState, useEffect, useMemo } from 'react'
import {
  Heading, View, Flex, Button, Text, ProgressCircle, Well, Divider,
  Item, StatusLight, ActionButton, Tabs, TabList, TabPanels
} from '@adobe/react-spectrum'
import { fetchInfraMetrics } from './actionInvoker'
import { useNotifications } from './NotificationProvider'
import useSwrCache from './useSwrCache'
import Refresh from '@spectrum-icons/workflow/Refresh'
import Alert from '@spectrum-icons/workflow/Alert'
import Data from '@spectrum-icons/workflow/Data'

function AdminConsole ({ runtime, ims }) {
  const notify = useNotifications()

  // SWR cache for ALL metrics — single API call, all tabs served from state
  const allSwr = useSwrCache('admin-all', () => fetchInfraMetrics('all', {}, ims), { ttl: 2 * 60 * 1000 })

  const [allMetrics, setAllMetrics] = useState(allSwr.data || null)
  const [loading, setLoading] = useState(!allSwr.data)
  const [refreshing, setRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  const [error, setError] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [isCached, setIsCached] = useState(false)

  // Derived state — no extra API calls needed
  const overview = allMetrics
  const failures = allMetrics?.failures || null
  const analytics = allMetrics?.analytics || null

  // Sync SWR data into local state
  useEffect(() => {
    if (allSwr.data) {
      setAllMetrics(allSwr.data)
      setIsCached(!!allSwr.data._cached)
      setLastRefresh(allSwr.data._cachedAt ? new Date(allSwr.data._cachedAt) : new Date())
      setLoading(false)
      setError(null)
    }
    if (allSwr.error && !allSwr.data) setError(allSwr.error)
  }, [allSwr.data, allSwr.error])

  async function refreshMetrics () {
    try {
      setRefreshing(true)
      const result = await fetchInfraMetrics('all', { forceRefresh: true }, ims)
      setAllMetrics(result)
      setIsCached(false)
      setLastRefresh(new Date())
      setError(null)
      notify.success('Metrics refreshed with live data')
    } catch (e) {
      notify.error(`Failed to refresh metrics: ${e.message}`)
    } finally {
      setRefreshing(false)
    }
  }



  function handleTabChange (key) {
    setActiveTab(key)
  }

  if (loading && !overview) {
    return (
      <View UNSAFE_className='mdm-page'>
        <div className='mdm-loading-state'>
          <ProgressCircle aria-label='Loading admin console...' isIndeterminate size='L' />
          <Text marginTop='size-200'>Loading infrastructure metrics...</Text>
        </div>
      </View>
    )
  }

  if (error && !overview) {
    return (
      <View UNSAFE_className='mdm-page'>
        <div className='mdm-empty-state'>
          <div className='mdm-empty-state__icon'>⚠</div>
          <Heading level={2}>Failed to load admin console</Heading>
          <Text>{error}</Text>
          <Button variant='primary' marginTop='size-200' onPress={refreshMetrics}>Retry</Button>
        </div>
      </View>
    )
  }

  return (
    <View UNSAFE_className='mdm-page'>
      {/* Header */}
      <Flex justifyContent='space-between' alignItems='center' marginBottom='size-400'>
        <View>
          <Flex alignItems='center' gap='size-150'>
            <Data size='L' />
            <Heading level={1} UNSAFE_className='mdm-page__title'>Admin Console</Heading>
          </Flex>
          <Text UNSAFE_className='mdm-page__subtitle'>
            Infrastructure metrics, usage analytics &amp; guardrails
            {lastRefresh && ` • ${isCached ? 'Cached' : 'Live'} data from ${lastRefresh.toLocaleTimeString()}`}
          </Text>
          {isCached && (
            <Text UNSAFE_style={{ fontSize: '11px', color: '#e68619', marginTop: '2px' }}>
              Showing cached metrics for fast loading. Click "Refresh Metrics" for real-time data.
            </Text>
          )}
        </View>
        <Flex gap='size-100' alignItems='center'>
          {refreshing && <ProgressCircle aria-label='Refreshing...' isIndeterminate size='S' />}
          <Button variant='primary' onPress={refreshMetrics} isDisabled={refreshing}>
            <Refresh />
            <Text>{refreshing ? 'Computing...' : 'Refresh Metrics'}</Text>
          </Button>
        </Flex>
      </Flex>

      {/* Health badges */}
      {overview?.health && (
        <Flex gap='size-200' marginBottom='size-300' wrap>
          <HealthBadge label='Database' status={overview.health.database} />
          <HealthBadge label='Guardrails' status={overview.health.guardrails} />
          <HealthBadge label='Operations' status={overview.health.operations} />
          <HealthBadge label='API Mesh' status={overview.health.apiMesh} />
        </Flex>
      )}

      <Tabs selectedKey={activeTab} onSelectionChange={handleTabChange}>
        <TabList>
          <Item key='overview'>Overview</Item>
          <Item key='storage'>Storage</Item>
          <Item key='guardrails'>Guardrails</Item>
          <Item key='failures'>Failure Reports</Item>
          <Item key='analytics'>Analytics</Item>
          <Item key='usage'>Usage</Item>
          <Item key='config'>Configuration</Item>
        </TabList>
        <TabPanels>
          {/* ====== OVERVIEW TAB ====== */}
          <Item key='overview'>
            <View paddingTop='size-300'>
              <OverviewTab overview={overview} />
            </View>
          </Item>

          {/* ====== STORAGE TAB ====== */}
          <Item key='storage'>
            <View paddingTop='size-300'>
              <StorageTab storage={overview?.storage} />
            </View>
          </Item>

          {/* ====== GUARDRAILS TAB ====== */}
          <Item key='guardrails'>
            <View paddingTop='size-300'>
              <GuardrailsTab guardrails={overview?.guardrails} />
            </View>
          </Item>

          {/* ====== FAILURES TAB ====== */}
          <Item key='failures'>
            <View paddingTop='size-300'>
              <FailuresTab
                failures={failures}
              />
            </View>
          </Item>

          {/* ====== ANALYTICS TAB ====== */}
          <Item key='analytics'>
            <View paddingTop='size-300'>
              <AnalyticsTab
                analytics={analytics}
              />
            </View>
          </Item>

          {/* ====== USAGE TAB ====== */}
          <Item key='usage'>
            <View paddingTop='size-300'>
              <UsageTab usage={overview?.usage} />
            </View>
          </Item>

          {/* ====== CONFIG TAB ====== */}
          <Item key='config'>
            <View paddingTop='size-300'>
              <ConfigTab overview={overview} configuration={allMetrics?.configuration} />
            </View>
          </Item>
        </TabPanels>
      </Tabs>
    </View>
  )
}

// ========================================================================
// SUB-COMPONENTS
// ========================================================================

function HealthBadge ({ label, status }) {
  const variants = { healthy: 'positive', warning: 'notice', degraded: 'notice', critical: 'negative' }
  return (
    <StatusLight variant={variants[status] || 'neutral'}>
      {label}: {(status || 'unknown').charAt(0).toUpperCase() + (status || 'unknown').slice(1)}
    </StatusLight>
  )
}

// ========================================================================
// OVERVIEW TAB
// ========================================================================

function OverviewTab ({ overview }) {
  if (!overview) return <Text>No data available</Text>
  const storage = overview.storage?.summary || {}
  const usage = overview.usage?.throughput?.last30Days || {}
  const failureSummary = overview.failures?.summary || {}

  return (
    <View>
      {/* KPI Row */}
      <div className='admin-kpi-grid'>
        <KPIMetric title='Storage Used' value={`${storage.totalEstimatedSizeMB || 0} MB`} subtitle={`of ${storage.maxStorageMB || 250} MB`} severity={storage.status} tooltip='Total estimated disk space consumed by all documents across every collection in DocDB.' />
        <KPIMetric title='Documents' value={(storage.totalDocuments || 0).toLocaleString()} subtitle={`of ${(storage.maxDocuments || 500000).toLocaleString()}`} severity={storage.documentsUsagePercent > 75 ? 'warning' : 'healthy'} tooltip='Total number of documents (records, metadata, audit logs, settings) stored in DocDB.' />
        <KPIMetric title='Throughput (30d)' value={(usage.totalOperations || 0).toLocaleString()} subtitle={`R:${usage.readOperations || 0} / W:${usage.writeOperations || 0}`} severity='info' tooltip='Total read + write API operations recorded in the last 30 days. R = reads (queries, lists), W = writes (uploads, updates, deletes).' />
        <KPIMetric title='Success Rate' value={`${failureSummary.overallSuccessRate || 100}%`} subtitle={`${failureSummary.totalFailures || 0} failures in 30d`} severity={failureSummary.failureRate > 5 ? 'warning' : 'healthy'} tooltip='Percentage of all operations that completed without error in the last 30 days.' />
      </div>

      {/* Storage Usage Bar */}
      <View UNSAFE_className='mdm-card' marginTop='size-300' marginBottom='size-300'>
        <Heading level={3} marginBottom='size-200'>Storage Utilization</Heading>
        <UsageBar label='Storage' current={storage.totalEstimatedSizeMB || 0} max={storage.maxStorageMB || 250} unit='MB' />
        <UsageBar label='Documents' current={storage.totalDocuments || 0} max={storage.maxDocuments || 500000} unit='docs' />
      </View>

      {/* API Mesh Config */}
      {overview.apiMesh && (
        <View UNSAFE_className='mdm-card' marginBottom='size-300'>
          <Heading level={3} marginBottom='size-200'>API Mesh Configuration</Heading>
          <div className='admin-detail-grid'>
            <DetailRow label='Cache TTL' value={`${overview.apiMesh.cacheTTL}s`} tooltip='Time-to-live (in seconds) for CDN-cached API responses. Higher values reduce backend load but delay data freshness.' />
            <DetailRow label='Rate Limit' value={`${overview.apiMesh.rateLimitPerMinute} req/min`} tooltip='Maximum number of API requests allowed per minute per client. Requests exceeding this limit receive a 429 status.' />
            <DetailRow label='CORS' value={overview.apiMesh.enableCORS ? 'Enabled' : 'Disabled'} tooltip='Cross-Origin Resource Sharing — when enabled, browsers on allowed origins can call the API directly.' />
            <DetailRow label='CORS Origins' value={overview.apiMesh.corsOrigins} tooltip='Comma-separated list of allowed origins for cross-origin requests. Use * to allow all origins.' />
            <DetailRow label='Max Page Size' value={overview.apiMesh.maxPageSize} tooltip='Maximum number of records returned in a single API page. Prevents oversized responses that slow clients.' />
          </div>
        </View>
      )}

      {/* Recent Failures */}
      {overview.failures?.recentFailures?.length > 0 && (
        <View UNSAFE_className='mdm-card'>
          <Flex justifyContent='space-between' alignItems='center' marginBottom='size-200'>
            <Heading level={3}>Recent Failures</Heading>
            <StatusLight variant='negative'>{overview.failures.recentFailures.length} failures</StatusLight>
          </Flex>
          <table className='mdm-table mdm-table--compact'>
            <thead>
              <tr>
                <th>Time</th>
                <th>Operation</th>
                <th>Master</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {overview.failures.recentFailures.slice(0, 5).map((f, i) => (
                <tr key={i}>
                  <td>{f.timestamp ? new Date(f.timestamp).toLocaleString() : '—'}</td>
                  <td><code>{f.operation}</code></td>
                  <td>{f.masterName || f.entityName}</td>
                  <td className='admin-error-cell'>{f.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </View>
      )}
    </View>
  )
}

// ========================================================================
// STORAGE TAB
// ========================================================================

function StorageTab ({ storage }) {
  if (!storage) return <Text>Loading storage metrics...</Text>
  const summary = storage.summary || {}
  const collections = storage.collections || {}
  const entities = storage.entities || []

  return (
    <View>
      {/* Summary */}
      <View UNSAFE_className='mdm-card' marginBottom='size-300'>
        <Heading level={3} marginBottom='size-200'>DocDB Storage Summary</Heading>
        <UsageBar label='Storage Capacity' current={summary.totalEstimatedSizeMB || 0} max={summary.maxStorageMB || 250} unit='MB' />
        <UsageBar label='Document Capacity' current={summary.totalDocuments || 0} max={summary.maxDocuments || 500000} unit='docs' />
        <Flex gap='size-300' marginTop='size-200'>
          <Well>
            <Text><strong>Remaining Storage:</strong> {(summary.remainingStorageMB || 0).toFixed(1)} MB</Text>
          </Well>
          <Well>
            <Text><strong>Remaining Documents:</strong> {(summary.remainingDocuments || 0).toLocaleString()}</Text>
          </Well>
        </Flex>
      </View>

      {/* Collection Breakdown */}
      <View UNSAFE_className='mdm-card' marginBottom='size-300'>
        <Heading level={3} marginBottom='size-200'>Collection Breakdown</Heading>
        <table className='mdm-table mdm-table--compact'>
          <thead>
            <tr>
              <th>Collection</th>
              <th style={{ textAlign: 'right' }}>Documents</th>
              <th style={{ textAlign: 'right' }}>Est. Size (MB)</th>
              <th>% of Total</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(collections).map(([name, stats]) => {
              const pct = summary.totalDocuments > 0
                ? ((stats.documentCount / summary.totalDocuments) * 100).toFixed(1)
                : 0
              return (
                <tr key={name}>
                  <td><code>{name}</code></td>
                  <td style={{ textAlign: 'right' }}>{(stats.documentCount || 0).toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }}>{(stats.estimatedSizeMB || 0).toFixed(3)}</td>
                  <td>
                    <MiniBar percent={parseFloat(pct)} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </View>

      {/* Per-Master Breakdown */}
      {entities.length > 0 && (
        <View UNSAFE_className='mdm-card'>
          <Heading level={3} marginBottom='size-200'>Per-Master Storage</Heading>
          <table className='mdm-table mdm-table--compact'>
            <thead>
              <tr>
                <th>Master</th>
                <th style={{ textAlign: 'right' }}>Records</th>
                <th style={{ textAlign: 'right' }}>Fields</th>
                <th style={{ textAlign: 'right' }}>Est. Storage (MB)</th>
                <th>Visibility</th>
              </tr>
            </thead>
            <tbody>
              {entities.map(e => (
                <tr key={e.masterName || e.entityName}>
                  <td>
                    <strong>{e.displayName}</strong>
                    <br />
                    <span style={{ fontSize: '11px', color: '#888' }}>{e.masterName || e.entityName}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>{(e.recordCount || 0).toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }}>{e.schemaFieldCount}</td>
                  <td style={{ textAlign: 'right' }}>{e.estimatedStorageMB.toFixed(3)}</td>
                  <td>
                    <StatusLight variant={e.visibility === 'public' ? 'positive' : 'neutral'}>
                      {e.visibility}
                    </StatusLight>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </View>
      )}
    </View>
  )
}

// ========================================================================
// GUARDRAILS TAB
// ========================================================================

function GuardrailsTab ({ guardrails }) {
  if (!guardrails) return <Text>Loading guardrails...</Text>
  const items = guardrails.guardrails || []

  const categories = {
    storage: { label: 'Storage Guardrails', items: [] },
    master: { label: 'Master Guardrails', items: [] },
    api: { label: 'API Guardrails', items: [] },
    config: { label: 'Configuration Limits', items: [] }
  }

  for (const g of items) {
    const cat = categories[g.category] || categories.config
    cat.items.push(g)
  }

  return (
    <View>
      <Flex gap='size-100' marginBottom='size-300'>
        <StatusLight variant={guardrails.overallStatus === 'critical' ? 'negative' : guardrails.overallStatus === 'warning' ? 'notice' : 'positive'}>
          Overall: {guardrails.overallStatus?.toUpperCase()}
        </StatusLight>
      </Flex>

      {Object.entries(categories).map(([key, cat]) => {
        if (cat.items.length === 0) return null
        return (
          <View key={key} UNSAFE_className='mdm-card' marginBottom='size-300'>
            <Heading level={3} marginBottom='size-200'>{cat.label}</Heading>
            {cat.items.map(g => (
              <View key={g.id} marginBottom='size-200'>
                <Flex justifyContent='space-between' alignItems='center' marginBottom='size-50'>
                  <Flex alignItems='center' gap='size-100'>
                    <StatusLight variant={g.severity === 'critical' ? 'negative' : g.severity === 'warning' ? 'notice' : g.severity === 'healthy' ? 'positive' : 'neutral'}>
                      {g.name}
                    </StatusLight>
                  </Flex>
                  <Text UNSAFE_style={{ fontSize: '13px', fontWeight: 600 }}>
                    {typeof g.current === 'number' ? g.current.toLocaleString() : g.current} / {typeof g.limit === 'number' ? g.limit.toLocaleString() : g.limit} {g.unit}
                  </Text>
                </Flex>
                {g.usagePercent > 0 && <UsageBar current={g.current} max={g.limit} unit={g.unit} />}
                <Text UNSAFE_style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>{g.message}</Text>
              </View>
            ))}
          </View>
        )
      })}

      <Well>
        <Text>
          <strong>Guardrail Enforcement:</strong> When storage or document limits are approached,
          mutation operations (upload, create, update, bulk operations) will be rejected with a 507 status code.
          This prevents exceeding capacity limits on your Adobe App Builder package.
        </Text>
      </Well>
    </View>
  )
}

// ========================================================================
// FAILURES TAB
// ========================================================================

function FailuresTab ({ failures }) {
  if (!failures) return <ProgressCircle aria-label='Loading...' isIndeterminate />
  const summary = failures.summary || {}
  const days = failures.period?.days || 30

  return (
    <View>
      <Flex justifyContent='space-between' alignItems='center' marginBottom='size-300'>
        <Heading level={3}>Failure Report</Heading>
        <Text UNSAFE_style={{ fontSize: '13px', color: '#6e6e6e' }}>Last {days} days</Text>
      </Flex>

      {/* Summary KPIs */}
      <div className='admin-kpi-grid'>
        <KPIMetric title='Total Operations' value={(summary.totalOperations || 0).toLocaleString()} severity='info' tooltip='Total number of audited operations (uploads, updates, deletes, queries) in the selected period.' />
        <KPIMetric title='Failures' value={(summary.totalFailures || 0).toLocaleString()} severity={summary.totalFailures > 0 ? 'warning' : 'healthy'} tooltip='Number of operations that returned an error or did not complete successfully.' />
        <KPIMetric title='Success Rate' value={`${summary.overallSuccessRate || 100}%`} severity={summary.overallSuccessRate < 95 ? 'warning' : 'healthy'} tooltip='Percentage of operations that succeeded. Below 95% may indicate systemic issues.' />
        <KPIMetric title='Failure Rate' value={`${summary.failureRate || 0}%`} severity={summary.failureRate > 5 ? 'warning' : 'healthy'} tooltip='Percentage of operations that failed. Above 5% is flagged as a warning.' />
      </div>

      {/* Operation Success Rates */}
      {failures.operationStats && Object.keys(failures.operationStats).length > 0 && (
        <View UNSAFE_className='mdm-card' marginTop='size-300' marginBottom='size-300'>
          <Heading level={4} marginBottom='size-200'>Operation Health</Heading>
          <table className='mdm-table mdm-table--compact'>
            <thead>
              <tr>
                <th>Operation</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th style={{ textAlign: 'right' }}>Success</th>
                <th style={{ textAlign: 'right' }}>Failures</th>
                <th>Success Rate</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(failures.operationStats)
                .sort(([, a], [, b]) => a.successRate - b.successRate)
                .map(([op, stats]) => (
                  <tr key={op}>
                    <td><code>{op}</code></td>
                    <td style={{ textAlign: 'right' }}>{stats.total}</td>
                    <td style={{ textAlign: 'right' }}>{stats.success}</td>
                    <td style={{ textAlign: 'right' }}>{stats.failure}</td>
                    <td>
                      <Flex alignItems='center' gap='size-100'>
                        <MiniBar percent={stats.successRate} color={stats.successRate < 90 ? '#e34850' : stats.successRate < 99 ? '#e68619' : '#2d9d78'} />
                        <Text UNSAFE_style={{ fontSize: '12px', width: '40px' }}>{stats.successRate}%</Text>
                      </Flex>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </View>
      )}

      {/* Failures by Master */}
      {failures.failuresByMaster && Object.keys(failures.failuresByMaster).length > 0 && (
        <View UNSAFE_className='mdm-card' marginBottom='size-300'>
          <Heading level={4} marginBottom='size-200'>Failures by Master</Heading>
          <div className='admin-detail-grid'>
            {Object.entries(failures.failuresByMaster)
              .sort(([, a], [, b]) => b - a)
              .map(([entity, count]) => (
                <DetailRow key={entity} label={entity} value={`${count} failure${count !== 1 ? 's' : ''}`} />
              ))}
          </div>
        </View>
      )}

      {/* Daily Trend */}
      {failures.failuresByDay && Object.keys(failures.failuresByDay).length > 0 && (
        <View UNSAFE_className='mdm-card' marginBottom='size-300'>
          <Heading level={4} marginBottom='size-200'>Failure Trend (Daily)</Heading>
          <BarChart data={Object.entries(failures.failuresByDay).sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ label: date.substring(5), value: count }))} color='#e34850' />
        </View>
      )}

      {/* Recent Failure Log */}
      {failures.recentFailures?.length > 0 && (
        <View UNSAFE_className='mdm-card'>
          <Heading level={4} marginBottom='size-200'>Recent Failure Details</Heading>
          <table className='mdm-table mdm-table--compact'>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Operation</th>
                <th>Master</th>
                <th>User</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {failures.recentFailures.map((f, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap' }}>{f.timestamp ? new Date(f.timestamp).toLocaleString() : '—'}</td>
                  <td><code>{f.operation}</code></td>
                  <td>{f.masterName || f.entityName}</td>
                  <td>{f.actor || '—'}</td>
                  <td className='admin-error-cell'>{f.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </View>
      )}

      {(!failures.recentFailures || failures.recentFailures.length === 0) && (
        <View UNSAFE_className='mdm-card' marginTop='size-300'>
          <div className='mdm-empty-state mdm-empty-state--compact'>
            <Text>No failures recorded in the last {days} days. All operations running smoothly.</Text>
          </div>
        </View>
      )}
    </View>
  )
}

// ========================================================================
// ANALYTICS TAB
// ========================================================================

function AnalyticsTab ({ analytics }) {
  if (!analytics) return <ProgressCircle aria-label='Loading...' isIndeterminate />
  const days = analytics.period?.days || 30

  return (
    <View>
      <Flex justifyContent='space-between' alignItems='center' marginBottom='size-300'>
        <Heading level={3}>Action Analytics</Heading>
        <Text UNSAFE_style={{ fontSize: '13px', color: '#6e6e6e' }}>Last {days} days</Text>
      </Flex>

      <div className='admin-kpi-grid'>
        <KPIMetric title='Total Invocations' value={(analytics.totalInvocations || 0).toLocaleString()} severity='info' tooltip='Total number of action invocations (API calls + internal operations) during the selected period.' />
        <KPIMetric title='Avg Daily' value={(analytics.avgDailyInvocations || 0).toFixed(0)} severity='info' tooltip='Average number of action invocations per day during the selected period.' />
        <KPIMetric title='Top Entities' value={analytics.topEntities?.length || 0} severity='info' tooltip='Number of distinct entities that received at least one operation in the selected period.' />
        <KPIMetric title='Active Users' value={analytics.topUsers?.length || 0} severity='info' tooltip='Number of distinct users who performed at least one operation in the selected period.' />
      </div>

      {/* Daily Trend */}
      {analytics.dailyTrend?.length > 0 && (
        <View UNSAFE_className='mdm-card' marginTop='size-300' marginBottom='size-300'>
          <Heading level={4} marginBottom='size-200'>Daily Invocation Trend</Heading>
          <BarChart data={analytics.dailyTrend.map(d => ({ label: d.date.substring(5), value: d.count }))} color='#1473E6' />
        </View>
      )}

      {/* Hourly Distribution */}
      {analytics.hourlyDistribution && (
        <View UNSAFE_className='mdm-card' marginBottom='size-300'>
          <Heading level={4} marginBottom='size-200'>Hourly Distribution (UTC)</Heading>
          <BarChart
            data={analytics.hourlyDistribution.map((count, hour) => ({
              label: `${String(hour).padStart(2, '0')}`,
              value: count
            }))}
            color='#6e32c9'
          />
        </View>
      )}

      {/* Invocations by Operation */}
      {analytics.invocationsByOperation && (
        <View UNSAFE_className='mdm-card' marginBottom='size-300'>
          <Heading level={4} marginBottom='size-200'>Invocations by Operation</Heading>
          <table className='mdm-table mdm-table--compact'>
            <thead>
              <tr>
                <th>Operation</th>
                <th style={{ textAlign: 'right' }}>Count</th>
                <th>Distribution</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(analytics.invocationsByOperation)
                .sort(([, a], [, b]) => b - a)
                .map(([op, count]) => {
                  const pct = analytics.totalInvocations > 0
                    ? ((count / analytics.totalInvocations) * 100).toFixed(1)
                    : 0
                  return (
                    <tr key={op}>
                      <td><code>{op}</code></td>
                      <td style={{ textAlign: 'right' }}>{count.toLocaleString()}</td>
                      <td><MiniBar percent={parseFloat(pct)} /> <span style={{ fontSize: '11px' }}>{pct}%</span></td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </View>
      )}

      {/* Top Entities + Users side by side */}
      <Flex gap='size-300'>
        {analytics.topEntities?.length > 0 && (
          <View UNSAFE_className='mdm-card' flex={1}>
            <Heading level={4} marginBottom='size-200'>Top Entities</Heading>
            {analytics.topEntities.map((e, i) => (
              <Flex key={i} justifyContent='space-between' marginBottom='size-50'>
                <Text>{e.entity}</Text>
                <Text UNSAFE_style={{ fontWeight: 600 }}>{e.count}</Text>
              </Flex>
            ))}
          </View>
        )}
        {analytics.topUsers?.length > 0 && (
          <View UNSAFE_className='mdm-card' flex={1}>
            <Heading level={4} marginBottom='size-200'>Top Users</Heading>
            {analytics.topUsers.map((u, i) => (
              <Flex key={i} justifyContent='space-between' marginBottom='size-50'>
                <Text>{u.user}</Text>
                <Text UNSAFE_style={{ fontWeight: 600 }}>{u.count}</Text>
              </Flex>
            ))}
          </View>
        )}
      </Flex>
    </View>
  )
}

// ========================================================================
// USAGE TAB
// ========================================================================

function UsageTab ({ usage }) {
  if (!usage) return <Text>Loading usage metrics...</Text>

  const tp = usage.throughput?.last30Days || {}
  const projected = usage.throughput?.projectedMonthly || {}
  const masterMetrics = usage.masterMetrics || {}
  const mesh = usage.apiMesh || {}
  const storageProj = usage.storageProjections || {}

  return (
    <View>
      <Heading level={3} marginBottom='size-300'>Usage &amp; Throughput</Heading>

      {/* Throughput KPIs */}
      <div className='admin-kpi-grid'>
        <KPIMetric title='Total Ops (30d)' value={(tp.totalOperations || 0).toLocaleString()} subtitle={`${(tp.avgOperationsPerDay || 0).toFixed(0)} avg/day`} severity='info' tooltip='Total read + write operations over the last 30 days. Includes queries, uploads, updates, and deletes.' />
        <KPIMetric title='Read / Write' value={tp.readWriteRatio || '—'} subtitle={`R:${(tp.readOperations || 0).toLocaleString()} W:${(tp.writeOperations || 0).toLocaleString()}`} severity='info' tooltip='Ratio of read operations (queries, lists, detail views) to write operations (uploads, updates, deletes). A high read ratio indicates a query-heavy workload.' />
        <KPIMetric title='Records Processed' value={(tp.totalRecordsAffected || 0).toLocaleString()} subtitle={`${(tp.avgRecordsPerDay || 0).toFixed(0)} avg/day`} severity='info' tooltip='Total number of individual records created, updated, or deleted in the last 30 days.' />
        <KPIMetric title='Projected Monthly' value={(projected.totalActivations || 0).toLocaleString()} subtitle='activations' severity='info' tooltip='Estimated total action activations this month, extrapolated from the last 30 days of usage. Useful for forecasting App Builder activation quotas.' />
      </div>

      {/* Projected Monthly Operations */}
      <View UNSAFE_className='mdm-card' marginTop='size-300' marginBottom='size-300'>
        <Heading level={4} marginBottom='size-200'>Monthly Projections</Heading>
        <div className='admin-detail-grid'>
          <DetailRow label='Projected Reads' value={`${(projected.readOperations || 0).toLocaleString()} ops`} tooltip='Estimated number of read operations (queries, list views) expected this month based on current trends.' />
          <DetailRow label='Projected Writes' value={`${(projected.writeOperations || 0).toLocaleString()} ops`} tooltip='Estimated number of write operations (uploads, updates, deletes) expected this month.' />
          <DetailRow label='Record Throughput' value={`${(projected.recordsThroughput || 0).toLocaleString()} records`} tooltip='Estimated total records that will be created, updated, or deleted this month.' />
          <DetailRow label='Total Activations' value={`${(projected.totalActivations || 0).toLocaleString()}`} tooltip='Estimated total serverless action activations for the month. Each API call or scheduled task counts as one activation.' />
        </div>
      </View>

      {/* Records by Operation */}
      {usage.throughput?.recordsByOperation && Object.keys(usage.throughput.recordsByOperation).length > 0 && (
        <View UNSAFE_className='mdm-card' marginBottom='size-300'>
          <Heading level={4} marginBottom='size-200'>Records by Operation</Heading>
          <table className='mdm-table mdm-table--compact'>
            <thead>
              <tr>
                <th>Operation</th>
                <th style={{ textAlign: 'right' }}>Records Affected</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(usage.throughput.recordsByOperation)
                .sort(([, a], [, b]) => b - a)
                .map(([op, count]) => (
                  <tr key={op}>
                    <td><code>{op}</code></td>
                    <td style={{ textAlign: 'right' }}>{count.toLocaleString()}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </View>
      )}

      {/* Master Metrics */}
      <View UNSAFE_className='mdm-card' marginBottom='size-300'>
        <Heading level={4} marginBottom='size-200'>Master Metrics</Heading>
        <div className='admin-kpi-grid'>
          <KPIMetric title='Total Masters' value={masterMetrics.totalMasters || 0} severity='info' tooltip='Total number of data masters (tables/datasets) created in the system.' />
          <KPIMetric title='Public' value={masterMetrics.publicMasters || 0} severity='info' tooltip='Masters with public visibility — accessible via the API Mesh without authentication.' />
          <KPIMetric title='CRUD Enabled' value={masterMetrics.crudEnabledMasters || 0} severity='info' tooltip='Masters that allow create, read, update, and delete operations via the API.' />
          <KPIMetric title='New (30d)' value={masterMetrics.newMastersLast30d || 0} severity='info' tooltip='Number of new masters created in the last 30 days.' />
        </div>
        <Flex gap='size-300' marginTop='size-200'>
          <Well>
            <Text><strong>Private Masters:</strong> {masterMetrics.privateMasters || 0}</Text>
          </Well>
          <Well>
            <Text><strong>With Archival:</strong> {masterMetrics.mastersWithArchival || 0}</Text>
          </Well>
        </Flex>
        {masterMetrics.masterGrowth?.length > 0 && (
          <View marginTop='size-200'>
            <Heading level={5} marginBottom='size-100'>Master Growth (30d)</Heading>
            <table className='mdm-table mdm-table--compact'>
              <thead>
                <tr>
                  <th>Master</th>
                  <th style={{ textAlign: 'right' }}>Records Added</th>
                </tr>
              </thead>
              <tbody>
                {masterMetrics.masterGrowth.map((eg, i) => (
                  <tr key={i}>
                    <td>{eg.entity}</td>
                    <td style={{ textAlign: 'right' }}>{(eg.recordsAdded || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </View>
        )}
      </View>

      {/* API Mesh */}
      <View UNSAFE_className='mdm-card' marginBottom='size-300'>
        <Heading level={4} marginBottom='size-200'>API Mesh Performance</Heading>
        <div className='admin-detail-grid'>
          <DetailRow label='Cache TTL' value={`${mesh.cacheTTL || 300}s`} tooltip='How long API responses are cached at the CDN edge. Higher values reduce backend calls but may serve stale data.' />
          <DetailRow label='Est. Cache Hit Rate' value={mesh.estimatedCacheHitRate || '—'} tooltip='Estimated percentage of API requests served from CDN cache without hitting the backend.' />
          <DetailRow label='Rate Limit' value={`${mesh.rateLimitPerMinute || 1000} req/min`} tooltip='Maximum API requests per minute per client before requests are throttled with a 429 status.' />
          <DetailRow label='Max Page Size' value={mesh.maxPageSize || 100} tooltip='Maximum records returned in a single API response page. Prevents excessively large payloads.' />
          <DetailRow label='CORS' value={mesh.enableCORS !== false ? 'Enabled' : 'Disabled'} tooltip='Whether browsers on external origins can call the API directly (Cross-Origin Resource Sharing).' />
        </div>
        <Well marginTop='size-200'>
          <Text UNSAFE_style={{ fontSize: '12px' }}>{mesh.recommendation || ''}</Text>
        </Well>
      </View>

      {/* Storage Projections */}
      <View UNSAFE_className='mdm-card' marginBottom='size-300'>
        <Heading level={4} marginBottom='size-200'>Storage Projections</Heading>
        <div className='admin-detail-grid'>
          <DetailRow label='Current Storage' value={`${storageProj.currentStorageMB || 0} / ${storageProj.maxStorageMB || 250} MB`} tooltip='Current estimated storage consumption versus the maximum allowed by your DocDB package.' />
          <DetailRow label='Monthly Growth' value={`${storageProj.projectedMonthlyGrowthMB || 0} MB`} tooltip='Estimated storage growth per month based on recent document creation and audit log activity.' />
          <DetailRow label='Months Until Full' value={storageProj.monthsUntilFull != null ? storageProj.monthsUntilFull : '∞'} tooltip='Estimated months before storage reaches capacity at the current growth rate. ∞ means negligible growth.' />
          <DetailRow label='Documents' value={`${(storageProj.currentDocuments || 0).toLocaleString()} / ${(storageProj.maxDocuments || 500000).toLocaleString()}`} tooltip='Current total documents (records + metadata + audit + settings) versus the package maximum.' />
          <DetailRow label='Audit Growth' value={`${storageProj.auditGrowthPerDay || 0} docs/day`} tooltip='Average number of audit log entries created per day. High values may indicate you should enable audit cleanup.' />
          <DetailRow label='Audit Budget Left' value={storageProj.daysUntilAuditBudgetExhausted != null ? `${storageProj.daysUntilAuditBudgetExhausted} days` : '∞'} tooltip='Estimated days before audit logs alone consume 10% of total document capacity. Enable audit cleanup to manage this.' />
        </div>
      </View>

      {/* Recommendations */}
      {usage.recommendations?.length > 0 && (
        <View UNSAFE_className='mdm-card'>
          <Heading level={4} marginBottom='size-200'>Usage Recommendations</Heading>
          {usage.recommendations.map((r, i) => (
            <Well key={i} marginBottom='size-100'>
              <Flex alignItems='center' gap='size-100'>
                <StatusLight variant={r.severity === 'critical' ? 'negative' : r.severity === 'warning' ? 'notice' : 'info'}>
                  {r.area.toUpperCase()}
                </StatusLight>
                <Text>{r.message}</Text>
              </Flex>
            </Well>
          ))}
        </View>
      )}
    </View>
  )
}

// ========================================================================
// CONFIG TAB
// ========================================================================

function ConfigTab ({ overview }) {
  const storage = overview?.storage?.summary || {}
  const mesh = overview?.apiMesh || {}

  return (
    <View>
      <Heading level={3} marginBottom='size-300'>Infrastructure Configuration</Heading>

      {/* DocDB Package Limits — read-only, managed by Adobe App Builder package tier */}
      <View UNSAFE_className='mdm-card' marginBottom='size-300'>
        <Heading level={4} marginBottom='size-200'>DocDB Package Limits</Heading>
        <div className='admin-detail-grid'>
          <DetailRow label='Max Storage' value={`${storage.maxStorageMB || 250} MB`} tooltip='Maximum storage capacity allocated to your DocDB instance by your App Builder package tier.' />
          <DetailRow label='Max Documents' value={(storage.maxDocuments || 500000).toLocaleString()} tooltip='Maximum total documents (records + metadata + audit) allowed in your DocDB instance.' />
          <DetailRow label='Collections' value={`${storage.activeCollections || 0} active`} tooltip='Number of DocDB collections currently in use (e.g. records, metadata, audit, settings).' />
          <DetailRow label='DB Region' value='APAC' tooltip='Geographic region where your DocDB instance is deployed. Affects latency for users in different regions.' />
        </div>
        <Well marginTop='size-200'>
          <Text UNSAFE_style={{ fontSize: '12px' }}>
            Package limits are determined by your Adobe App Builder tier. To modify these, update your App Builder subscription or adjust enforced limits in <strong>Settings → Data Management</strong>.
          </Text>
        </Well>
      </View>

      {/* API Mesh Settings */}
      <View UNSAFE_className='mdm-card' marginBottom='size-300'>
        <Heading level={4} marginBottom='size-200'>API Mesh Settings</Heading>
        <div className='admin-detail-grid'>
          <DetailRow label='CDN Cache TTL' value={`${mesh.cacheTTL || 300}s`} tooltip='How long (seconds) API Mesh caches responses at the CDN edge before fetching fresh data.' />
          <DetailRow label='Rate Limit' value={`${mesh.rateLimitPerMinute || 1000} req/min`} tooltip='Maximum API requests allowed per minute per client through the Mesh. Exceeding this returns HTTP 429.' />
          <DetailRow label='Max Page Size' value={mesh.maxPageSize || 100} tooltip='Upper bound on records per API page. Clients can request smaller pages but not larger.' />
          <DetailRow label='CORS Enabled' value={mesh.enableCORS !== false ? 'Yes' : 'No'} tooltip='Whether the API Mesh includes CORS headers allowing browser-based cross-origin requests.' />
          <DetailRow label='CORS Origins' value={mesh.corsOrigins || '*'} tooltip='Allowed origins for CORS requests. Use * for all origins, or specify exact domains for tighter security.' />
        </div>
        <Well marginTop='size-200'>
          <Text UNSAFE_style={{ fontSize: '12px' }}>
            API Mesh settings can be updated in <strong>Settings → API</strong>. Cache TTL and rate limits directly affect throughput and performance.
          </Text>
        </Well>
      </View>

      {/* Runtime Info */}
      <View UNSAFE_className='mdm-card'>
        <Heading level={4} marginBottom='size-200'>Runtime Environment</Heading>
        <div className='admin-detail-grid'>
          <DetailRow label='Runtime' value='Node.js 22' tooltip='Server-side JavaScript runtime used by all backend actions.' />
          <DetailRow label='Memory per Action' value='256 MB' tooltip='Maximum RAM allocated to each serverless action invocation. Exceeding this causes the action to fail.' />
          <DetailRow label='Action Timeout' value='60s' tooltip='Maximum execution time per action invocation. Long-running operations (large uploads, bulk updates) must complete within this window.' />
          <DetailRow label='Authentication' value='IMS (require-adobe-auth)' tooltip='All write operations require a valid Adobe IMS token. Public read actions (mdm-data, mdm-facets) bypass auth.' />
          <DetailRow label='Public API Actions' value='mdm-data, mdm-facets' tooltip='Actions accessible without authentication — used by API Mesh for public data consumption.' />
          <DetailRow label='Database' value='@adobe/aio-lib-db (DocDB)' tooltip='Adobe-managed document database. Stores all records, metadata, audit logs, and settings.' />
        </div>
      </View>
    </View>
  )
}

// ========================================================================
// SHARED UI PRIMITIVES
// ========================================================================

function KPIMetric ({ title, value, subtitle, severity, tooltip }) {
  const colors = {
    healthy: '#2d9d78', warning: '#e68619', critical: '#e34850', info: '#1473E6'
  }
  return (
    <div className='admin-kpi-metric' title={tooltip || ''}>
      <Text UNSAFE_className='admin-kpi-metric__title'>{title}{tooltip && <span className='admin-tooltip-icon'>ⓘ</span>}</Text>
      <Text UNSAFE_className='admin-kpi-metric__value' UNSAFE_style={{ color: colors[severity] || '#333' }}>{value}</Text>
      {subtitle && <Text UNSAFE_className='admin-kpi-metric__subtitle'>{subtitle}</Text>}
    </div>
  )
}

function UsageBar ({ label, current, max, unit }) {
  const pct = max > 0 ? Math.min(100, (current / max) * 100) : 0
  const color = pct > 90 ? '#e34850' : pct > 75 ? '#e68619' : '#2d9d78'

  return (
    <View marginBottom='size-150'>
      {label && (
        <Flex justifyContent='space-between' marginBottom='size-50'>
          <Text UNSAFE_style={{ fontSize: '13px', fontWeight: 500 }}>{label}</Text>
          <Text UNSAFE_style={{ fontSize: '12px', color: '#666' }}>
            {typeof current === 'number' ? current.toLocaleString() : current} / {typeof max === 'number' ? max.toLocaleString() : max} {unit} ({pct.toFixed(1)}%)
          </Text>
        </Flex>
      )}
      <div className='admin-usage-bar'>
        <div className='admin-usage-bar__fill' style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </View>
  )
}

function MiniBar ({ percent, color }) {
  const barColor = color || (percent > 90 ? '#e34850' : percent > 75 ? '#e68619' : '#2d9d78')
  return (
    <div className='admin-mini-bar'>
      <div className='admin-mini-bar__fill' style={{ width: `${Math.min(100, percent)}%`, backgroundColor: barColor }} />
    </div>
  )
}

function DetailRow ({ label, value, tooltip }) {
  return (
    <Flex justifyContent='space-between' alignItems='baseline' marginBottom='size-50' UNSAFE_style={{ padding: '4px 0', borderBottom: '1px solid var(--spectrum-global-color-gray-200)' }}>
      <Text UNSAFE_style={{ fontSize: '13px', color: '#666' }} title={tooltip || ''}>
        {label}{tooltip && <span className='admin-tooltip-icon'>ⓘ</span>}
      </Text>
      <Text UNSAFE_style={{ fontSize: '13px', fontWeight: 500 }}>{String(value)}</Text>
    </Flex>
  )
}

function BarChart ({ data, color }) {
  if (!data || data.length === 0) return null
  const max = Math.max(...data.map(d => d.value), 1)

  return (
    <div className='admin-bar-chart'>
      {data.map((d, i) => (
        <div key={i} className='admin-bar-chart__col'>
          <div className='admin-bar-chart__bar-wrap'>
            <div
              className='admin-bar-chart__bar'
              style={{
                height: `${(d.value / max) * 100}%`,
                backgroundColor: color || '#1473E6'
              }}
              title={`${d.label}: ${d.value}`}
            />
          </div>
          <span className='admin-bar-chart__label'>{d.label}</span>
        </div>
      ))}
    </div>
  )
}

export default AdminConsole
