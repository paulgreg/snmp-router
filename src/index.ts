import express from 'express'
import path from 'node:path'
import {
    getAllInterfaceNames,
    getAllInterfaceStatuses,
    getAllInterfaceSpeeds,
    getSystemUptime,
    getInterfaceSpeed,
    getCurrentBandwidth,
    pollSnmpAndInsertIntoDb,
    pollSnmp,
} from './snmp'
import {
    IF_INDEX,
    DAYS_TO_KEEP,
    PORT,
    DB_WRITE_INTERVAL_SEC,
    POLL_INTERVAL_SEC,
} from './env'
import {
    asciiBar,
    formatBandwidth,
    formatBigNumber,
    formatInterfaceStatus,
    formatSpeed,
    formatUptime,
} from './utils'
import type { SystemStatus } from './types'
import { initDb, getDatabaseStats, getDailyMetrics } from './db'

initDb()

pollSnmp()
pollSnmpAndInsertIntoDb()
setInterval(pollSnmpAndInsertIntoDb, DB_WRITE_INTERVAL_SEC * 1000)

const app = express()

app.use(express.static(path.join(__dirname, '..', 'public')))
app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, '..', 'views'))

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

        const databaseStats = getDatabaseStats(interfaceIndex)
        const dailyMetrics = getDailyMetrics(
            interfaceIndex,
            DAYS_TO_KEEP
        ).reverse()

        const maxInBytes = Math.max(
            1,
            ...dailyMetrics.map((point) => point.total_in_bytes)
        )
        const maxOutBytes = Math.max(
            1,
            ...dailyMetrics.map((point) => point.total_out_bytes)
        )

        const dailyLines = dailyMetrics.map((point) => {
            const totalInBytes = point.total_in_bytes || 0
            const totalOutBytes = point.total_out_bytes || 0
            const totalInMb = totalInBytes / (1024 * 1024)
            const totalOutMb = totalOutBytes / (1024 * 1024)

            const inBar = asciiBar(totalInBytes, maxInBytes, 18)
            const outBar = asciiBar(totalOutBytes, maxOutBytes, 18)

            return `${point.date}  IN [${inBar}] ${formatBigNumber(
                totalInMb
            ).padStart(10, '_')} MB  OUT [${outBar}] ${formatBigNumber(
                totalOutMb
            ).padStart(10, '_')} MB`
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
            pollIntervalSeconds: POLL_INTERVAL_SEC,
            uptime: formatUptime(uptime),
            interface: {
                index: interfaceIndex,
                name: interfaceName,
                status: interfaceStatus,
                speed: interfaceSpeedLabel,
                highSpeed: interfaceSpeedInfo?.highSpeed || 0,
                speedMbps: interfaceSpeed,
            },
            dailyLines,
            daysToKeep: DAYS_TO_KEEP,
            databaseStats,
            endpoints: [
                { label: 'Status JSON API', path: '/api/status' },
                { label: 'Consumption JSON API', path: '/api/consumption' },
            ],
            formatBandwidth: formatBandwidth.toString(),
        })
    } catch (error) {
        console.error('Dashboard endpoint error:', error)
        res.status(500).send('Failed to render dashboard')
    }
})

app.get('/api/consumption', async (req, res) => {
    try {
        const interfaceIndex = Number(IF_INDEX)
        const dailyMetrics = getDailyMetrics(interfaceIndex, DAYS_TO_KEEP)
        const start = dailyMetrics[0]?.date ?? null
        const end = dailyMetrics[dailyMetrics.length - 1]?.date ?? null

        res.json({
            start,
            end,
            quality: 'BRUT',
            reading_type: {
                unit: 'MB',
                measurement_kind: 'data',
                aggregate: 'sum',
                measuring_period: 'P1D',
            },
            interval_reading: dailyMetrics.map((point) => ({
                value: Math.round(
                    point.total_in_bytes / (1024 * 1024)
                ).toString(),
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

app.get('/api/bandwidth', async (req, res) => {
    try {
        const interfaceSpeed = await getInterfaceSpeed()
        const bandwidthData = await getCurrentBandwidth(interfaceSpeed)

        if (!bandwidthData) {
            return res.status(404).json({
                error: 'Not enough data to calculate bandwidth yet',
            })
        }

        res.json({
            timestamp: bandwidthData.timestamp,
            in_bps: bandwidthData.in_bps,
            out_bps: bandwidthData.out_bps,
            in_errors_rate: bandwidthData.in_errors_rate,
            out_errors_rate: bandwidthData.out_errors_rate,
            in_packets_rate: bandwidthData.in_packets_rate,
            out_packets_rate: bandwidthData.out_packets_rate,
            in_discards_rate: bandwidthData.in_discards_rate,
            out_discards_rate: bandwidthData.out_discards_rate,
            utilization: bandwidthData.utilization,
        })
    } catch (error) {
        console.error('Bandwidth API endpoint error:', error)
        res.status(500).json({
            error: 'Failed to retrieve bandwidth data',
            details: error instanceof Error ? error.message : 'Unknown error',
        })
    }
})

app.get('/api/status', async (req, res) => {
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

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
})
