import { DatabaseSync } from 'node:sqlite'
import type {
    SnmpPollData,
    DatabaseStats,
    DailyTrendPoint,
    WeeklyTrendPoint,
    DailyUsagePoint,
} from './types'
import { IF_INDEX, DAYS_TO_KEEP } from './env'

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
            avg_in_bps REAL DEFAULT 0,
            avg_out_bps REAL DEFAULT 0,
            total_in_errors INTEGER DEFAULT 0,
            total_out_errors INTEGER DEFAULT 0,
            total_in_packets INTEGER DEFAULT 0,
            total_out_packets INTEGER DEFAULT 0,
            total_in_discards INTEGER DEFAULT 0,
            total_out_discards INTEGER DEFAULT 0,
            samples INTEGER DEFAULT 0,
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

    const first = dailyData[0]
    const last = dailyData[dailyData.length - 1]
    const timeDiffSec =
        (new Date(last.timestamp).getTime() -
            new Date(first.timestamp).getTime()) /
        1000
    const avgInBps =
        timeDiffSec > 0
            ? Math.max(
                  0,
                  ((last.in_octets - first.in_octets) / timeDiffSec) * 8
              )
            : 0
    const avgOutBps =
        timeDiffSec > 0
            ? Math.max(
                  0,
                  ((last.out_octets - first.out_octets) / timeDiffSec) * 8
              )
            : 0

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
         total_in_discards, total_out_discards, avg_in_bps, avg_out_bps, samples)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        sumErrors('out_discards'),
        avgInBps,
        avgOutBps,
        dailyData.length
    )

    // Clean up raw data older than 7 days
    cleanUpOldData()
}

const cleanUpOldData = () => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - DAYS_TO_KEEP)
    const cutoffDate = cutoff.toISOString()

    const deleteStmt = db.prepare(
        'DELETE FROM interface_metrics WHERE timestamp < ?'
    )
    deleteStmt.run(cutoffDate)
}

export const getDatabaseStats = (interfaceIndex: number): DatabaseStats => {
    const totalRawPoints = db
        .prepare(
            'SELECT COUNT(*) as count FROM interface_metrics WHERE interface_index = ?'
        )
        .get(interfaceIndex)?.count as number

    const totalDailyPoints = db
        .prepare(
            'SELECT COUNT(*) as count FROM daily_metrics WHERE interface_index = ?'
        )
        .get(interfaceIndex)?.count as number

    const daysWithData = db
        .prepare(
            'SELECT COUNT(DISTINCT DATE(timestamp)) as count FROM interface_metrics WHERE interface_index = ?'
        )
        .get(interfaceIndex)?.count as number

    const currentDayPoints = db
        .prepare(
            "SELECT COUNT(*) as count FROM interface_metrics WHERE interface_index = ? AND DATE(timestamp) = DATE('now')"
        )
        .get(interfaceIndex)?.count as number

    const range = db
        .prepare(
            'SELECT MIN(timestamp) as oldest, MAX(timestamp) as newest FROM interface_metrics WHERE interface_index = ?'
        )
        .get(interfaceIndex) as { oldest: string | null; newest: string | null }

    return {
        total_raw_points: totalRawPoints || 0,
        total_daily_points: totalDailyPoints || 0,
        days_with_data: daysWithData || 0,
        current_day_points: currentDayPoints || 0,
        oldest_timestamp: range?.oldest ?? null,
        newest_timestamp: range?.newest ?? null,
    }
}

