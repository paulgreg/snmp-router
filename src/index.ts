import express from 'express'
import {
    pollSnmp,
    getAllInterfaceNames,
    getAllInterfaceStatuses,
    getAllInterfaceSpeeds,
    getSystemUptime,
    getInterfaceSpeed,
} from './snmp'
import { POLL_TIMEOUT, IF_INDEX } from './env'
import { formatInterfaceStatus, formatUptime, formatSpeed } from './utils'
import type { SystemStatus } from './types'
import {
    initDb,
    getCurrentBandwidth,
    getRecentMetrics,
    setupDailyAggregation,
} from './db'

initDb()
setupDailyAggregation()

setInterval(pollSnmp, POLL_TIMEOUT)

const app = express()

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

app.listen(3000, () => {
    console.log('Server running on port 3000')
})
