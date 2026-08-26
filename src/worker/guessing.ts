export function normalizeGuess(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function oneEditApart(left: string, right: string): boolean {
  if (left === right) return false;
  if (Math.abs(left.length - right.length) > 1) return false;

  if (left.length === right.length) {
    const differences: number[] = [];
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) differences.push(index);
      if (differences.length > 2) return false;
    }
    if (differences.length === 1) return true;
    return (
      differences.length === 2 &&
      differences[1] === differences[0]! + 1 &&
      left[differences[0]!] === right[differences[1]!] &&
      left[differences[1]!] === right[differences[0]!]
    );
  }

  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  let shortIndex = 0;
  let longIndex = 0;
  let skipped = false;
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1;
      longIndex += 1;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    longIndex += 1;
  }
  return true;
}

export function isGuessCorrect(
  guess: string,
  answer: string,
  aliases: readonly string[] = [],
): boolean {
  const normalizedGuess = normalizeGuess(guess);
  if (!normalizedGuess) return false;
  return [answer, ...aliases].some((candidate) => {
    const normalizedCandidate = normalizeGuess(candidate);
    if (normalizedGuess === normalizedCandidate) return true;
    return normalizedCandidate.length >= 5 && oneEditApart(normalizedGuess, normalizedCandidate);
  });
}
