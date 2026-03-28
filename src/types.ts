export type SnmpDataRecordType = {
    date: string
}

export interface InterfaceStatus {
    index: number
    name: string
    status: string
    speed: string
    highSpeed: number
    utilization?: number
}

export interface SystemStatus {
    interfaces: InterfaceStatus[]
    uptime: string
    timestamp: string
}

export interface SnmpPollData {
    timestamp: string
    interface_index: number
    in_octets: number
    out_octets: number
    in_errors: number | null
    out_errors: number | null
    in_packets: number | null
    out_packets: number | null
    in_discards: number | null
    out_discards: number | null
}

export interface DailyAggregatedData {
    date: string
    interface_index: number
    avg_in_octets: number
    avg_out_octets: number
    total_in_errors: number
    total_out_errors: number
    total_in_packets: number
    total_out_packets: number
    total_in_discards: number
    total_out_discards: number
}

export interface BandwidthData {
    timestamp: string
    interface_index: number
    in_bps: number
    out_bps: number
    in_errors_rate: number
    out_errors_rate: number
    in_packets_rate: number
    out_packets_rate: number
    in_discards_rate: number
    out_discards_rate: number
    utilization: number
}

export interface DatabaseStats {
    total_raw_points: number
    days_with_data: number
    current_day_points: number
    oldest_timestamp: string | null
    newest_timestamp: string | null
}

export interface DailyTrendPoint {
    date: string
    in_bps: number
    out_bps: number
    total_in_errors: number
    total_out_errors: number
    total_in_packets: number
    total_out_packets: number
    total_in_discards: number
    total_out_discards: number
    samples: number
}

export interface DailyUsagePoint {
    date: string
    in_bytes: number
    out_bytes: number
    total_bytes: number
}
