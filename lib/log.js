import fsp from 'fs-promise'
import R from 'ramda'
import Rx from 'rx'
import {currentLogIndexes} from './raqia-client'

// import R from 'ramda'

/* Layout:
  - for each category, load last remoteIndex from dynamo
  - create new stream of streams for adding new records from brain
  - concat new stream onto end of each old stream
  - merge stream with interval, connect to dbWriter
*/

let machineId

function fetchLog (category) {
  return Rx.Observable.fromPromise(fsp.readFile(category.path, 'utf8'))
  .flatMap(r => Rx.Observable.from(r.split('\n').slice(0, -1).map(JSON.parse)))
  .map(R.merge({saved: true}))
}

function init (machineId, categories, newLog$) {
  // let currentRemoteIndexes$ = currentLogIndexes(categories)
  let pathLookup = {}
  categories.forEach(r => pathLookup[r.code] = r.path)

  return Rx.Observable.from(categories)
  .flatMap(fetchLog)
  .concat(newLog$.map(r => R.assoc('ts', new Date().toISOString(), r)))
  .groupBy(r => r.category)
  .map(g => g.map((r, i) => R.assoc('index', i, r)))
  .map(g =>
    g.skipWhile(r => r.saved)
    .do(r =>
      fsp.appendFileSync(pathLookup[r.category],
        JSON.stringify(R.assoc('saved', true, r)) + '\n')
    )
  )
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

let EventEmitter = require('events').EventEmitter
let emitter = new EventEmitter()

let newLog$ = Rx.Observable.fromEvent(emitter, 'log')
let diskLog$ = init(machineId, cats, newLog$)

diskLog$.subscribe(r => {
  console.log(r.key)
  r.subscribe(pp)
}, err => console.log(err.stack), r => console.log('completed'))

setTimeout(function () {
  emitter.emit('log', {category: 'transactions', data: {tx: 8888}})
  emitter.emit('log', {category: 'transactions', data: {tx: 8889}})
}, 100)
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
