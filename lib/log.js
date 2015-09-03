import fsp from 'fs-promise'
// import pp from '../lib/pp'
import Rx from 'rx'
import {lastLogs} from './raqia-client'

// import R from 'ramda'

let categories = {}
let machineId

function init (_machineId, _categories) {
  machineId = machineId
  let promises = _categories.map(cat => nextRecord(cat.path))

  return Promise.all(promises).then(results => {
    results.forEach((res, i) => {
      let cat = _categories[i]
      categories[cat.code] = {path: cat.path, index: res}
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

function sync () {
  // encrypt (lower priority)
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
  {category: 'test', data: {test: 123}},
  {category: 'transactions', data: {tx: 12345}}
])

init('990685c8-80e4-4344-b6d1-bd288f031b2f', cats)
.then(() => console.dir(categories))
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
