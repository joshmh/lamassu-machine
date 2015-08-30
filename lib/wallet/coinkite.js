import Rx from 'rx'
import Coinkite from 'coinkite-javascript'
import {requestStream} from '../http/client'

const API_KEY = 'Kc74a9aa7-5617c635-c8800d839e47f9a7'
const API_SECRET = 'Sfc4db316-1c4f3b1c-903624a0c137181d'

let accountId = 'DC16C2843B-6CEFDD'

let balance$ = Rx.Observable.interval(3000).flatMap(() => {
  let endpoint = '/v1/account/' + accountId
  let uri = 'https://api.coinkite.com' + endpoint
  let headers = Coinkite.auth_headers(API_KEY, API_SECRET, endpoint)
  return requestStream({
    headers: headers,
    uri: uri,
    json: true
  })
  .map(r => r.body).map(r => r.account.balance_optimistic.decimal)
})

let newAddress$ = Rx.Observable.just(1).flatMap(() => {
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

let send$ = Rx.Observable.just(1).flatMap(() => {
  let endpoint = '/v1/new/send'
  let uri = 'https://api.coinkite.com' + endpoint
  let headers = Coinkite.auth_headers(API_KEY, API_SECRET, endpoint)
  return requestStream({
    headers: headers,
    uri: uri,
    json: true,
    method: 'PUT',
    body: {
      amount: '0.001',
      account: accountId,
      dest: '19fbgq45auyQNkSNgubD34f4qNeW4Acxrt'
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
.map(r => r.body)

newAddress$.subscribe(
  (r) => console.log(r),
  (err) => console.log(err),
  () => console.log('completed')
)
