import snmp from 'net-snmp'
import { ROUTER, COMMUNITY, IF_INDEX, DEBUG } from './env'
import { calculateUtilization, parseCounter64 } from './utils'
import { insertPollData } from './db'
import type { BandwidthData, SnmpPollData } from './types'

const OID_IN = `1.3.6.1.2.1.31.1.1.1.6.${IF_INDEX}`
const OID_OUT = `1.3.6.1.2.1.31.1.1.1.10.${IF_INDEX}`
const OID_IN_ERRORS = `1.3.6.1.2.1.2.2.1.14.${IF_INDEX}`
const OID_OUT_ERRORS = `1.3.6.1.2.1.2.2.1.20.${IF_INDEX}`
const OID_IN_PACKETS = `1.3.6.1.2.1.2.2.1.11.${IF_INDEX}`
const OID_OUT_PACKETS = `1.3.6.1.2.1.2.2.1.17.${IF_INDEX}`
const OID_IN_DISCARDS = `1.3.6.1.2.1.2.2.1.13.${IF_INDEX}`
const OID_OUT_DISCARDS = `1.3.6.1.2.1.2.2.1.19.${IF_INDEX}`

const session = snmp.createSession(ROUTER, COMMUNITY, {
    version: snmp.Version2c,
})

// Global variables to track polling history for bandwidth calculation
let previousPollData: SnmpPollData | null = null
let currentPollData: SnmpPollData | null = null

export async function getSnmpValue(oid: string): Promise<number> {
    return new Promise((resolve, reject) => {
        session.get([oid], (err, varbinds) => {
            if (err) return reject(err)
            if (!varbinds) throw new Error('no varbinds')
            const vb = varbinds[0]
            if (snmp.isVarbindError(vb)) {
                return reject(snmp.varbindError(vb))
            }

            resolve(parseCounter64(vb.value))
        })
    })
}

export async function getAllInterfaceNames(): Promise<Record<number, string>> {
    return new Promise((resolve, reject) => {
        const result: Record<number, string> = {}

        session.walk(
            '1.3.6.1.2.1.31.1.1.1.1',
            (varbinds) => {
                for (const vb of varbinds) {
                    if (snmp.isVarbindError(vb)) continue
                    const index = Number.parseInt(
                        vb.oid.split('.').pop() || '0'
                    )
                    result[index] = vb.value?.toString() || ''
                }
                return true
            },
            (err) => {
                if (err) return reject(err)
                resolve(result)
            }
        )
    })
}

export async function getAllInterfaceStatuses(): Promise<
    Record<number, number>
> {
    return new Promise((resolve, reject) => {
        const result: Record<number, number> = {}

        session.walk(
            '1.3.6.1.2.1.2.2.1.8',
            (varbinds) => {
                for (const vb of varbinds) {
                    if (snmp.isVarbindError(vb)) continue
                    const index = Number.parseInt(
                        vb.oid.split('.').pop() || '0'
                    )
                    result[index] = Number.parseInt(vb.value?.toString() || '0')
                }
                return true
            },
            (err) => {
                if (err) return reject(err)
                resolve(result)
            }
        )
    })
}

export async function getAllInterfaceSpeeds(): Promise<
    Record<number, { speed: number; highSpeed: number }>
> {
    return new Promise((resolve, reject) => {
        const result: Record<number, { speed: number; highSpeed: number }> = {}

        session.walk(
            '1.3.6.1.2.1.2.2.1.5',
            (varbinds) => {
                for (const vb of varbinds) {
                    if (snmp.isVarbindError(vb)) continue
                    const index = Number.parseInt(
                        vb.oid.split('.').pop() || '0'
                    )
                    if (!result[index]) {
                        result[index] = { speed: 0, highSpeed: 0 }
                    }

                    // Parse the value, but prefer reasonable values (< 10 Tbps = 10,000,000 Mbps)
                    const parsedValue = parseCounter64(vb.value)

                    // If we already have a value and this new value is unreasonably large, keep the existing one
                    // This handles the case where we get both regular and Counter64 versions
                    if (
                        result[index].speed === 0 ||
                        (parsedValue < 10_000_000_000 && parsedValue > 0)
                    ) {
                        result[index].speed = parsedValue
                    }
                }
                return true
            },
            (err) => {
                if (err) return reject(err)

                // Now get high speed values
                session.walk(
                    '1.3.6.1.2.1.31.1.1.1.15',
                    (varbinds) => {
                        for (const vb of varbinds) {
                            if (snmp.isVarbindError(vb)) continue
                            const index = Number.parseInt(
                                vb.oid.split('.').pop() || '0'
                            )
                            if (!result[index]) {
                                result[index] = { speed: 0, highSpeed: 0 }
                            }
                            result[index].highSpeed = parseCounter64(vb.value)
                        }
                        return true
                    },
                    (err) => {
                        if (err) return reject(err)
                        resolve(result)
                    }
                )
            }
        )
    })
}

