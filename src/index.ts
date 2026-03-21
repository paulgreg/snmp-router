import express from 'express'
import {
    pollSnmp,
    getAllInterfaceNames,
    getAllInterfaceStatuses,
    getAllInterfaceSpeeds,
    getSystemUptime,
} from './snmp'
import { POLL_TIMEOUT } from './env'
import { formatInterfaceStatus, formatUptime, formatSpeed } from './utils'
import type { SystemStatus } from './types'

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
    /* 
  That endpoint should give for the last minute
   - current bandwidth 
    bandwidth_in = (current_in - previous_in) / time_interval_seconds
    bandwidth_out = (current_out - previous_out) / time_interval_seconds
    bps = bytes_per_sec * 8
  
   - errors :
    1.3.6.1.2.1.2.2.1.14.${IF_INDEX} // ifInErrors
    1.3.6.1.2.1.2.2.1.20.${IF_INDEX} // ifOutErrors

   - Packet counters :
     1.3.6.1.2.1.2.2.1.11.${IF_INDEX} // ifInUcastPkts
     1.3.6.1.2.1.2.2.1.17.${IF_INDEX} // ifOutUcastPkts

   - Discards (silent drops)
     1.3.6.1.2.1.2.2.1.13.${IF_INDEX} // ifInDiscards
     1.3.6.1.2.1.2.2.1.19.${IF_INDEX} // ifOutDiscards
   */
})

app.listen(3000, () => {
    console.log('Server running on port 3000')
})

setInterval(pollSnmp, POLL_TIMEOUT)
