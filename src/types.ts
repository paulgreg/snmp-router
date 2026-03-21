export type SnmpDataRecordType = {
    date: string
}

export interface InterfaceStatus {
    index: number
    name: string
    status: string
    speed: string
    highSpeed: number // Mbps
    utilization?: number
}

export interface SystemStatus {
    interfaces: InterfaceStatus[]
    uptime: string
    timestamp: string
}