export const getDailyTrend = (
    interfaceIndex: number,
    days: number
): DailyTrendPoint[] => {
    const stmt = db.prepare(`
        SELECT
            DATE(timestamp) as date,
            MIN(timestamp) as first_timestamp,
            MAX(timestamp) as last_timestamp,
            MIN(in_octets) as min_in_octets,
            MAX(in_octets) as max_in_octets,
            MIN(out_octets) as min_out_octets,
            MAX(out_octets) as max_out_octets,
            SUM(COALESCE(in_errors, 0)) as total_in_errors,
            SUM(COALESCE(out_errors, 0)) as total_out_errors,
            SUM(COALESCE(in_packets, 0)) as total_in_packets,
            SUM(COALESCE(out_packets, 0)) as total_out_packets,
            SUM(COALESCE(in_discards, 0)) as total_in_discards,
            SUM(COALESCE(out_discards, 0)) as total_out_discards,
            COUNT(*) as samples
        FROM interface_metrics
        WHERE interface_index = ?
          AND timestamp >= datetime('now', '-' || ? || ' days')
        GROUP BY DATE(timestamp)
        ORDER BY DATE(timestamp) DESC
    `)

    const rows = stmt.all(interfaceIndex, days) as unknown as Array<{
        date: string
        first_timestamp: string
        last_timestamp: string
        min_in_octets: number
        max_in_octets: number
        min_out_octets: number
        max_out_octets: number
        total_in_errors: number
        total_out_errors: number
        total_in_packets: number
        total_out_packets: number
        total_in_discards: number
        total_out_discards: number
        samples: number
    }>

    return rows.map((row) => {
        const timeDiffSec =
            (new Date(row.last_timestamp).getTime() -
                new Date(row.first_timestamp).getTime()) /
            1000
        const inBps =
            timeDiffSec > 0
                ? Math.max(
                      0,
                      ((row.max_in_octets - row.min_in_octets) / timeDiffSec) *
                          8
                  )
                : 0
        const outBps =
            timeDiffSec > 0
                ? Math.max(
                      0,
                      ((row.max_out_octets - row.min_out_octets) /
                          timeDiffSec) *
                          8
                  )
                : 0

        return {
            date: row.date,
            in_bps: inBps,
            out_bps: outBps,
            total_in_errors: row.total_in_errors || 0,
            total_out_errors: row.total_out_errors || 0,
            total_in_packets: row.total_in_packets || 0,
            total_out_packets: row.total_out_packets || 0,
            total_in_discards: row.total_in_discards || 0,
            total_out_discards: row.total_out_discards || 0,
            samples: row.samples || 0,
        }
    })
}

export const getWeeklyTrend = (
    interfaceIndex: number,
    cutoffDays: number,
    limit: number = 8
): WeeklyTrendPoint[] => {
    const stmt = db.prepare(`
        SELECT
            strftime('%Y-W%W', date) as week,
            MIN(date) as start_date,
            MAX(date) as end_date,
            AVG(avg_in_bps) as avg_in_bps,
            AVG(avg_out_bps) as avg_out_bps,
            SUM(total_in_errors) as total_in_errors,
            SUM(total_out_errors) as total_out_errors,
            SUM(total_in_packets) as total_in_packets,
            SUM(total_out_packets) as total_out_packets,
            SUM(total_in_discards) as total_in_discards,
            SUM(total_out_discards) as total_out_discards,
            SUM(samples) as samples
        FROM daily_metrics
        WHERE interface_index = ?
          AND date < date('now', '-' || ? || ' days')
        GROUP BY strftime('%Y-W%W', date)
        ORDER BY week DESC
        LIMIT ?
    `)

    const rows = stmt.all(
        interfaceIndex,
        cutoffDays,
        limit
    ) as unknown as Array<{
        week: string
        start_date: string
        end_date: string
        avg_in_bps: number
        avg_out_bps: number
        total_in_errors: number
        total_out_errors: number
        total_in_packets: number
        total_out_packets: number
        total_in_discards: number
        total_out_discards: number
        samples: number
    }>

    return rows.map((row) => ({
        week: row.week,
        start_date: row.start_date,
        end_date: row.end_date,
        avg_in_bps: row.avg_in_bps || 0,
        avg_out_bps: row.avg_out_bps || 0,
        total_in_errors: row.total_in_errors || 0,
        total_out_errors: row.total_out_errors || 0,
        total_in_packets: row.total_in_packets || 0,
        total_out_packets: row.total_out_packets || 0,
        total_in_discards: row.total_in_discards || 0,
        total_out_discards: row.total_out_discards || 0,
        samples: row.samples || 0,
    }))
}

export const getDailyUsage = (
    interfaceIndex: number,
    days: number
): DailyUsagePoint[] => {
    const stmt = db.prepare(`
        SELECT
            DATE(timestamp) as date,
            MIN(in_octets) as min_in_octets,
            MAX(in_octets) as max_in_octets,
            MIN(out_octets) as min_out_octets,
            MAX(out_octets) as max_out_octets
        FROM interface_metrics
        WHERE interface_index = ?
          AND timestamp >= datetime('now', '-' || ? || ' days')
        GROUP BY DATE(timestamp)
        ORDER BY DATE(timestamp) ASC
    `)

    const rows = stmt.all(interfaceIndex, days) as unknown as Array<{
        date: string
        min_in_octets: number
        max_in_octets: number
        min_out_octets: number
        max_out_octets: number
    }>

    return rows.map((row) => {
        const inBytes = Math.max(0, row.max_in_octets - row.min_in_octets)
        const outBytes = Math.max(0, row.max_out_octets - row.min_out_octets)
        return {
            date: row.date,
            in_bytes: inBytes,
            out_bytes: outBytes,
            total_bytes: inBytes + outBytes,
        }
    })
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
