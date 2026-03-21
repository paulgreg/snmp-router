import express from 'express'
import path from 'node:path'
import {
    pollSnmp,
    getAllInterfaceNames,
    getAllInterfaceStatuses,
    getAllInterfaceSpeeds,
    getSystemUptime,
    getInterfaceSpeed,
} from './snmp'
import { POLL_TIMEOUT, IF_INDEX, DAYS_TO_KEEP, PORT } from './env'
import {
    asciiBar,
    formatBitsPerSecond,
    formatInterfaceStatus,
    formatSpeed,
    formatUptime,
} from './utils'
import type { SystemStatus } from './types'
import {
    initDb,
    getCurrentBandwidth,
    getRecentMetrics,
    setupDailyAggregation,
    getDatabaseStats,
    getDailyTrend,
    getWeeklyTrend,
    getDailyUsage,
} from './db'

initDb()
setupDailyAggregation()

setInterval(pollSnmp, POLL_TIMEOUT)

const app = express()

app.use(express.static(path.join(__dirname, '..', 'public')))
app.set('view engine', 'pug')
app.set('views', path.join(__dirname, '..', 'views'))

app.get('/status', async (req, res) => {
    try {
        const [names, statuses, speeds, uptime] = await Promise.all([
            getAllInterfaceNames(),
            getAllInterfaceStatuses(),
            getAllInterfaceSpeeds(),
            getSystemUptime(),
        ])

        const interfaces: SystemStatus['interfaces'] = []

        // Combine data for all interfaces
        const allInterfaceIndices = new Set([
            ...Object.keys(names).map(Number),
            ...Object.keys(statuses).map(Number),
            ...Object.keys(speeds).map(Number),
        ])

        for (const index of Array.from(allInterfaceIndices).sort(
            (a, b) => a - b
        )) {
            interfaces.push({
                index,
                name: names[index] || `Interface ${index}`,
                status: formatInterfaceStatus(statuses[index] || 0),
                speed: formatSpeed(speeds[index]?.speed || 0),
                highSpeed: speeds[index]?.highSpeed || 0,
                utilization: 0, // Will be calculated when we have bandwidth data
            })
        }

        const response: SystemStatus = {
            interfaces,
            uptime: formatUptime(uptime),
            timestamp: new Date().toISOString(),
        }

        res.json(response)
    } catch (error) {
        console.error('Status endpoint error:', error)
        res.status(500).json({
            error: 'Failed to retrieve router status',
            details: error instanceof Error ? error.message : 'Unknown error',
        })
    }
})

app.get('/current', async (req, res) => {
    try {
        // Get interface speed for utilization calculation
        const interfaceSpeed = await getInterfaceSpeed()

        // Get current bandwidth data
        const bandwidthData = getCurrentBandwidth(
            Number(IF_INDEX),
            interfaceSpeed
        )

        if (!bandwidthData) {
            return res.status(404).json({
                error: 'Insufficient data for bandwidth calculation',
            })
        }

        // Get raw metrics for additional context
        const recentMetrics = getRecentMetrics(Number(IF_INDEX), 1)

        res.json({
            timestamp: bandwidthData.timestamp,
            interface_index: bandwidthData.interface_index,
            bandwidth: {
                in_bps: bandwidthData.in_bps,
                out_bps: bandwidthData.out_bps,
                in_mbps: bandwidthData.in_bps / 1_000_000,
                out_mbps: bandwidthData.out_bps / 1_000_000,
            },
            utilization: bandwidthData.utilization,
            rates: {
                errors_per_sec: {
                    in: bandwidthData.in_errors_rate,
                    out: bandwidthData.out_errors_rate,
                },
                packets_per_sec: {
                    in: bandwidthData.in_packets_rate,
                    out: bandwidthData.out_packets_rate,
                },
                discards_per_sec: {
                    in: bandwidthData.in_discards_rate,
                    out: bandwidthData.out_discards_rate,
                },
            },
            raw: recentMetrics[0] || null,
        })
    } catch (error) {
        console.error('Current endpoint error:', error)
        res.status(500).json({
            error: 'Failed to retrieve current bandwidth',
            details: error instanceof Error ? error.message : 'Unknown error',
        })
    }
})

app.get('/esp32/consumption', async (req, res) => {
    try {
        const interfaceIndex = Number(IF_INDEX)
        const dailyUsage = getDailyUsage(interfaceIndex, DAYS_TO_KEEP)
        const start = dailyUsage[0]?.date ?? null
        const end = dailyUsage[dailyUsage.length - 1]?.date ?? null

        res.json({
            start,
            end,
            quality: 'BRUT',
            reading_type: {
                unit: 'Mb',
                measurement_kind: 'data',
                aggregate: 'sum',
                measuring_period: 'P1D',
            },
            interval_reading: dailyUsage.map((point) => ({
                value: ((point.in_bytes * 8) / 1_000_000).toFixed(3),
                date: point.date,
            })),
        })
    } catch (error) {
        console.error('ESP32 consumption endpoint error:', error)
        res.status(500).json({
            error: 'Failed to retrieve consumption data',
            details: error instanceof Error ? error.message : 'Unknown error',
        })
    }
})

