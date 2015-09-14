const R = require('ramda')
const Rx = require('rx')
const crypto = require('crypto')
const rcrypto = require('./raqia-crypto')
const raqia = require('./raqia-client')

/*

Explanation of pairing procedure:

*/

exports.register = function register (rec) {
  const otp = crypto.randomBytes(16)
  const machineId = rec.machineId
  const pairingMachineId = rcrypto.hkdf(otp, 'pairing-machine-id')
  const key = rcrypto.hkdf(otp, 'pairing-key')
  const cipherRec = rcrypto.encrypt(rec.publicKey, key)

  raqia.registerPairing(R.merge(cipherRec, {
    machineId: machineId,
    recordId: pairingMachineId
  }))
  .toPromise()
}

exports.fetchDeviceRecord = function fetchDeviceRecord (machineId, otp) {
  const pairingDeviceId = rcrypto.hkdf(otp, 'pairing-device-id')

  return Rx.Observable.interval(3000)
  .concatMap(() => raqia.fetchPairing(machineId, pairingDeviceId))
  .takeWhile((r, i) => r && i < 60)
  .toPromise()
}
