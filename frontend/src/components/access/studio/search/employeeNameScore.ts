/** Same acceptance threshold as extraction_service._MATCH_THRESHOLD. */
export const EMPLOYEE_NAME_MATCH_THRESHOLD = 70

// Python sorts Unicode strings by code point, not JavaScript's UTF-16 units.
function compareTokens(left: string, right: string): number {
  let leftIndex = 0
  let rightIndex = 0
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftPoint = left.codePointAt(leftIndex)!
    const rightPoint = right.codePointAt(rightIndex)!
    if (leftPoint !== rightPoint) return leftPoint - rightPoint
    leftIndex += leftPoint > 0xffff ? 2 : 1
    rightIndex += rightPoint > 0xffff ? 2 : 1
  }
  return (leftIndex < left.length ? 1 : 0) - (rightIndex < right.length ? 1 : 0)
}

function sortedTokens(text: string): string {
  // Match RapidFuzz's native utils.hpp/UnicodeDefaultProcess: non-alphanumeric
  // -> space, then simple per-code-point lowercase (including İ -> i).
  // Native processing removes underscores, unlike the optional Python fallback.
  const processed = text
    .replace(/[^\p{L}\p{N}]/gu, ' ')
    .replace(/[\p{L}\p{N}]/gu, (character) =>
      String.fromCodePoint(character.toLowerCase().codePointAt(0)!),
    )
    .trim()
  return processed ? processed.split(/\s+/).sort(compareTokens).join(' ') : ''
}

/**
 * Client-side port of the existing employee scorer, not a new scoring model:
 * backend/app/services/extraction_service.py::_name_scores uses RapidFuzz's
 * token_sort_ratio(processor=utils.default_process), then takes the best EN/AR
 * score. This primitive scores one string; the caller retains that max rule.
 *
 * Token-sort ratio is normalized Indel similarity, i.e. substitutions cost two:
 * https://rapidfuzz.github.io/RapidFuzz/Usage/fuzz.html#token-sort-ratio
 * Search normalization and numeric-query exclusion belong to the caller.
 */
export function employeeNameScore(query: string, candidate: string): number {
  const left = Array.from(sortedTokens(query))
  const right = Array.from(sortedTokens(candidate))
  const lengthSum = left.length + right.length
  if (lengthSum === 0) return 100
  if (left.length === 0 || right.length === 0) return 0

  const shorter = left.length <= right.length ? left : right
  const longer = left.length <= right.length ? right : left
  // One dynamic-programming row gives the longest common subsequence using
  // O(min(query length, candidate length)) storage, including Unicode names.
  const row = new Uint32Array(shorter.length + 1)
  for (const character of longer) {
    let diagonal = 0
    for (let index = 1; index <= shorter.length; index += 1) {
      const previous = row[index]
      row[index] = character === shorter[index - 1]
        ? diagonal + 1
        : Math.max(previous, row[index - 1])
      diagonal = previous
    }
  }

  const distance = lengthSum - 2 * row[shorter.length]
  return (1 - distance / lengthSum) * 100
}
