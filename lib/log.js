import fsp from 'fs-promise'
import R from 'ramda'
import Rx from 'rx'
import {currentLogIndexes, batchWriteItem} from './raqia-client'

// import R from 'ramda'

/* Layout:
  - for each category, load last remoteIndex from dynamo
*/

function fetchLog (category) {
  return Rx.Observable.fromPromise(fsp.readFile(category.path, 'utf8'))
  .flatMap(r => Rx.Observable.from(r.split('\n').slice(0, -1).map(JSON.parse)))
  .map(R.merge({saved: true}))
}

function _putRequest (machineId, item) {
  return {
    PutRequest: {
      Item: {
        MachineId: {S: machineId},
        SerialNumber: {N: item.index.toString()},
        Timestamp: {S: item.ts},
        Ciphertext: {B: item.data.toString()}
      }
    }
  }
}

function init (machineId, categories, remoteIndexes$, newLog$) {
  let putRequest = R.partial(_putRequest, machineId)
  let categoryLookup = {}
  categories.forEach(r => categoryLookup[r.code] = {path: r.path, tableName: r.tableName})

  let groupedRecs$ = Rx.Observable.from(categories)
  .flatMap(fetchLog)
  .concat(newLog$.map(r => R.assoc('ts', new Date().toISOString(), r)))
  .groupBy(r => r.category)
  .map(g => g.map((r, i) => R.assoc('index', i, r)))

  groupedRecs$.map(g => g.skipWhile(r => r.saved))
  .subscribe(g =>
    g.subscribe(r => fsp.appendFileSync(categoryLookup[r.category].path,
      JSON.stringify(R.assoc('saved', true, r)) + '\n')
    )
  )

  Rx.Observable.interval(5000).startWith(0)
  .withLatestFrom(remoteIndexes$, (a, b) => [a, b])
  .flatMap(([, remoteIndexes]) => {
    return groupedRecs$
    .flatMap((g, i) => {
      return g.skipWhile(r => r.index < remoteIndexes[i].currentIndex)
      .map(putRequest)
      .bufferWithTimeOrCount(1000, 20)
      .filter(r => r.length > 0)
      .map(r => {
        return [categoryLookup[categories[i].code].tableName, r]
      })
    })
    .bufferWithCount(categories.length)
    .map((r, i) => ({
      RequestItems: R.fromPairs(r)
    }))
  })
  .tap(pp)
  .flatMap(r => batchWriteItem(r))
  .subscribe(pp, err => console.log(err.stack))
}

let cats = [
  {code: 'transactions', path: '/tmp/transactions.dat', tableName: 'Transactions'}
]

import pp from '../lib/pp'

let EventEmitter = require('events').EventEmitter
let emitter = new EventEmitter()

let newLog$ = Rx.Observable.fromEvent(emitter, 'log')

let remoteIndexes$ = currentLogIndexes(cats)
remoteIndexes$.toArray().first().subscribe(r => {
  init('990685c8-80e4-4344-b6d1-bd288f031b2f', cats, remoteIndexes$.startWith(r), newLog$)
})

/*
setTimeout(function () {
  emitter.emit('log', {category: 'transactions', data: {tx: 8888}})
  emitter.emit('log', {category: 'transactions', data: {tx: 8889}})
}, 100)
*/
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
