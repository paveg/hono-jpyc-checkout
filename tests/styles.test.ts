import { describe, expect, it } from 'vitest'
import { renderStyles } from '../src/ui/styles'

describe('renderStyles primaryColor sanitization', () => {
  it('falls back to default when primaryColor is omitted', () => {
    expect(renderStyles({})).toContain('--primary: #1a73e8')
  })

  it('accepts 3-digit hex', () => {
    expect(renderStyles({ primaryColor: '#abc' })).toContain('--primary: #abc')
  })

  it('accepts 6-digit hex', () => {
    expect(renderStyles({ primaryColor: '#1a73e8' })).toContain('--primary: #1a73e8')
  })

  it('accepts 8-digit hex (with alpha)', () => {
    expect(renderStyles({ primaryColor: '#1a73e8ff' })).toContain('--primary: #1a73e8ff')
  })

  it('rejects 2-digit hex (below boundary)', () => {
    const css = renderStyles({ primaryColor: '#ab' })
    expect(css).not.toContain('--primary: #ab;')
    expect(css).toContain('--primary: #1a73e8')
  })

  it('rejects 9-digit hex (above boundary)', () => {
    const css = renderStyles({ primaryColor: '#1a73e8fff' })
    expect(css).not.toContain('--primary: #1a73e8fff')
    expect(css).toContain('--primary: #1a73e8')
  })

  it('accepts rgb()', () => {
    expect(renderStyles({ primaryColor: 'rgb(26, 115, 232)' })).toContain(
      '--primary: rgb(26, 115, 232)',
    )
  })

  it('accepts rgba()', () => {
    expect(renderStyles({ primaryColor: 'rgba(26, 115, 232, 0.8)' })).toContain(
      '--primary: rgba(26, 115, 232, 0.8)',
    )
  })

  it('accepts named color', () => {
    expect(renderStyles({ primaryColor: 'cornflowerblue' })).toContain('--primary: cornflowerblue')
  })

  it('rejects CSS injection via braces', () => {
    const css = renderStyles({ primaryColor: 'red;}body{background:url(x)}//' })
    expect(css).not.toContain('url(x)')
    expect(css).not.toContain(';}')
    expect(css).toContain('--primary: #1a73e8')
  })

  it('rejects whitespace-padded values that could break the rule', () => {
    const css = renderStyles({ primaryColor: ' red ' })
    expect(css).not.toContain('--primary:  red ')
    expect(css).toContain('--primary: #1a73e8')
  })

  it('rejects CSS function call other than rgb/rgba (e.g., url())', () => {
    const css = renderStyles({ primaryColor: 'url(http://evil/x.css)' })
    expect(css).not.toContain('url(http://evil/x.css)')
    expect(css).toContain('--primary: #1a73e8')
  })
})
