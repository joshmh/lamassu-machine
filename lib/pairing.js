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
  const pairingRecordId = rcrypto.hkdf(otp, 'pairing-record-id-1-1')
  const key = rcrypto.hkdf(otp, 'pairing-key-1-1')
  const cipherRec = rcrypto.encrypt(rec.pubkey, key)

  return raqia.registerPairing(R.merge(cipherRec, {
    recordId: uuid.unparse(pairingRecordId)
  }))
  .toPromise()
}

exports.fetchDeviceRecord = function fetchDeviceRecord (otp, privkey) {
  const pairingRecordId = rcrypto.hkdf(otp, 'pairing-record-id-2-1')
  const key = rcrypto.hkdf(otp, 'pairing-key-2-1')
  return Rx.Observable.interval(3000)
  .concatMap(() => raqia.fetchPairing(uuid.unparse(pairingRecordId), key))
  .takeWhile((r, i) => r && i < 60)
  .toPromise()
}

exports.sendEncryptedNonce = function sendEncryptedNonce (otp, nonce, ltk) {
  const key = rcrypto.hkdf(ltk, 'pairing-key')
  const cipherRec = rcrypto.encrypt(nonce, key)
  const pairingRecordId = rcrypto.hkdf(otp, 'pairing-record-id-1-2')

  return raqia.registerPairing(R.merge(cipherRec, {
    recordId: uuid.unparse(pairingRecordId)
  }))
  .toPromise()
}

exports.registerDeviceOtp = function registerDeviceOtp (otp, machineId) {
  const recordId = uuid.unparse(rcrypto.hkdf(otp, 'otp-record-id'))
  const nonce = rcrypto.hkdf(otp, 'otp-nonce').toString('hex')

  return raqia.registerDeviceOtp(machineId, recordId, nonce).toPromise()
  .then(() => nonce)
}
