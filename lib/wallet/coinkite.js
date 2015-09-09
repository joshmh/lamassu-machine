const Rx = require('rx')
const Coinkite = require('coinkite-javascript')
const {requestStream} = require('../http/client')

const API_KEY = 'Kc74a9aa7-5617c635-c8800d839e47f9a7'
const API_SECRET = 'Sfc4db316-1c4f3b1c-903624a0c137181d'

let accountId = 'DC16C2843B-6CEFDD'

/* TODO: trigger on bitcoin send */
exports.balance = function balance () {
  let interval$ = Rx.Observable.interval(60000).startWith(0)

  return interval$
  .flatMap(() => {
    let endpoint = '/v1/account/' + accountId
    let uri = 'https://api.coinkite.com' + endpoint
    let headers = Coinkite.auth_headers(API_KEY, API_SECRET, endpoint)
    return requestStream({
      headers: headers,
      uri: uri,
      json: true
    })
  })
  .map(r => r.body.account.balance.integer)
}

const newAddress$ = Rx.Observable.just(1).flatMap(() => {
  let endpoint = '/v1/new/receive'
  let uri = 'https://api.coinkite.com' + endpoint
  let headers = Coinkite.auth_headers(API_KEY, API_SECRET, endpoint)
  return requestStream({
    method: 'PUT',
    headers: headers,
    uri: uri,
    json: true,
    body: {account: accountId}
  })
  .map(r => r.body)
})

exports.send = function send (address, amount) {
  let amountBTC = amount / 1e8
  console.log(amountBTC)
  return Rx.Observable.just(1).flatMap(() => {
    let endpoint = '/v1/new/send'
    let uri = 'https://api.coinkite.com' + endpoint
    let headers = Coinkite.auth_headers(API_KEY, API_SECRET, endpoint)
    return requestStream({
      headers: headers,
      uri: uri,
      json: true,
      method: 'PUT',
      body: {
        amount: amountBTC,
        account: accountId,
        dest: address
      }
    })
  })
  .map(r => r.body)
  .flatMap(r => {
    let endpoint = r.next_step
    let uri = 'https://api.coinkite.com' + endpoint
    let headers = Coinkite.auth_headers(API_KEY, API_SECRET, endpoint)
    return requestStream({
      method: 'PUT',
      headers: headers,
      uri: uri,
      json: true
    })
  })
  .map(() => true)
}

const detail$ = Rx.Observable.just(1).flatMap(() => {
  let endpoint = '/v1/detail/' + 'B6E5DE9B13-A00DC0'
  let uri = 'https://api.coinkite.com' + endpoint
  let headers = Coinkite.auth_headers(API_KEY, API_SECRET, endpoint)
  return requestStream({
    headers: headers,
    uri: uri,
    json: true
  })
})
.map(r => r.body)

/*
let pp = require('../pp')
detail$.subscribe(
  (r) => pp(r),
  (err) => console.log(err),
  () => console.log('completed')
)
*/
