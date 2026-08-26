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
  const normalizedGuess = normalizeAnswer(guess);
  if (!normalizedGuess) return false;
  return [answer, ...aliases].some((candidate) => {
    const normalizedCandidate = normalizeAnswer(candidate);
    if (normalizedGuess === normalizedCandidate) return true;
    return oneTokenTypoApart(normalizedGuess, normalizedCandidate);
  });
}

function normalizeAnswer(value: string): string {
  return normalizeGuess(value)
    .split(" ")
    .filter((token) => token !== "a" && token !== "an" && token !== "the")
    .join(" ");
}

function sharedPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let length = 0;
  while (length < limit && left[length] === right[length]) length += 1;
  return length;
}

function oneTokenTypoApart(left: string, right: string): boolean {
  const leftTokens = left.split(" ");
  const rightTokens = right.split(" ");
  if (leftTokens.length !== rightTokens.length) return false;

  const differences = leftTokens
    .map((token, index) => [token, rightTokens[index]!] as const)
    .filter(([leftToken, rightToken]) => leftToken !== rightToken);
  if (differences.length !== 1) return false;

  const [leftToken, rightToken] = differences[0]!;
  if (Math.min(leftToken.length, rightToken.length) < 5 || !oneEditApart(leftToken, rightToken)) {
    return false;
  }

  return sharedPrefixLength(leftToken, rightToken) >= 2;
}

const CLOSE_STOP_WORDS = new Set(["a", "an", "the", "of", "on", "in", "at", "to", "for", "with", "and"]);

function conceptTokens(value: string): string[] {
  return normalizeGuess(value)
    .split(" ")
    .filter((token) => token.length > 0 && !CLOSE_STOP_WORDS.has(token));
}

function relatedConcept(left: string, right: string): boolean {
  if (left === right) return true;
  const shorterLength = Math.min(left.length, right.length);
  if (shorterLength < 4) return false;

  let prefixLength = 0;
  while (prefixLength < shorterLength && left[prefixLength] === right[prefixLength]) {
    prefixLength += 1;
  }
  return prefixLength >= 4 && prefixLength / shorterLength >= 0.75;
}

function matchesCandidate(guessTokens: readonly string[], candidateTokens: readonly string[]): boolean {
  const used = new Set<number>();
  for (const guessToken of guessTokens) {
    const matchIndex = candidateTokens.findIndex(
      (candidateToken, index) => !used.has(index) && relatedConcept(guessToken, candidateToken),
    );
    if (matchIndex === -1) return false;
    used.add(matchIndex);
  }
  return true;
}

/**
 * Detects a conservative near miss without revealing which concept is absent.
 * Correct guesses remain the responsibility of isGuessCorrect.
 */
export function isGuessClose(
  guess: string,
  answer: string,
  aliases: readonly string[] = [],
): boolean {
  const normalizedGuess = normalizeGuess(guess);
  if (!normalizedGuess || isGuessCorrect(normalizedGuess, answer, aliases)) return false;

  const guessTokens = conceptTokens(normalizedGuess);
  const answerTokens = conceptTokens(answer);
  if (guessTokens.length === 0 || answerTokens.length === 0) return false;

  if (guessTokens.length === 1) {
    const [guessToken] = guessTokens;
    if (answerTokens.length > 1) {
      return guessToken!.length >= 5 && guessToken === answerTokens[0];
    }
    const [answerToken] = answerTokens;
    return (
      guessToken!.length >= 4 &&
      answerToken!.startsWith(guessToken!) &&
      answerToken!.length - guessToken!.length <= 5
    );
  }

  const subject = answerTokens[0]!;
  if (!guessTokens.some((token) => relatedConcept(token, subject))) return false;

  return [answer, ...aliases].some((candidate) => {
    const candidateTokens = conceptTokens(candidate);
    if (candidateTokens.length < guessTokens.length) return false;
    if (!matchesCandidate(guessTokens, candidateTokens)) return false;
    return candidateTokens.length - guessTokens.length <= 1;
  });
}
