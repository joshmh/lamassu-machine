'use strict'

const machina = require('machina')
const frameFsm = require('id003-frame-fsm')

const fsm = new machina.Fsm({
  initialState: 'Uninitialized',
  states: {
    Uninitialized: {
      // POWER_UP -> Initializing -> Boot Sequence -> Disable (Idle)
      // Use another child FSM for boot sequence
      Reset: {
        _child: frameFsm,
        _onEnter: () => {
          startBootTimer()
          fsm.handle('command', 'reset')
        },
        RequestTimeout: () => fsm.emit('error', new Error('Timeout')),
        Initialize: dispatch('')
        _onExit: clearTimer
      }
    },
    Idle: {
      _child: frameFsm
      ENQ: () => fsm.emit('send', 'status'),
      Command:,

    }
  }
})

function startBootTimer () {
  fsm.timerId = setTimeout(() => fsm.handle('RequestTimeout'), 5000)
}

function startTimer () {
  fsm.timerId = setTimeout(() => fsm.handle('RequestTimeout'), 3000)
}

function clearTimer () {
  clearTimeout(fsm.timerId)
}

module.exports = fsm
