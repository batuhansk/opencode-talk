import { test } from "node:test";
import assert from "node:assert/strict";
import { clean, buildVocab, extractSend } from "../lib/clean.js";

test("fixes coding homophones", () => {
  assert.equal(clean("add a null check to the jason parser"), "Add a null check to the JSON parser");
  assert.equal(clean("make it a bullion"), "Make it a boolean");
  assert.equal(clean("run cube control get pods"), "Run kubectl get pods");
});

test("case conversion stops at connector words", () => {
  assert.equal(clean("rename it to camel case get user name"), "Rename it to getUserName");
  assert.equal(clean("call snake case max retry count in config"), "Call max_retry_count in config");
  assert.equal(clean("use pascal case user service for the class"), "Use UserService for the class");
});

test("spoken punctuation and fillers", () => {
  assert.equal(clean("um fix the bug comma then run tests period"), "Fix the bug, then run tests.");
  assert.equal(clean("call backtick foo bar backtick"), "Call `foo bar`");
});

test("custom vocabulary", () => {
  const v = buildVocab({ "acme db": "AcmeDB" });
  assert.equal(clean("migrate acme db", v), "Migrate AcmeDB");
});

test("send command", () => {
  assert.deepEqual(extractSend("Fix the tests, send it."), { text: "Fix the tests", send: true });
  assert.deepEqual(extractSend("Fix the tests"), { text: "Fix the tests", send: false });
});
