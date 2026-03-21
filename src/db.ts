import { DatabaseSync } from 'node:sqlite'
import type { SnmpDataRecordType } from './types'

const path = './data/router.db'

const db = new DatabaseSync(path)

export const initDb = () => {
    db.exec(`CREATE TABLE IF NOT EXISTS snmp (
date TEXT NOT NULL PRIMARY KEY
)`)
    // db.exec(`CREATE INDEX IF NOT EXISTS idx_value_date_key ON ...`)
}

export const insertData = async (record: SnmpDataRecordType) => {
    const { date } = record
    const insert = db.prepare('INSERT INTO snmp (date) VALUES (?)')
    insert.run(date)
}

export const listDataByDate = (): Array<SnmpDataRecordType> => {
    const query = db.prepare('SELECT date FROM snmp ORDER BY date DESC')
    return query.all() as Array<SnmpDataRecordType>
}
