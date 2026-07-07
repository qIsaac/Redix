/**
 * Format display value — escape control characters for visible display.
 */
export function formatDisplayValue(value: string): string {
  return value.replace(/[\x00-\x1F\x7F]/g, (char) => {
    const code = char.charCodeAt(0)
    return `\\u${code.toString(16).padStart(4, '0')}`
  })
}

/**
 * Check if a character is a control character.
 */
export function isControlChar(char: string): boolean {
  const code = char.charCodeAt(0)
  return (code >= 0 && code <= 0x1f) || code === 0x7f
}

export function formatBinarySummary(length?: number, previewLength?: number): string {
  const total = length ?? 0
  const preview = previewLength ?? total
  return `binary-data(length=${total}, preview=${preview} bytes)`
}
