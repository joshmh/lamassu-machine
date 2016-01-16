'use strict'

const machina = require('machina')
const crc = require('../crc')

const SYNC = 0xfc

const fsm = new machina.Fsm({
  initialState: 'Idle',
  states: {
    Idle: {
      SYNC: 'DataLength', // Wait for ENQ
      Request: 'Pending'
    },
    Pending: {
      _onEnter: startTimer,
      SYNC: 'DataLength', // Wait for request/response
      _onExit: clearTimer
    },
    DataLength: {
      _onEnter: startTimer,
      Data: byte => {
        fsm.dataLength = new Buffer([byte]).readUInt8(0)
        fsm.data = new Buffer(fsm.dataLength)
        fsm.data[0] = SYNC
        fsm.data[1] = byte
        fsm.pointer = 2
        fsm.transition('DataBody')
      },
      _onExit: clearTimer
    },
    DataBody: {
      _onEnter: startTimer,
      Data: byte => {
        fsm.data[fsm.pointer++] = byte
        if (fsm.pointer === fsm.dataLength) fsm.transition('CRC_Check')
      },
      _onExit: clearTimer
    },
    CRC_Check: {
      _onEnter: () => {
        const buf = fsm.data.slice(0, fsm.dataLength - 2)
        const crcBuf = fsm.data.slice(fsm.dataLength - 2)
        const frame = buf.slice(2)
        const computedCrc = crc.compute(buf)

        if (crcBuf.readUInt16LE(0) === computedCrc) {
          fsm.handle('Frame', frame)
          return
        }

        console.log('DEBUG2: CRC failure')
        fsm.handle('LineError')
      }
    }
  }
})

function startTimer () {
  fsm.timerId = setTimeout(() => fsm.handle('Timeout'), 200)
}

function clearTimer () {
  clearTimeout(fsm.timerId)
}

module.exports = fsm