export async function getSystemUptime(): Promise<number> {
    return new Promise((resolve, reject) => {
        const oid = '1.3.6.1.2.1.25.1.1.0' // hrSystemUptime (HOST-RESOURCES-MIB)

        session.get([oid], (err, varbinds) => {
            if (err) return reject(err)

            if (!varbinds)
                return reject(
                    new Error(`Uptime OID ${oid} returned no varbinds`)
                )

            const vb = varbinds?.[0]

            if (!vb) return reject(new Error('empty vb'))

            if (snmp.isVarbindError(vb)) {
                reject(
                    new Error(
                        `Uptime OID ${oid} returned error: ${snmp.varbindError(
                            vb
                        )}`
                    )
                )
            }

            resolve(parseCounter64(vb.value))
        })
    })
}

export async function getInterfaceSpeed(): Promise<number> {
    try {
        // Try ifHighSpeed first (Mbps), fall back to ifSpeed (bps)
        const highSpeedOID = `1.3.6.1.2.1.31.1.1.1.15.${IF_INDEX}`
        const speedOID = `1.3.6.1.2.1.2.2.1.5.${IF_INDEX}`

        try {
            const highSpeed = await getSnmpValue(highSpeedOID)
            return highSpeed // Already in Mbps
        } catch (err) {
            console.warn(err)
            const speed = await getSnmpValue(speedOID)
            return speed / 1_000_000 // Convert bps to Mbps
        }
    } catch (err) {
        console.error('Failed to get interface speed', err)
        return 0
    }
}

async function fetchSnmp() {
    try {
        const results = await Promise.allSettled([
            getSnmpValue(OID_IN),
            getSnmpValue(OID_OUT),
            getSnmpValue(OID_IN_ERRORS),
            getSnmpValue(OID_OUT_ERRORS),
            getSnmpValue(OID_IN_PACKETS),
            getSnmpValue(OID_OUT_PACKETS),
            getSnmpValue(OID_IN_DISCARDS),
            getSnmpValue(OID_OUT_DISCARDS),
        ])

        const pollData = {
            timestamp: new Date().toISOString(),
            interface_index: Number(IF_INDEX),
            in_octets: results[0].status === 'fulfilled' ? results[0].value : 0,
            out_octets:
                results[1].status === 'fulfilled' ? results[1].value : 0,
            in_errors:
                results[2].status === 'fulfilled' ? results[2].value : null,
            out_errors:
                results[3].status === 'fulfilled' ? results[3].value : null,
            in_packets:
                results[4].status === 'fulfilled' ? results[4].value : null,
            out_packets:
                results[5].status === 'fulfilled' ? results[5].value : null,
            in_discards:
                results[6].status === 'fulfilled' ? results[6].value : null,
            out_discards:
                results[7].status === 'fulfilled' ? results[7].value : null,
        }

        if (DEBUG) console.debug(JSON.stringify(pollData))
        return pollData
    } catch (err) {
        console.error('SNMP polling error:', err)
        return null
    }
}

export async function pollSnmpAndInsertIntoDb() {
    const pollData = await fetchSnmp()
    if (pollData) {
        insertPollData(pollData)
    } else {
        console.error('no data inserted', new Date().toISOString())
    }
}

export async function pollSnmp() {
    previousPollData = currentPollData
    currentPollData = await fetchSnmp()
}

export async function getCurrentBandwidth(
    interfaceSpeedMbps: number
): Promise<BandwidthData | null> {
    await pollSnmp()
    if (!previousPollData || !currentPollData) return null

    // Calculate actual time difference between polls using timestamps
    const currentTime = new Date(currentPollData.timestamp).getTime()
    const previousTime = new Date(previousPollData.timestamp).getTime()
    const timeDiffSec = (currentTime - previousTime) / 1000

    if (timeDiffSec <= 0) return null

    // Calculate rates
    const inBps =
        ((currentPollData.in_octets - previousPollData.in_octets) /
            timeDiffSec) *
        8
    const outBps =
        ((currentPollData.out_octets - previousPollData.out_octets) /
            timeDiffSec) *
        8

    // Calculate error/packet/discard rates (per second)
    const calcRate = (curr: number | null, prev: number | null) => {
        if (curr === null || prev === null) return 0
        return (curr - prev) / timeDiffSec
    }

    return {
        timestamp: currentPollData.timestamp,
        interface_index: Number(IF_INDEX),
        in_bps: Math.max(0, inBps),
        out_bps: Math.max(0, outBps),
        in_errors_rate: calcRate(
            currentPollData.in_errors,
            previousPollData.in_errors
        ),
        out_errors_rate: calcRate(
            currentPollData.out_errors,
            previousPollData.out_errors
        ),
        in_packets_rate: calcRate(
            currentPollData.in_packets,
            previousPollData.in_packets
        ),
        out_packets_rate: calcRate(
            currentPollData.out_packets,
            previousPollData.out_packets
        ),
        in_discards_rate: calcRate(
            currentPollData.in_discards,
            previousPollData.in_discards
        ),
        out_discards_rate: calcRate(
            currentPollData.out_discards,
            previousPollData.out_discards
        ),
        utilization: calculateUtilization(
            Math.max(inBps, outBps),
            interfaceSpeedMbps
        ),
    }
}
