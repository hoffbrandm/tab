/** Shared normalisation, tokenisation and fuzzy phrase scoring. */

const STOPWORDS = new Set("a an the some any our my your his her their this that these those of for to and or with is are was were be been it its them they there here please just spare extra new old more".split(" "));

export function normalise(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/&/g, " and ")
    .replace(/[“”"()[\]{}*_#@~^|\\/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function singular(word) {
  if (word.length <= 3) return word;
  if (/ies$/.test(word) && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(ches|shes|xes|sses|zzes)$/.test(word)) return word.slice(0, -2);
  if (/ves$/.test(word) && word.length > 5) return `${word.slice(0, -3)}f`;
  if (/[^su]s$/.test(word)) return word.slice(0, -1);
  return word;
}

export function tokens(text) {
  return normalise(text)
    .replace(/[^a-z0-9' -]/g, " ")
    .replace(/-/g, " ")
    .split(" ")
    .map((word) => word.replace(/^'+|'+$/g, "").replace(/'s$/, ""))
    .filter((word) => word && !STOPWORDS.has(word))
    .map(singular);
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

export function wordSimilarity(a, b) {
  if (a === b) return 1;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) {
    return Math.min(a.length, b.length) >= 4 ? 0.9 : 0.75;
  }
  if (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))) return 0.8;
  const longest = Math.max(a.length, b.length);
  if (longest < 4) return 0;
  const ratio = 1 - levenshtein(a, b) / longest;
  return ratio >= 0.74 ? ratio * 0.9 : 0;
}

export function phraseScore(said, name) {
  const q = Array.isArray(said) ? said : tokens(said);
  const n = Array.isArray(name) ? name : tokens(name);
  if (!q.length || !n.length) return 0;
  if (q.join(" ") === n.join(" ")) return 1;
  const best = (word, pool) => pool.reduce((top, other) => Math.max(top, wordSimilarity(word, other)), 0);
  const coverQ = q.reduce((sum, word) => sum + best(word, n), 0) / q.length;
  const coverN = n.reduce((sum, word) => sum + best(word, q), 0) / n.length;
  return Math.min(0.99, 0.7 * coverQ + 0.3 * coverN);
}