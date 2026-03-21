import dotenv from 'dotenv'

dotenv.config({ quiet: true })

export const DEBUG = Boolean(process.env.DEBUG)
export const ROUTER = process.env.ROUTER
export const COMMUNITY = process.env.COMMUNITY
export const IF_INDEX = process.env.IF_INDEX
export const POLL_TIMEOUT = Number(process.env.POLL_TIMEOUT ?? 1) * 60 * 1000

console.info(
    'env:',
    JSON.stringify({ DEBUG, ROUTER, COMMUNITY, IF_INDEX, POLL_TIMEOUT })
)
