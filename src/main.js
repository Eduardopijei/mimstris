import _cloneDeep from 'lodash/fp/cloneDeep'
import _random from 'lodash/fp/random'

import React from 'react'
import ReactDOM from 'react-dom'

import pressed from 'pressed'
pressed.start()

import config from './config'
import pieces from './pieces'
import { detectCollision as detectMatrixCollision, getFullRows } from './matrixUtil'

import store from './store'
import * as score from './stores/score'
import * as lines from './stores/lines'
import * as level from './stores/level'
import * as fallRate from './stores/fallRate'
import * as nextPiece from './stores/nextPiece'
import * as currentPiece from './stores/currentPiece'
import * as board from './stores/board'
import * as gameState from './stores/gameState'

const wrapGetter = getter => getter(store.getState())
const getCurrentPiece = () => wrapGetter(currentPiece.getCurrentPiece)
const getBoard = () => wrapGetter(board.getBoard)
const getNextPiece = () => wrapGetter(nextPiece.getNextPiece)
const getLevel = () => wrapGetter(level.getLevel)
const getFallRate = () => wrapGetter(fallRate.getFallRate)
const getGameState = () => wrapGetter(gameState.getGameState)

import App from './containers/App'

const DOWN_KEYS = ['down', 's']
const LEFT_KEYS = ['left', 'a']
const RIGHT_KEYS = ['right', 'd']
const ROTATE_LEFT_KEYS = ['/', 'z']
const ROTATE_RIGHT_KEYS = ['shift']
const START_KEYS = ['enter']

let lateralMovementRate = null // Rate of pieces moving by user control in steps per second
let downMovementRate = null // Rate of pieces moving down by user control in steps per second
let timeSincePieceLastFell = 0 // time since the piece last moved down automatically
let lastFrameTime = 0 // previous frame's current time
let lastRightMove = 0
let lastLeftMove = 0
let lastDownMove = 0
let lastRotate = 0

// Main executable code:
reset()
window.requestAnimationFrame(onFrame)
ReactDOM.render(<App />, document.getElementById('app'))
//

function onFrame (currentTime) {
  update(currentTime)

  window.requestAnimationFrame(onFrame)
}

// Automatically pause when window is out of focus
window.onblur = (e) => {
  const currentGameState = getGameState()
  if (currentGameState === gameState.GAME_STATE_RUNNING) {
    pauseGame()

    // Unpause when it comes back to focus (but not if the user manually paused)
    window.onfocus = (e) => {
      unpauseGame()
      window.onfocus = null
    }
  }
}

function reset () {
  timeSincePieceLastFell = 0
  lastFrameTime = 0
  lateralMovementRate = config.lateralMovementRate
  downMovementRate = config.downMovementRate

  store.dispatch(board.resetBoard())
  store.dispatch(score.resetScore())
  const {currentPiece: newCurrentPiece, nextPiece: randomNextPiece} = spawnNextAndCurrentPieces()
  store.dispatch(currentPiece.setCurrentPiece(newCurrentPiece))
  store.dispatch(nextPiece.setNextPiece(randomNextPiece))

  store.dispatch(gameState.setGameState(gameState.GAME_STATE_RUNNING))
}

function pauseGame () {
  store.dispatch(gameState.setGameState(gameState.GAME_STATE_PAUSED))
}
function unpauseGame () {
  store.dispatch(gameState.setGameState(gameState.GAME_STATE_RUNNING))
}

