'use strict'

const bip39 = require('bip39')
const crypto = require('crypto')

const pairing = require('../lib/pairing')
const rcrypto = require('../lib/raqia-crypto')

const machineId = '82d5b618-80be-4fa0-b09a-5eeee6f7ae4c'
const ecdh = crypto.createECDH('secp521r1')
const pubkey = ecdh.generateKeys('hex')
const otp = rcrypto.hash(pubkey)

pairing.registerDeviceOtp(otp, machineId)
.then(nonce => {
  console.log('nonce: %s', nonce)

  return pairing.register({
    pubkey: pubkey,
    otp: otp
  })
})
.then(() => {
  const mnemonic = bip39.entropyToMnemonic(otp.toString('hex'))
  console.log(mnemonic)
})
.catch(e => console.log(e))
