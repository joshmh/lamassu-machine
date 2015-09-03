import fsp from 'fs-promise'
import R from 'ramda'
import Rx from 'rx'
import {lastLogs} from './raqia-client'

// import R from 'ramda'

/* Layout:
  - seed is array of category records
  - create a stream of streams, inner streams represent categories
  - for each category, load transactions from disk
  - for each category, load last remoteIndex from dynamo
  - create new stream of streams for adding new records from brain
  - concat new stream onto end of each old stream
  - merge stream with interval, connect to dbWriter
*/

let machineId

function fetchLog (category) {
  return Rx.Observable.fromPromise(fsp.readFile(category.path, 'utf8'))
  .flatMap(r => Rx.Observable.from(r.split('\n').slice(0, -1).map(JSON.parse)))
  .map(R.assoc('category', category.code))
}

function init(machineId, categories) {
  return Rx.Observable.from(categories)
  .flatMap(fetchLog)
}

/*
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
*/

// TODO: category index mutable state is evil. try to get it in the observable.
/*
function generateRecord (rec) {
  return {
    category: rec.category,
    categoryPath: category.path,
    record: {
      i: category.index,
      ts: new Date().toISOString(),
      data: rec.data
    }
  }
}
*/

export function log (log$) {
  return log$
  .map(rec => {
  })
  .do(r => fsp.appendFileSync(r.categoryPath, JSON.stringify(r.record) + '\n'))
}

let cats = [
  {code: 'test', path: '/tmp/test.dat', tableName: 'Test'},
  {code: 'transactions', path: '/tmp/transactions.dat', tableName: 'Transactions'}
]

let log$ = Rx.Observable.from([
  {category: 'transactions', data: {tx: 12345}},
  {category: 'transactions', data: {tx: 6789}}
])

import pp from '../lib/pp'

/*
init('990685c8-80e4-4344-b6d1-bd288f031b2f', cats)
.then(() => sync(log$).subscribe(pp, err => console.log(err.stack), r => console.log('completed')))
.catch(err => console.log(err.stack))
*/

let diskLog$ = init(machineId, cats)

diskLog$.subscribe(pp, err => console.log(err.stack), r => console.log('completed'))
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
