const fsp = require('fs-promise')
const R = require('ramda')
const Rx = require('rx')
const raqia = require('./raqia-client')
const rcrypto = require('./raqia-crypto')

const pp = require('../lib/pp')

function fetchLog (category) {
  console.log('DEBUG10: %s', category.path)

  let readPromise = fsp.readFile(category.path, 'utf8')
  .catch(err => {
    if (err.code === 'ENOENT') {
      return fsp.writeFile(category.path, '')
      .then(() => '')
    }
    throw err
  })

  return Rx.Observable.fromPromise(readPromise)
  .flatMap(r =>
    Rx.Observable.from(
      r.split('\n')
      .slice(0, -1)
      .map(JSON.parse)
    )
  )
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
  let res = rcrypto.encrypt(plaintext, key.material)
  return {
    ts: new Date().toISOString(),
    category: rec.category,
    ciphertext: res.ciphertext.toString('base64'),
    iv: res.iv.toString('base64'),
    version: res.version,
    keyId: key.id
  }
}

function notEmpty (r) { return r.length > 0 }

function fetchKey (keyId) {
  return new Buffer([ 197, 132, 27, 114, 98, 251, 79, 5, 34, 77, 5, 157, 26, 215, 183, 72 ])
}

function decryptRecord (r) {
  return {
    category: r.category,
    index: r.index,
    saved: r.saved,
    data: JSON.parse(rcrypto.decrypt({
      ciphertext: new Buffer(r.ciphertext, 'base64'),
      iv: new Buffer(r.iv, 'base64')
    }, fetchKey(r.keyId)))
  }
}

exports.init = function init (machineId, categories, newLog$, key$) {
  let putRequest = R.partial(_putRequest, machineId)
  const categoryLookup = new Map()
  const cache = new Map()

  categories.forEach(r => {
    categoryLookup.set(r.code, {path: r.path, tableName: r.tableName})
    cache.set(r.code, [])
  })

  let savedRecs$ = Rx.Observable.from(categories)
  .flatMap(fetchLog)
  .publish()

  let mintedLog$ = newLog$.withLatestFrom(key$, (a, b) => [a, b])
  .map(([r, key]) => mintRecord(r, key))

  // Encrypted records with timestamp, both saved and new
  let fullLog$ = savedRecs$.concat(mintedLog$)

  // Includes saved and new records, but no indexes or timestamps
  let combinedLog$ = savedRecs$.map(decryptRecord).concat(newLog$)

  let groupedRecs$ = fullLog$
  .groupBy(r => r.category)
  .map(g => g.map((r, i) => R.assoc('index', i, r)))

  // Save to disk
  groupedRecs$.map(g => g.skipWhile(r => r.saved))
  .subscribe(g =>
    g.subscribe(r => fsp.appendFileSync(categoryLookup.get(r.category).path,
      JSON.stringify(R.assoc('saved', true, r)) + '\n')
    )
  )

  // Update cache
  let newCacheUpdate$ = groupedRecs$
  .flatMap(g =>
    g.map(r => {
      cache.get(r.category).push(r)
      return !r.saved
    })
    .filter(R.identity)
  )

  newCacheUpdate$.startWith(0).debounce(1000)
  .flatMap(() => raqia.currentLogIndexes(categories))
  .map(remoteIndexes => {
    return remoteIndexes.map(r => {

      // First prune cache, careful, this is a side-effect
      let subCache = cache.get(r.category)
      let last
      do last = subCache.shift()
      while (last && last.index < r.currentIndex)
      if (last) subCache.unshift(last)

      return [r.category, subCache.map(putRequest)]
    })
    .filter(r => notEmpty(r[1]))
    .map(([category, r]) => {
      return [categoryLookup.get(category).tableName, r]
    })
  })
  .filter(notEmpty)
  .map(r => ({RequestItems: R.fromPairs(r)}))
  .subscribe(r => raqia.batchWriteItem(r).subscribe())

  savedRecs$.connect()

  return combinedLog$
}
