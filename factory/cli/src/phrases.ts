// Whether one text copies another: the round check (a findings file copying the build notes) and
// the seal's prompt check (a prompt quoting sealed material) judge it the same way.

/** How many words in a row two texts share to count as copied. */
export const COPIED_WORDS = 8

const words = (text: string) => text.toLowerCase().split(/\s+/).filter(Boolean)

/**
 * The first run of at least `n` consecutive words `text` shares with `source`, extended as far as
 * both go on alike; case and whitespace don't count. Null when they share no such run.
 */
export function sharedPhrase(text: string, source: string, n: number): string | null {
  const ours = words(text)
  const theirs = words(source)
  const starts = new Map<string, number[]>()
  for (let j = 0; j + n <= theirs.length; j++) {
    const key = theirs.slice(j, j + n).join(' ')
    starts.set(key, [...(starts.get(key) ?? []), j])
  }
  for (let i = 0; i + n <= ours.length; i++) {
    const found = starts.get(ours.slice(i, i + n).join(' '))
    if (!found) continue
    const length = Math.max(
      ...found.map((j) => {
        let k = n
        while (i + k < ours.length && j + k < theirs.length && ours[i + k] === theirs[j + k]) k++
        return k
      }),
    )
    return ours.slice(i, i + length).join(' ')
  }
  return null
}
