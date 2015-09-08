import fsp from 'fs-promise'
import R from 'ramda'
import Rx from 'rx'
import {currentLogIndexes, batchWriteItem} from './raqia-client'
import {encrypt} from './raqia-crypto'

function fetchLog (category) {
  console.log('DEBUG10: %s', category.path)

  let readPromise = fsp.readFile(category.path, 'utf8')
  .catch(err => {
    console.log('DEBUG11')
    if (err.code === 'ENOENT') {
      console.log('DEBUG12')
      return fsp.writeFile(category.path, '')
      .then(() => '')
    }
    throw err
  })

  readPromise = Promise.resolve('')
  console.log('DEBUG13')
  return Rx.Observable.fromPromise(readPromise)
  .tap(() => console.log('DEBUG14')).flatMap(r => Rx.Observable.from(r.split('\n').slice(0, -1).map(JSON.parse)))
  .map(R.merge({saved: true}))
}

function _putRequest (machineId, item) {
  return {
    PutRequest: {
      Item: {
        MachineId: {S: machineId},
        SerialNumber: {N: item.index.toString()},
        Timestamp: {S: item.ts},
        Ciphertext: {B: new Buffer(item.ciphertext, 'base64')},
        Iv: {B: new Buffer(item.iv, 'base64')},
        Version: {N: item.version.toString()},
        KeyId: {S: item.keyId}
      }
    }
  }
}

function mintRecord (rec, key) {
  let plaintext = new Buffer(JSON.stringify(rec.data), 'utf8')
  let res = encrypt(plaintext, key.material)
  return {
    ts: new Date().toISOString(),
    category: rec.category,
    ciphertext: res.ciphertext.toString('base64'),
    iv: res.iv.toString('base64'),
    version: res.version,
    keyId: key.id
  }
}

export function init (machineId, categories, newLog$, key$) {
  let putRequest = R.partial(_putRequest, machineId)
  let categoryLookup = {}
  categories.forEach(r => categoryLookup[r.code] = {path: r.path, tableName: r.tableName})

  let mintedLog$ = newLog$.withLatestFrom(key$, (a, b) => [a, b])
  .map(([r, key]) => mintRecord(r, key))

  let savedRecs$ = Rx.Observable.from(categories).flatMap(fetchLog).publish()

/*
  Redo db saving to use cache, so that we don't load from disk and keep
  everything in memory on every new record.

  In order to correctly index new records, we need to make use of groupedRecs$
  for caching, so cache should be a map of caches, one for each category.

  let cache = []
  savedRecs$.toArray().subscribe(_cache => {
    newLog$.subscribe(r => _cache.push(r))
    newLog$.startWith(0).debounce(1000)
    .flatMap(() => currentLogIndexes(cats))
    .flatMap(remoteIndexes => {
      cache = _cache.filter(item => {
        let category = item.category
        let index = item.index
        let remoteIndex = remoteIndexes.find(r => r.category === category).remoteIndex
        return index >= remoteIndex
      })
    })
  })

  let cachedRecs$ = Rx.Observable.from(cache)

*/

  let combinedLog$ = savedRecs$.concat(newLog$)
  let fullLog$ = savedRecs$.concat(mintedLog$)

  let groupedRecs$ = fullLog$
  .groupBy(r => r.category)
  .map(g => g.map((r, i) => R.assoc('index', i, r)))

  groupedRecs$.map(g => g.skipWhile(r => r.saved))
  .subscribe(g =>
    g.subscribe(r => fsp.appendFileSync(categoryLookup[r.category].path,
      JSON.stringify(R.assoc('saved', true, r)) + '\n')
    )
  )

  newLog$.startWith(0).debounce(1000)
  .flatMap(() => currentLogIndexes(categories))
  .flatMap(remoteIndexes => {
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
  // .tap(pp)
  .flatMap(r => batchWriteItem(r))
  .subscribe()

  savedRecs$.connect()

  return combinedLog$
}

/*
import pp from '../lib/pp'

let cats = [
  {code: 'transactions', path: '/tmp/transactions.dat', tableName: 'Transactions'}
]

let EventEmitter = require('events').EventEmitter
let emitter = new EventEmitter()

let newLog$ = Rx.Observable.fromEvent(emitter, 'log')

let key$ = Rx.Observable.just({
  material: new Buffer([ 197, 132, 27, 114, 98, 251, 79, 5, 34, 77, 5, 157, 26, 215, 183, 72 ]),
  id: 'transactions:0'
})
init('990685c8-80e4-4344-b6d1-bd288f031b2f', cats, newLog$, key$)

setTimeout(function () {
  emitter.emit('log', {category: 'transactions', data: {tx: 8888}})
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
