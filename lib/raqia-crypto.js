const crypto = require('crypto')
const ursa = require('ursa')

const ALGO = 'aes-128-gcm'
const RSA_KEY_LENGTH = 4096 // See http://www.keylength.com/en/compare/
const VERSION_BUF = new Buffer(2)
const SALT = 'ENSmF2YdAgcaxPgaiNWD5w=='
VERSION_BUF.writeUInt16LE(0x1)

function encrypt (buf, key) {
  var iv = crypto.randomBytes(12)
  var cipher = crypto.createCipheriv(ALGO, key, iv)
  var encrypted = cipher.update(buf)
  encrypted = Buffer.concat([encrypted, cipher.final()])
  var tag = cipher.getAuthTag()

  var len = 16 + encrypted.length
  return {
    version: 0,
    iv: iv,
    ciphertext: Buffer.concat([encrypted, tag], len)
  }
}

function decrypt (rec, key) {
  var ciphertext = rec.ciphertext
  var tag = ciphertext.slice(-16)
  var iv = rec.iv
  var content = ciphertext.slice(0, -16)
  var decipher = crypto.createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  var dec = decipher.update(content)
  dec += decipher.final()
  return dec
}

function publicEncrypt (buf, key) {
  return crypto.publicEncrypt(key, buf)
}

function privateDecrypt (enc, key) {
  return crypto.privateDecrypt(key, enc)
}

function sign (buf, key) {
  const s = crypto.createSign('RSA-SHA384')
  s.update(buf)
  return s.sign(key)
}

// *generation* is the 2 byte serial number of the generation of the key
function generateKey (generation) {
  var key = new Buffer(18)
  key.writeUInt16LE(generation)
  crypto.randomBytes(16).copy(key, 2)
  return key
}

function extractGeneration (key) {
  return key.readUInt16LE(key)
}

function generateKeyPair () {
  var privkey = ursa.generatePrivateKey(RSA_KEY_LENGTH)
  return {
    privkey: privkey.toPrivatePem().toString(),
    pubkey: privkey.toPublicPem().toString()
  }
}

// Implements a specific case of HKDF, for SHA-256 and 128 bit key
function hkdf (master, index) {
  let prk = crypto
  .createHmac('sha256', SALT)
  .update(master)
  .digest()

  let okm = crypto
  .createHmac('sha256', prk)
  .update(Buffer.concat([new Buffer(index), new Buffer([0x01])]))
  .digest()

  return okm.slice(0, 16)
}

// Return a 128 bit hash
function hash (buf) {
  return crypto.createHash('SHA384').update(buf).digest().slice(0, 16)
}

/*
let master = crypto.randomBytes(32)
let salt = crypto.randomBytes(32)
let index = new Buffer([0x0, 0x0, 0x0, 0x0])
console.log(hkdf(master, salt, index).toString('hex'))
*/

module.exports = {
  generateKey: generateKey,
  encrypt: encrypt,
  decrypt: decrypt,
  generateKeyPair: generateKeyPair,
  publicEncrypt: publicEncrypt,
  privateDecrypt: privateDecrypt,
  sign: sign,
  hash: hash,
  extractGeneration: extractGeneration,
  hkdf: hkdf
}
