import { DatabaseSync } from 'node:sqlite'
import type { SnmpPollData, DatabaseStats } from './types'
import { DAYS_TO_KEEP } from './env'

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

    db.exec(
        'CREATE INDEX IF NOT EXISTS idx_metrics_interface_timestamp ON interface_metrics(interface_index, timestamp)'
    )

    console.info('Database initialized successfully')
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
    cleanUpOldData()
}

export const getDatabaseStats = (interfaceIndex: number): DatabaseStats => {
    const totalRawPoints = db
        .prepare(
            'SELECT COUNT(*) as count FROM interface_metrics WHERE interface_index = ?'
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
        days_with_data: daysWithData || 0,
        current_day_points: currentDayPoints || 0,
        oldest_timestamp: range?.oldest ?? null,
        newest_timestamp: range?.newest ?? null,
    }
}

export const getDailyMetrics = (
    interfaceIndex: number,
    days: number
): Array<{
    date: string
    total_in_bytes: number
    total_out_bytes: number
    total_in_errors: number
    total_out_errors: number
    total_in_packets: number
    total_out_packets: number
    total_in_discards: number
    total_out_discards: number
    samples: number
}> => {
    const stmt = db.prepare(`
        SELECT
            DATE(timestamp) as date,
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
        ORDER BY DATE(timestamp) ASC
    `)

    const rows = stmt.all(interfaceIndex, days) as unknown as Array<{
        date: string
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
        // Calculate total bytes for the day
        const totalInBytes = Math.max(0, row.max_in_octets - row.min_in_octets)
        const totalOutBytes = Math.max(
            0,
            row.max_out_octets - row.min_out_octets
        )

        return {
            date: row.date,
            total_in_bytes: totalInBytes,
            total_out_bytes: totalOutBytes,
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
