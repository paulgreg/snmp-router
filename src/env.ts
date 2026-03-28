import dotenv from 'dotenv'

dotenv.config({ quiet: true })

export const PORT = process.env.PORT ?? 6020
export const DEBUG = Boolean(process.env.DEBUG)
export const ROUTER = process.env.ROUTER
export const COMMUNITY = process.env.COMMUNITY
export const IF_INDEX = process.env.IF_INDEX
export const DAYS_TO_KEEP = 14
export const POLL_INTERVAL_SEC = 5
export const DB_WRITE_INTERVAL_SEC = 60 * 60

console.info(
    'env:',
    JSON.stringify({
        DEBUG,
        ROUTER,
        COMMUNITY,
        IF_INDEX,
        DB_WRITE_INTERVAL_SEC,
        POLL_INTERVAL_SEC,
        DAYS_TO_KEEP,
    })
)
