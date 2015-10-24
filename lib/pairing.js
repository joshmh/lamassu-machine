const R = require('ramda')
const Rx = require('rx')
const rcrypto = require('./raqia-crypto')
const raqia = require('./raqia-client')
const uuid = require('node-uuid')

/*

Explanation of pairing procedure:

*/

exports.register = function register (rec) {
  const otp = rec.otp
  const pairingMachineId = rcrypto.hkdf(otp, 'pairing-machine-id')
  const key = rcrypto.hkdf(otp, 'pairing-key')
  const payload = {
    machineId: rec.machineId,
    nonce: rec.nonce.toString('base64')
  }
  const json = JSON.stringify(payload)
  const signature = rcrypto.sign(json, rec.privkey)
  const plainRec = {
    json: json,
    sig: signature.toString('base64'),
    pubkey: rec.pubkey.toString('base64')
  }
  const cipherRec = rcrypto.encrypt(JSON.stringify(plainRec), key)

  return raqia.registerPairing(R.merge(cipherRec, {
    recordId: uuid.unparse(pairingMachineId)
  }))
  .toPromise()
}

exports.fetchDeviceRecord = function fetchDeviceRecord (machineId, otp, privkey) {
  const pairingDeviceId = uuid.unparse(rcrypto.hkdf(otp, 'pairing-device-id'))
  const key = rcrypto.hkdf(otp, 'pairing-key')
  return Rx.Observable.interval(3000)
  .concatMap(() => raqia.fetchPairing(machineId, pairingDeviceId, key, privkey))
  .takeWhile((r, i) => r && i < 60)
  .toPromise()
}
