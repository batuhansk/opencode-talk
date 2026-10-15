// Rule-based cleanup for spoken coding prompts. No network, no LLM.

export const DEFAULT_VOCAB = {
  jason: "JSON",
  "j son": "JSON",
  json: "JSON",
  yaml: "YAML",
  "yam l": "YAML",
  bullion: "boolean",
  "get hub": "GitHub",
  github: "GitHub",
  "git lab": "GitLab",
  "type script": "TypeScript",
  typescript: "TypeScript",
  "java script": "JavaScript",
  javascript: "JavaScript",
  "node js": "Node.js",
  "node.js": "Node.js",
  "next js": "Next.js",
  "cube control": "kubectl",
  "cube cuddle": "kubectl",
  "coop control": "kubectl",
  kubernetes: "Kubernetes",
  "open code": "OpenCode",
  opencode: "OpenCode",
  "read me": "README",
  readme: "README",
  "pull request": "pull request",
  "p r": "PR",
  api: "API",
  apis: "APIs",
  url: "URL",
  sql: "SQL",
  css: "CSS",
  html: "HTML",
  cli: "CLI",
  "sea ally": "CLI",
  npm: "npm",
  "dot env": ".env",
  "std in": "stdin",
  "std out": "stdout",
  regex: "regex",
  "reg ex": "regex",
  postgres: "Postgres",
  "post gress": "Postgres",
  graphql: "GraphQL",
  "graph q l": "GraphQL",
  async: "async",
  "a sink": "async",
  enum: "enum",
  "e num": "enum",
  "to do": "TODO",
  todo: "TODO",
}

const SPOKEN_PUNCT = [
  [/\s*\b(new line|newline)\b\s*/gi, "\n"],
  [/\s*\bcomma\b/gi, ","],
  [/\s*\b(period|full stop)\b/gi, "."],
  [/\s*\bquestion mark\b/gi, "?"],
  [/\s*\bcolon\b/gi, ":"],
  [/\bopen (paren|parenthesis)\s*/gi, "("],
  [/\s*\bclose (paren|parenthesis)\b/gi, ")"],
  [/\bbacktick\s+(.+?)\s+backtick\b/gi, "`$1`"],
]

const FILLERS = /\b(um+|uh+|erm+|hmm+)\b[,]?\s*/gi

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

function words(str) {
  return str
    .trim()
    .split(/[\s_-]+/)
    .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter(Boolean)
}

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1)

// "camel case get user name" -> "getUserName". Applies to the next 1-4 words,
// stopping at punctuation or a connector word ("to", "and", ...).
const STOP = new Set(["to", "and", "in", "on", "for", "with", "the", "then", "from", "into", "as", "at", "of"])
const CASES = {
  "camel case": (w) => w[0] + w.slice(1).map(cap).join(""),
  "pascal case": (w) => w.map(cap).join(""),
  "snake case": (w) => w.join("_"),
  "kebab case": (w) => w.join("-"),
  "screaming snake case": (w) => w.join("_").toUpperCase(),
  "constant case": (w) => w.join("_").toUpperCase(),
}

function applyCases(text) {
  const names = Object.keys(CASES).sort((a, b) => b.length - a.length)
  const re = new RegExp(`\\b(${names.map(escapeRe).join("|")})\\b((?:\\s+[A-Za-z0-9]+){1,4})`, "gi")
  return text.replace(re, (match, name, tail) => {
    const taken = []
    for (const w of tail.trim().split(/\s+/)) {
      if (STOP.has(w.toLowerCase()) || taken.length === 4) break
      taken.push(w)
    }
    if (taken.length === 0) return match
    const rest = tail.trim().split(/\s+/).slice(taken.length).join(" ")
    const converted = CASES[name.toLowerCase()](words(taken.join(" ")))
    return converted + (rest ? " " + rest : "")
  })
}

export function buildVocab(extra = {}) {
  const merged = { ...DEFAULT_VOCAB, ...extra }
  const keys = Object.keys(merged).sort((a, b) => b.length - a.length)
  const re = new RegExp(`\\b(${keys.map(escapeRe).join("|")})\\b`, "gi")
  const lookup = new Map(keys.map((k) => [k.toLowerCase(), merged[k]]))
  return { re, lookup, hints: [...new Set(Object.values(merged))] }
}

export function clean(raw, vocab = buildVocab()) {
  if (!raw) return ""
  let t = " " + raw + " "
  t = t.replace(FILLERS, "")
  t = t.replace(vocab.re, (m) => vocab.lookup.get(m.toLowerCase()) ?? m)
  t = applyCases(t)
  for (const [re, rep] of SPOKEN_PUNCT) t = t.replace(re, rep)
  t = t
    .replace(/[ \t]+/g, " ")
    .replace(/ +([,.?:)])/g, "$1")
    .replace(/,([,.?])/g, "$1")
    .replace(/ *\n */g, "\n")
    .trim()
  if (t) t = t.charAt(0).toUpperCase() + t.slice(1)
  return t
}

// Voice commands at the end of an utterance, e.g. "... send it".
const SEND_RE = /[\s,.]*\b(send it|send|submit)[.!]?$/i

export function extractSend(text) {
  if (SEND_RE.test(text)) return { text: text.replace(SEND_RE, "").trim(), send: true }
  return { text, send: false }
}
