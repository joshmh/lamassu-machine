import fsp from 'fs-promise'
import R from 'ramda'
import Rx from 'rx'
import {lastLogs} from './raqia-client'

// import R from 'ramda'

let categories = {}
let machineId

function init (_machineId, _categories) {
  machineId = _machineId
  let promises = _categories.map(cat => nextRecord(cat.path))

  return Promise.all(promises).then(results => {
    results.forEach((res, i) => {
      let cat = _categories[i]
      categories[cat.code] = {path: cat.path, index: res, tableName: cat.tableName}
    })
    return lastLogs(_categories)
  }).then(indexes =>
    indexes.forEach((index, i) => {
      let cat = _categories[i]
      categories[cat.code].remoteIndex = index
    })
  )
}

function nextRecord (logFile) {
  return fsp.readFile(logFile, 'utf8')
  .then(data => {
    let lines = data.split('\n')
    if (lines.length < 2) return 0
    let lastLine = lines[lines.length - 2]
    return JSON.parse(lastLine).i + 1
  })
  .catch(err => {
    if (err.errno === -2) return 0
    throw err
  })
}

function sync (log$) {
  // encrypt (lower priority)

  return log$.groupBy(r => r.category)
  .flatMap(o =>
    o.skipWhile((r, i, o) => {
      return r.i <= categories[o.key].remoteIndex
    })
    .map(r => ({
      PutRequest: {
        Item: {
          MachineId: {S: machineId},
          SerialNumber: {N: r.i},
          Timestamp: {S: r.ts},
          Ciphertext: {B: r.data}
        }
      }
    }))
    .toArray()
    .map(r => {
      return [categories[o.key].tableName, r]
    })
  ).toArray()
  .map(r => ({
    RequestItems: R.fromPairs(r)
  }))

  // For each category, batch write all unwritten records
  // On successful writes, update remoteIndexes
  // can be an observable, triggered by log$ and interval
}

export function log (log$) {
  return log$
  .do(rec => {
    let category = categories[rec.category]
    if (!category) throw new Error('Unknown log category: ' + rec.category)
    let outRec = {
      i: category.index,
      ts: new Date().toISOString(),
      data: rec.data
    }
    fsp.appendFileSync(category.path, JSON.stringify(outRec) + '\n')
  })
}

let cats = [
  {code: 'transactions', path: '/tmp/transactions.dat', tableName: 'Transactions'}
]

let log$ = Rx.Observable.from([
  {category: 'transactions', data: {tx: 12345}},
  {category: 'transactions', data: {tx: 6789}}
])

import pp from '../lib/pp'

init('990685c8-80e4-4344-b6d1-bd288f031b2f', cats)
.then(() => sync(log$).subscribe(pp, err => console.log(err.stack), r => console.log('completed')))
.catch(err => console.log(err.stack))

/*

Local disk

- sn
- timestamp
- category
- encrypted record

Sync with dynamo (on interval)

- Last successfully updated record
- Send all subsequent records
- Overwriting is ok

*/
