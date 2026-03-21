import snmp from 'net-snmp'
import { ROUTER, COMMUNITY, IF_INDEX, DEBUG } from './env'
import { parseCounter64 } from './utils'

const OID_IN = `1.3.6.1.2.1.31.1.1.1.6.${IF_INDEX}`
const OID_OUT = `1.3.6.1.2.1.31.1.1.1.10.${IF_INDEX}`

const session = snmp.createSession(ROUTER, COMMUNITY, {
    version: snmp.Version2c,
})

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
                    if (result[index].speed === 0 || (parsedValue < 10_000_000_000 && parsedValue > 0)) {
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
        // Try hrSystemUptime first (more accurate), fall back to sysUpTime
        const uptimeOIDs = [
            '1.3.6.1.2.1.25.1.1.0',  // hrSystemUptime (HOST-RESOURCES-MIB)
            '1.3.6.1.2.1.1.3.0'     // sysUpTime (fallback)
        ]
        
        let currentOIDIndex = 0
        
        const tryNextOID = () => {
            if (currentOIDIndex >= uptimeOIDs.length) {
                return reject(new Error('All uptime OIDs failed'))
            }
            
            const oid = uptimeOIDs[currentOIDIndex]
            currentOIDIndex++
            
            session.get([oid], (err, varbinds) => {
                if (err) {
                    console.log(`Uptime OID ${oid} failed, trying next...`)
                    tryNextOID()
                    return
                }
                
                if (!varbinds) {
                    console.log(`Uptime OID ${oid} returned no varbinds, trying next...`)
                    tryNextOID()
                    return
                }
                
                const vb = varbinds[0]
                if (snmp.isVarbindError(vb)) {
                    console.log(`Uptime OID ${oid} returned error: ${snmp.varbindError(vb)}, trying next...`)
                    tryNextOID()
                    return
                }
                
                resolve(parseCounter64(vb.value))
            })
        }
        
        tryNextOID()
    })
}

export async function pollSnmp() {
    try {
        const [inOctets, outOctets] = await Promise.all([
            getSnmpValue(OID_IN),
            getSnmpValue(OID_OUT),
        ])

        if (DEBUG) {
            const date = new Date().toISOString()
            console.debug(
                JSON.stringify({ date, inOctets, outOctets }, null, 2)
            )
        }
        // insert values into db
    } catch (err) {
        console.error('SNMP error:', err)
    }
}