app.get('/', async (req, res) => {
    try {
        const interfaceIndex = Number(IF_INDEX)
        const [names, statuses, speeds, uptime, interfaceSpeed] =
            await Promise.all([
                getAllInterfaceNames(),
                getAllInterfaceStatuses(),
                getAllInterfaceSpeeds(),
                getSystemUptime(),
                getInterfaceSpeed(),
            ])

        const bandwidthData = getCurrentBandwidth(
            interfaceIndex,
            interfaceSpeed
        )

        const recentMetrics = getRecentMetrics(interfaceIndex, 1)
        const databaseStats = getDatabaseStats(interfaceIndex)
        const dailyTrend = getDailyTrend(interfaceIndex, DAYS_TO_KEEP)
        const weeklyTrend = getWeeklyTrend(interfaceIndex, DAYS_TO_KEEP, 8)

        const maxInBps = Math.max(
            1,
            ...dailyTrend.map((point) => point.in_bps),
            ...weeklyTrend.map((point) => point.avg_in_bps)
        )
        const maxOutBps = Math.max(
            1,
            ...dailyTrend.map((point) => point.out_bps),
            ...weeklyTrend.map((point) => point.avg_out_bps)
        )

        const dailyLines = dailyTrend.map((point) => {
            const inBar = asciiBar(point.in_bps, maxInBps, 18, true)
            const outBar = asciiBar(point.out_bps, maxOutBps, 18, true)
            return `${point.date}  IN [${inBar}] ${formatBitsPerSecond(
                point.in_bps
            )}  OUT [${outBar}] ${formatBitsPerSecond(point.out_bps)}`
        })

        const weeklyLines = weeklyTrend.map((point) => {
            const inBar = asciiBar(point.avg_in_bps, maxInBps, 18, true)
            const outBar = asciiBar(point.avg_out_bps, maxOutBps, 18, true)
            const label = `${point.week} (${point.start_date}..${point.end_date})`
            return `${label}  IN [${inBar}] ${formatBitsPerSecond(
                point.avg_in_bps
            )}  OUT [${outBar}] ${formatBitsPerSecond(point.avg_out_bps)}`
        })

        const interfaceName =
            names[interfaceIndex] || `Interface ${interfaceIndex}`
        const interfaceStatus = formatInterfaceStatus(
            statuses[interfaceIndex] || 0
        )
        const interfaceSpeedInfo = speeds[interfaceIndex]
        const interfaceSpeedLabel = formatSpeed(interfaceSpeedInfo?.speed || 0)

        res.render('index', {
            title: 'Router Bandwidth',
            generatedAt: new Date().toISOString(),
            pollTimeoutMs: POLL_TIMEOUT,
            uptime: formatUptime(uptime),
            interface: {
                index: interfaceIndex,
                name: interfaceName,
                status: interfaceStatus,
                speed: interfaceSpeedLabel,
                highSpeed: interfaceSpeedInfo?.highSpeed || 0,
                speedMbps: interfaceSpeed,
            },
            current: bandwidthData
                ? {
                      timestamp: bandwidthData.timestamp,
                      in_bps: formatBitsPerSecond(bandwidthData.in_bps),
                      out_bps: formatBitsPerSecond(bandwidthData.out_bps),
                      utilization: bandwidthData.utilization,
                      errors_in: bandwidthData.in_errors_rate.toFixed(2),
                      errors_out: bandwidthData.out_errors_rate.toFixed(2),
                      discards_in: bandwidthData.in_discards_rate.toFixed(2),
                      discards_out: bandwidthData.out_discards_rate.toFixed(2),
                      packets_in: bandwidthData.in_packets_rate.toFixed(2),
                      packets_out: bandwidthData.out_packets_rate.toFixed(2),
                  }
                : null,
            lastSample: recentMetrics[0] || null,
            dailyLines,
            weeklyLines,
            daysToKeep: DAYS_TO_KEEP,
            databaseStats,
            endpoints: [
                { label: 'Status JSON', path: '/status' },
                { label: 'Current JSON', path: '/current' },
                { label: 'ESP32 Consumption JSON', path: '/esp32/consumption' },
            ],
        })
    } catch (error) {
        console.error('Dashboard endpoint error:', error)
        res.status(500).send('Failed to render dashboard')
    }
})

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
})