function update (currentTime) {
  let deltaTime = currentTime - lastFrameTime
  lastFrameTime = currentTime
  let currentGameState = getGameState()

  if (pressed.some(...START_KEYS)) {
    if (currentGameState === gameState.GAME_STATE_GAME_OVER) {
      reset()
    } else {
      currentGameState === gameState.GAME_STATE_PAUSED ? unpauseGame() : pauseGame()
    }
    pressed.remove(...START_KEYS)
  }

  currentGameState = getGameState()
  if (currentGameState !== gameState.GAME_STATE_RUNNING) {
    return
  }

  if (!getCurrentPiece()) {
    const {currentPiece: newCurrentPiece, nextPiece: newNextPiece} = spawnNextAndCurrentPieces()
    store.dispatch(currentPiece.setCurrentPiece(newCurrentPiece))
    store.dispatch(nextPiece.setNextPiece(newNextPiece))
  }

  const lateralMovementThreshold = Math.ceil(1000 / lateralMovementRate)
  const downMovementThreshold = Math.ceil(1000 / downMovementRate)

  // Handle user input...
  if (pressed.some(...DOWN_KEYS)) {
    if (currentTime - lastDownMove > downMovementThreshold) {
      lastDownMove = currentTime

      if (config.instantDown) {
        while (!detectCollisionBelow(getBoard(), getCurrentPiece())) {
          timeSincePieceLastFell = 0
          makePieceFall(getCurrentPiece())
        }
        pressed.remove(...DOWN_KEYS)
      } else {
        timeSincePieceLastFell = 0
        makePieceFall(getCurrentPiece())
      }
    }
  } else {
    lastDownMove = 0
  }

  if (pressed.some(...LEFT_KEYS)) {
    if (currentTime - lastLeftMove > lateralMovementThreshold) {
      lastLeftMove = currentTime

      movePieceLeft(getCurrentPiece())
    }
  } else {
    lastLeftMove = 0
  }

  if (pressed.some(...RIGHT_KEYS)) {
    if (currentTime - lastRightMove > lateralMovementThreshold) {
      lastRightMove = currentTime
      movePieceRight(getCurrentPiece())
    }
  } else {
    lastRightMove = 0
  }

  if (pressed.some(...ROTATE_LEFT_KEYS, ...ROTATE_RIGHT_KEYS)) {
    if (currentTime - lastRotate > lateralMovementThreshold) {
      lastRotate = currentTime
      if (pressed.some(...ROTATE_LEFT_KEYS)) {
        rotatePieceLeft(getCurrentPiece())
      }
      if (pressed.some(...ROTATE_RIGHT_KEYS)) {
        rotatePieceRight(getCurrentPiece())
      }
    }
  } else {
    lastRotate = 0
  }

  timeSincePieceLastFell += deltaTime

  const currentFallRate = getFallRate()
  const stepThreshold = Math.ceil(1000 / currentFallRate)
  if (timeSincePieceLastFell > stepThreshold) {
    // console.log('tick')
    timeSincePieceLastFell = 0
    makePieceFall(getCurrentPiece())
  }

  if (detectCollision(getBoard(), getCurrentPiece())) {
    // console.log('Collision detected!')

    // This bit of foo allows you to shift the piece around a bit and only
    // detects collisions at the end of the step instead of at the beginning.
    const previousPositionPiece = _cloneDeep(getCurrentPiece())
    previousPositionPiece.y -= 1
    store.dispatch(board.mergePieceIntoBoard(previousPositionPiece))

    const {currentPiece: newCurrentPiece, nextPiece: newNextPiece} = spawnNextAndCurrentPieces()
    store.dispatch(currentPiece.setCurrentPiece(newCurrentPiece))
    store.dispatch(nextPiece.setNextPiece(newNextPiece))

    const currentLevel = getLevel()
    store.dispatch(score.addPieceScore(currentLevel))

    const fullRowIndeces = getFullRows(getBoard())
    const numberOfClearedLines = fullRowIndeces ? fullRowIndeces.length : 0
    if (numberOfClearedLines > 0) {
      const currentLevel = getLevel()
      store.dispatch(score.addClearedLineScore(numberOfClearedLines, currentLevel))
      store.dispatch(lines.incrementLines(numberOfClearedLines))
      store.dispatch(board.clearCompletedLines())
    }

    // If there is still a collision right after a new piece is spawned, the game ends.
    if (detectCollision(getBoard(), getCurrentPiece())) {
      console.error('Game over! Press ENTER to restart.')
      store.dispatch(gameState.setGameState(gameState.GAME_STATE_GAME_OVER))
    }
  }
}

function spawnNextAndCurrentPieces () {
  const [W] = config.boardSize
  let newCurrentPiece
  const nextPieceValue = getNextPiece()

  if (nextPieceValue) {
    newCurrentPiece = clonePiece(nextPieceValue)
  } else {
    newCurrentPiece = clonePiece(getRandomPiece())
  }
  newCurrentPiece.x = Math.floor((W - newCurrentPiece.matrix[0].length) / 2)

  const randomNextPiece = getRandomPiece()

  return {currentPiece: newCurrentPiece, nextPiece: randomNextPiece}
}

function clonePiece (piece) {
  let clonedPiece = _cloneDeep(piece)
  clonedPiece.x = clonedPiece.x || 0
  clonedPiece.y = clonedPiece.y || 0
  return clonedPiece
}

function getRandomPiece () {
  const l = pieces.length
  const i = _random(0, l - 1)
  return pieces[i]
}

function makePieceFall (piece) {
  store.dispatch(currentPiece.movePieceDown())
}

function movePieceLeft (piece) {
  store.dispatch(currentPiece.movePieceLeft(getBoard()))
}

function movePieceRight (piece) {
  store.dispatch(currentPiece.movePieceRight(getBoard()))
}

function rotatePieceRight (piece) {
  store.dispatch(currentPiece.rotateRight(getBoard()))
}

function rotatePieceLeft (piece) {
  store.dispatch(currentPiece.rotateLeft(getBoard()))
}

function detectCollision (board, piece) {
  if (!board) {
    throw new Error('"board" is not defined.')
  }
  if (!piece) {
    throw new Error('"piece" is not defined.')
  }
  const {x, y, matrix} = piece
  return detectMatrixCollision(board, matrix, x, y)
}

function detectCollisionBelow (board, {x, y, matrix: pieceMatrix}) {
  return detectMatrixCollision(board, pieceMatrix, x, y + 1)
}
