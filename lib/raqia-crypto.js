var crypto = require('crypto')
var ursa = require('ursa')

var ALGO = 'aes-192-gcm'
var RSA_KEY_LENGTH = 3072

function encrypt (obj, key) {
  var plaintext = JSON.stringify(obj)
  var iv = crypto.randomBytes(12)
  var cipher = crypto.createCipheriv(ALGO, key, iv)
  var encrypted = cipher.update(plaintext, 'utf8')
  encrypted = Buffer.concat([encrypted, cipher.final()])
  var tag = cipher.getAuthTag()
  return {
    version: 1,
    content: encrypted.toString('base64'),
    tag: tag.toString('base64'),
    iv: iv.toString('base64')
  }
}

function decrypt (enc, key) {
  var iv = new Buffer(enc.iv, 'base64')
  var tag = new Buffer(enc.tag, 'base64')
  var content = new Buffer(enc.content, 'base64')
  var decipher = crypto.createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  var dec = decipher.update(content, 'binary', 'utf8')
  dec += decipher.final('utf8')
  return JSON.parse(dec)
}

function publicEncrypt (obj, key) {
  var buf = new Buffer(JSON.stringify(obj), 'utf8')
  return crypto.publicEncrypt(key, buf).toString('base64')
}

function privateDecrypt (enc, key) {
  var buf = new Buffer(enc, 'base64')
  return JSON.parse(crypto.privateDecrypt(key, buf))
}

function generateKey () {
  return crypto.randomBytes(24)
}

function generateKeyPair () {
  var privkey = ursa.generatePrivateKey(RSA_KEY_LENGTH, 65537)
  return {
    privkey: privkey.toPrivatePem().toString(),
    pubkey: privkey.toPublicPem().toString()
  }
}

module.exports = {
  generateKey: generateKey,
  encrypt: encrypt,
  decrypt: decrypt,
  generateKeyPair: generateKeyPair,
  publicEncrypt: publicEncrypt,
  privateDecrypt: privateDecrypt
}
