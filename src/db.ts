import { DatabaseSync } from 'node:sqlite'
import type { SnmpPollData, BandwidthData } from './types'
import { calculateUtilization } from './utils'
import { IF_INDEX } from './env'

const path = './data/router.db'
const db = new DatabaseSync(path)

export const initDb = () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS interface_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            interface_index INTEGER NOT NULL,
            in_octets INTEGER NOT NULL,
            out_octets INTEGER NOT NULL,
            in_errors INTEGER DEFAULT NULL,
            out_errors INTEGER DEFAULT NULL,
            in_packets INTEGER DEFAULT NULL,
            out_packets INTEGER DEFAULT NULL,
            in_discards INTEGER DEFAULT NULL,
            out_discards INTEGER DEFAULT NULL,
            UNIQUE(timestamp, interface_index)
        )
    `)

    db.exec(`
        CREATE TABLE IF NOT EXISTS daily_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date DATE NOT NULL,
            interface_index INTEGER NOT NULL,
            avg_in_octets REAL NOT NULL,
            avg_out_octets REAL NOT NULL,
            total_in_errors INTEGER DEFAULT 0,
            total_out_errors INTEGER DEFAULT 0,
            total_in_packets INTEGER DEFAULT 0,
            total_out_packets INTEGER DEFAULT 0,
            total_in_discards INTEGER DEFAULT 0,
            total_out_discards INTEGER DEFAULT 0,
            UNIQUE(date, interface_index)
        )
    `)

    // Create indexes for performance
    db.exec(
        'CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON interface_metrics(timestamp)'
    )
    db.exec(
        'CREATE INDEX IF NOT EXISTS idx_metrics_interface ON interface_metrics(interface_index)'
    )
    db.exec('CREATE INDEX IF NOT EXISTS idx_daily_date ON daily_metrics(date)')

    // Insert initial data point on startup
    console.info('Database initialized successfully')
}

export const insertPollData = (data: SnmpPollData) => {
    const stmt = db.prepare(`
        INSERT INTO interface_metrics
        (timestamp, interface_index, in_octets, out_octets, in_errors, out_errors, in_packets, out_packets, in_discards, out_discards)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
        data.timestamp,
        data.interface_index,
        data.in_octets,
        data.out_octets,
        data.in_errors,
        data.out_errors,
        data.in_packets,
        data.out_packets,
        data.in_discards,
        data.out_discards
    )
}

export const getRecentMetrics = (
    interfaceIndex: number,
    limit: number = 2
): SnmpPollData[] => {
    const stmt = db.prepare(`
        SELECT * FROM interface_metrics
        WHERE interface_index = ?
        ORDER BY timestamp DESC
        LIMIT ?
    `)
    return stmt.all(interfaceIndex, limit) as unknown as SnmpPollData[]
}

export const getCurrentBandwidth = (
    interfaceIndex: number,
    interfaceSpeedMbps: number
): BandwidthData | null => {
    const metrics = getRecentMetrics(interfaceIndex, 2)
    if (metrics.length < 2) return null

    const [current, previous] = metrics
    const timeDiffMs =
        new Date(current.timestamp).getTime() -
        new Date(previous.timestamp).getTime()
    const timeDiffSec = timeDiffMs / 1000

    if (timeDiffSec <= 0) return null

    // Calculate rates
    const inBps = ((current.in_octets - previous.in_octets) / timeDiffSec) * 8
    const outBps =
        ((current.out_octets - previous.out_octets) / timeDiffSec) * 8

    // Calculate error/packet/discard rates (per second)
    const calcRate = (curr: number | null, prev: number | null) => {
        if (curr === null || prev === null) return 0
        return (curr - prev) / timeDiffSec
    }

    return {
        timestamp: current.timestamp,
        interface_index: interfaceIndex,
        in_bps: Math.max(0, inBps),
        out_bps: Math.max(0, outBps),
        in_errors_rate: calcRate(current.in_errors, previous.in_errors),
        out_errors_rate: calcRate(current.out_errors, previous.out_errors),
        in_packets_rate: calcRate(current.in_packets, previous.in_packets),
        out_packets_rate: calcRate(current.out_packets, previous.out_packets),
        in_discards_rate: calcRate(current.in_discards, previous.in_discards),
        out_discards_rate: calcRate(
            current.out_discards,
            previous.out_discards
        ),
        utilization: calculateUtilization(
            Math.max(inBps, outBps),
            interfaceSpeedMbps
        ),
    }
}

export const aggregateDailyData = () => {
    const now = new Date()
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayDate = yesterday.toISOString().split('T')[0]

    // Check if already aggregated
    const checkStmt = db.prepare(
        'SELECT COUNT(*) as count FROM daily_metrics WHERE date = ? AND interface_index = ?'
    )
    const existingCount = checkStmt.get(yesterdayDate, Number(IF_INDEX))?.count
    if (existingCount && Number(existingCount) > 0) return

    // Get all data from yesterday
    const dataStmt = db.prepare(`
        SELECT * FROM interface_metrics
        WHERE DATE(timestamp) = ?
        AND interface_index = ?
        ORDER BY timestamp ASC
    `)
    const dailyData = dataStmt.all(
        yesterdayDate,
        Number(IF_INDEX)
    ) as unknown as SnmpPollData[]

    if (dailyData.length === 0) return

    // Calculate averages
    const sumIn = dailyData.reduce((sum, d) => sum + d.in_octets, 0)
    const sumOut = dailyData.reduce((sum, d) => sum + d.out_octets, 0)
    const avgIn = sumIn / dailyData.length
    const avgOut = sumOut / dailyData.length

    // Sum counters
    const sumErrors = (
        type:
            | 'in_errors'
            | 'out_errors'
            | 'in_packets'
            | 'out_packets'
            | 'in_discards'
            | 'out_discards'
    ) => {
        return dailyData.reduce((sum, d) => sum + (d[type] || 0), 0)
    }

    // Insert aggregated data
    const insertStmt = db.prepare(`
        INSERT INTO daily_metrics
        (date, interface_index, avg_in_octets, avg_out_octets,
         total_in_errors, total_out_errors, total_in_packets, total_out_packets,
         total_in_discards, total_out_discards)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    insertStmt.run(
        yesterdayDate,
        Number(IF_INDEX),
        avgIn,
        avgOut,
        sumErrors('in_errors'),
        sumErrors('out_errors'),
        sumErrors('in_packets'),
        sumErrors('out_packets'),
        sumErrors('in_discards'),
        sumErrors('out_discards')
    )

    // Clean up raw data older than 7 days
    cleanUpOldData()
}

const cleanUpOldData = () => {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const cutoffDate = sevenDaysAgo.toISOString()

    const deleteStmt = db.prepare(
        'DELETE FROM interface_metrics WHERE timestamp < ?'
    )
    deleteStmt.run(cutoffDate)
}

export const setupDailyAggregation = () => {
    // Calculate time until next midnight
    const now = new Date()
    const nextMidnight = new Date(now)
    nextMidnight.setDate(now.getDate() + 1)
    nextMidnight.setHours(0, 0, 0, 0)

    const msUntilMidnight = nextMidnight.getTime() - now.getTime()

    console.info(
        `Scheduling daily aggregation in ${Math.round(
            msUntilMidnight / 1000 / 60
        )} minutes (at midnight)`
    )

    setTimeout(() => {
        console.info('Running scheduled daily data aggregation...')
        aggregateDailyData()
        setupDailyAggregation() // Reschedule for next midnight
    }, msUntilMidnight)
}
