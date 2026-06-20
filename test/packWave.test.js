// test/packWave.test.js
const test = require('node:test')
const assert = require('node:assert')
const { packWave } = require('../src/lib/packWave')

test('disjoint candidates all pack up to cap', () => {
  const c = [
    { key: 'a', surface: ['apps/api/src/foo/x.ts'] },
    { key: 'b', surface: ['apps/web/src/bar/y.tsx'] },
  ]
  const { wave, held } = packWave(c, 4)
  assert.deepStrictEqual(wave.map(x => x.key), ['a', 'b'])
  assert.deepStrictEqual(held, [])
})

test('overlapping directories are held, not packed', () => {
  const c = [
    { key: 'a', surface: ['apps/api/src/foo/x.ts'] },
    { key: 'b', surface: ['apps/api/src/foo/y.ts'] }, // same dir as a
  ]
  const { wave, held } = packWave(c, 4)
  assert.deepStrictEqual(wave.map(x => x.key), ['a'])
  assert.deepStrictEqual(held.map(x => x.key), ['b'])
})

test('cap limits wave size even when all disjoint', () => {
  const c = [
    { key: 'a', surface: ['d1/x'] },
    { key: 'b', surface: ['d2/x'] },
    { key: 'c', surface: ['d3/x'] },
  ]
  const { wave, held } = packWave(c, 2)
  assert.deepStrictEqual(wave.map(x => x.key), ['a', 'b'])
  assert.deepStrictEqual(held.map(x => x.key), ['c'])
})

test('a candidate touching two dirs blocks anything overlapping either', () => {
  const c = [
    { key: 'a', surface: ['d1/x', 'd2/y'] },
    { key: 'b', surface: ['d2/z'] }, // overlaps d2
    { key: 'c', surface: ['d3/w'] }, // disjoint
  ]
  const { wave, held } = packWave(c, 4)
  assert.deepStrictEqual(wave.map(x => x.key), ['a', 'c'])
  assert.deepStrictEqual(held.map(x => x.key), ['b'])
})

test('root-level file reduces to "." directory and overlaps other root files', () => {
  const c = [
    { key: 'a', surface: ['README.md'] },
    { key: 'b', surface: ['LICENSE'] }, // both reduce to "."
  ]
  const { wave, held } = packWave(c, 4)
  assert.deepStrictEqual(wave.map(x => x.key), ['a'])
  assert.deepStrictEqual(held.map(x => x.key), ['b'])
})
