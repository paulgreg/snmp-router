export function parseCounter64(value: any): number {
    if (Buffer.isBuffer(value)) {
        const hexString = value.toString('hex')
        return hexString ? Number(BigInt('0x' + hexString)) : 0
    }
    return Number(value)
}

export function formatInterfaceStatus(status: number): string {
    const statusMap: Record<number, string> = {
        0: 'unknown',
        1: 'up',
        2: 'down',
        3: 'testing',
        4: 'unknown',
        5: 'dormant',
        6: 'notPresent',
        7: 'lowerLayerDown'
    }
    return statusMap[status] || `unknown(${status})`
}

export function formatUptime(ticks: number): string {
    // sysUpTime is in hundredths of a second (centiseconds)
    const seconds = Math.floor(ticks / 100)
    
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const remainingSeconds = seconds % 60
    
    const parts: string[] = []
    if (days > 0) parts.push(`${days}d`)
    if (hours > 0) parts.push(`${hours}h`)
    if (minutes > 0) parts.push(`${minutes}m`)
    if (remainingSeconds > 0 || parts.length === 0) parts.push(`${remainingSeconds}s`)
    
    return parts.join(' ')
}

export function formatSpeed(speed: number): string {
    if (speed === 0) return '0 bps'
    
    // Validate reasonable speed values (max 1 Tbps = 1,000,000 Mbps)
    if (speed > 1_000_000_000_000) { // 1 Tbps in bps
        return `${(speed / 1_000_000_000_000).toFixed(2)} Tbps (unlikely)`
    }
    
    const units = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps']
    let unitIndex = 0
    let value = speed
    
    while (value >= 1000 && unitIndex < units.length - 1) {
        value /= 1000
        unitIndex++
    }
    
    return `${value.toFixed(2)} ${units[unitIndex]}`
}

export function calculateUtilization(bps: number, maxSpeedMbps: number): number {
    if (maxSpeedMbps <= 0) return 0
    const maxSpeedBps = maxSpeedMbps * 1_000_000
    return Math.min(100, Math.round((bps / maxSpeedBps) * 100))
}

export function formatBandwidth(bps: number): string {
    if (bps < 1000) return `${bps} bps`
    if (bps < 1_000_000) return `${(bps / 1000).toFixed(2)} Kbps`
    if (bps < 1_000_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`
    return `${(bps / 1_000_000_000).toFixed(2)} Gbps`
}
