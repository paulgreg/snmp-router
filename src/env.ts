import dotenv from 'dotenv'

dotenv.config({ quiet: true })

const ONE_SECOND = 1000
const ONE_MINUTE = 60 * ONE_SECOND

export const PORT = process.env.PORT ?? 6020
export const DEBUG = Boolean(process.env.DEBUG)
export const ROUTER = process.env.ROUTER
export const COMMUNITY = process.env.COMMUNITY
export const IF_INDEX = process.env.IF_INDEX
export const POLL_INTERVAL = ONE_MINUTE
export const DB_WRITE_INTERVAL = 60 * ONE_MINUTE
export const DAYS_TO_KEEP = 7

console.info(
    'env:',
    JSON.stringify({
        DEBUG,
        ROUTER,
        COMMUNITY,
        IF_INDEX,
        DB_WRITE_INTERVAL,
        POLL_INTERVAL,
        DAYS_TO_KEEP,
    })
)
