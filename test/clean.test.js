import { test } from "node:test"
import assert from "node:assert/strict"
import { clean, buildVocab, extractSend } from "../lib/clean.js"

test("fixes coding homophones", () => {
  assert.equal(clean("add a null check to the jason parser"), "Add a null check to the JSON parser")
  assert.equal(clean("make it a bullion"), "Make it a boolean")
  assert.equal(clean("run cube control get pods"), "Run kubectl get pods")
})

test("case conversion stops at connector words", () => {
  assert.equal(clean("rename it to camel case get user name"), "Rename it to getUserName")
  assert.equal(clean("call snake case max retry count in config"), "Call max_retry_count in config")
  assert.equal(clean("use pascal case user service for the class"), "Use UserService for the class")
})

test("identifiers at the start of a sentence keep their case", () => {
  assert.equal(clean("snake case max retry count"), "max_retry_count")
  assert.equal(clean("camel case get user is broken"), "getUserIsBroken")
  assert.equal(clean("camel case get user is broken comma fix it"), "getUserIsBroken, fix it")
})

test("spoken punctuation and fillers", () => {
  assert.equal(clean("um fix the bug comma then run tests period"), "Fix the bug, then run tests.")
  assert.equal(clean("call backtick foo bar backtick"), "Call `foo bar`")
})

test("custom vocabulary", () => {
  const v = buildVocab({ "acme db": "AcmeDB" })
  assert.equal(clean("migrate acme db", v), "Migrate AcmeDB")
})

test("Turkish: spoken punctuation, tech terms, and send", () => {
  assert.equal(
    clean("testleri çalıştır virgül sonra jason dosyasını düzelt nokta", undefined, "tr-TR"),
    "Testleri çalıştır, sonra JSON dosyasını düzelt.",
  )
  assert.equal(clean("bu doğru mu soru işareti", undefined, "tr"), "Bu doğru mu?")
  // English punctuation words are left alone in Turkish, and vice versa.
  assert.equal(clean("virgül nokta", undefined, "en-US"), "Virgül nokta")
  assert.equal(clean("noktalı virgülsüz", undefined, "tr-TR"), "Noktalı virgülsüz")
  assert.deepEqual(extractSend("Testleri çalıştır gönder", "tr-TR"), { text: "Testleri çalıştır", send: true })
  assert.deepEqual(extractSend("Testleri çalıştır send it", "tr-TR"), {
    text: "Testleri çalıştır send it",
    send: false,
  })
})

test("languages without rules only get vocabulary fixes", () => {
  assert.equal(clean("öffne die jason datei comma bitte", undefined, "de-DE"), "Öffne die JSON datei comma bitte")
})

test("send command", () => {
  assert.deepEqual(extractSend("Fix the tests, send it."), { text: "Fix the tests", send: true })
  assert.deepEqual(extractSend("Fix the tests"), { text: "Fix the tests", send: false })
})
