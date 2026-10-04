import { describe, expect, it } from 'vitest'
import { canOpenRepo, hasMissingDirectory, isRepoUsable } from './repo-usability'

describe('hasMissingDirectory', () => {
  it('is true only when the server measured the directory and said no', () => {
    expect(hasMissingDirectory({ cloneStatus: 'ready', directoryExists: false })).toBe(true)
  })

  it('is false when the directory is there', () => {
    expect(hasMissingDirectory({ cloneStatus: 'ready', directoryExists: true })).toBe(false)
  })

  it('is false when the field is absent, because an older backend did not measure it', () => {
    // Getting this backwards locks every user on an un-upgraded backend out of
    // every project, on the strength of a field that was never sent.
    expect(hasMissingDirectory({ cloneStatus: 'ready' })).toBe(false)
    expect(hasMissingDirectory({ cloneStatus: 'ready', directoryExists: undefined })).toBe(false)
  })

  it('does not care what cloneStatus says', () => {
    // The whole defect: cloneStatus said ready and the directory was gone.
    expect(hasMissingDirectory({ cloneStatus: 'ready', directoryExists: false })).toBe(true)
    expect(hasMissingDirectory({ cloneStatus: 'error', directoryExists: true })).toBe(false)
  })
})

describe('isRepoUsable', () => {
  it('needs both a finished clone and a directory that is there', () => {
    expect(isRepoUsable({ cloneStatus: 'ready', directoryExists: true })).toBe(true)
    expect(isRepoUsable({ cloneStatus: 'ready', directoryExists: false })).toBe(false)
    expect(isRepoUsable({ cloneStatus: 'cloning', directoryExists: true })).toBe(false)
  })

  it('assumes a directory is there when the backend did not say otherwise', () => {
    expect(isRepoUsable({ cloneStatus: 'ready' })).toBe(true)
  })
})

describe('canOpenRepo', () => {
  it('opens a repository whose directory is gone, because that is where the path gets named', () => {
    // Blocking the click would hide the only screen that explains the problem.
    expect(canOpenRepo({ cloneStatus: 'ready', directoryExists: false })).toBe(true)
  })

  it('does not open a repository that is still being cloned', () => {
    expect(canOpenRepo({ cloneStatus: 'cloning', directoryExists: false })).toBe(false)
    expect(canOpenRepo({ cloneStatus: 'error' })).toBe(false)
  })
})
