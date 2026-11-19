import { test } from "node:test";
import assert from "node:assert/strict";
import { codeKey, gs1, gtinValid, labelUrl, mintOwn, normalise, OWN } from "./codes";

// Codes and tags (ADR-0009 in maker-5-shared). Every code here is invented,
// with a correct check digit where one is needed.

test("our codes: minted in Crockford base32, read back however they arrive", () => {
  for (let i = 0; i < 200; i++) assert.match(mintOwn(), OWN);
  assert.deepEqual(normalise("HTTPS://MAKER-5.CLOUD/T/K7Q2M9"), { kind: "m5", value: "K7Q2M9" });
  assert.deepEqual(normalise("https://stage.maker-5.cloud/t/k7q2m9/"), { kind: "m5", value: "K7Q2M9" });
  assert.deepEqual(normalise("http://localhost:8000/t/K7Q2M9"), { kind: "m5", value: "K7Q2M9" });
  assert.deepEqual(normalise("HTTPS://MAKER5.CLOUD/T/K7Q2M9"), { kind: "m5", value: "K7Q2M9" });
  assert.deepEqual(normalise("https://stage.maker5.cloud/t/k7q2m9"), { kind: "m5", value: "K7Q2M9" });
  assert.deepEqual(normalise("https://stage.d0example0.amplifyapp.com/t/K7Q2M9"), { kind: "m5", value: "K7Q2M9" });
  assert.equal(normalise("https://maker5.cloud.example.org/t/K7Q2M9").kind, "qr", "a look-alike host is text");
  assert.deepEqual(normalise("k7q2mo"), { kind: "m5", value: "K7Q2M0" }, "O is read as 0");
  assert.equal(normalise("https://example.org/t/K7Q2M9").kind, "qr", "another site's URL is just text");
});

test("the label URL fits a version-2 QR in alphanumeric mode", () => {
  const url = labelUrl("K7Q2M9");
  assert.equal(url, "HTTPS://MAKER5.CLOUD/T/K7Q2M9");
  assert.equal(labelUrl("K7Q2M9", "stage.maker5.cloud"), "HTTPS://STAGE.MAKER5.CLOUD/T/K7Q2M9");
  assert.ok(labelUrl("K7Q2M9", "stage.maker5.cloud").length <= 47, "stage labels fit version 2 too");
  assert.match(url, /^[0-9A-Z $%*+\-./:]+$/, "only QR alphanumeric characters");
  assert.ok(url.length <= 47, "version 2 at ECC L holds 47 alphanumeric characters");
});

test("GTINs: the check digit decides; EAN-13 and GTIN-14 meet", () => {
  assert.ok(gtinValid("4006381333931"));
  assert.ok(gtinValid("96385074"));
  assert.ok(!gtinValid("4006381333932"));
  assert.deepEqual(normalise("4006381333931"), { kind: "ean", value: "04006381333931" });
  assert.deepEqual(normalise("04006381333931"), normalise("4006381333931"));
  assert.throws(() => normalise("4006381333932"), /check digit/);
});

test("NFC UIDs and anything else", () => {
  assert.deepEqual(normalise("nfc:04:A2:3B:1C:5D:6E:80"), { kind: "nfc", value: "04A23B1C5D6E80" });
  assert.deepEqual(normalise("RPI1-MODEL-B 2012"), { kind: "qr", value: "RPI1-MODEL-B 2012" });
  const long = normalise("https://example.org/p?" + "x".repeat(300));
  assert.equal(long.kind, "qr");
  assert.match(long.value, /^sha256:[0-9a-f]{64}$/);
  assert.throws(() => normalise("  "), /empty/);
});

test("ours are keyed for the site, aliases within a workspace", () => {
  assert.equal(codeKey({ kind: "m5", value: "K7Q2M9" }, "t-aaaaaaaaaa"), "m5:K7Q2M9");
  assert.equal(codeKey({ kind: "ean", value: "04006381333931" }, "t-aaaaaaaaaa"), "t-aaaaaaaaaa#ean:04006381333931");
});

// GS1: the GTIN names the article, the serial number the unit. 09506000134352
// is GS1's own example GTIN; the serials are invented.
test("GS1 codes give their GTIN, serial number and batch", () => {
  const G = "09506000134352";
  const GS = String.fromCharCode(29);
  assert.deepEqual(gs1(`01${G}21SN-0042${GS}10LOT7`), { gtin: G, serial: "SN-0042", batch: "LOT7" }, "a DataMatrix as scanned");
  assert.deepEqual(gs1(`]d201${G}10LOT7${GS}21SN-0042`), { gtin: G, serial: "SN-0042", batch: "LOT7" }, "with a symbology prefix");
  assert.deepEqual(gs1(`01${G}17271231` + "21SN-0042"), { gtin: G, serial: "SN-0042" }, "a fixed-length expiry between");
  assert.deepEqual(gs1(`(01)${G}(21)SN-0042`), { gtin: G, serial: "SN-0042" }, "the printed form");
  assert.deepEqual(gs1(`https://id.example.org/01/${G}/21/SN-0042?x=1`), { gtin: G, serial: "SN-0042", batch: undefined }, "a Digital Link");
  assert.equal(gs1(`01${G.slice(0, 13)}9` + "21X"), null, "a wrong check digit is no GTIN");
  assert.equal(gs1("4006381333931"), null, "a bare EAN is no element string");
  assert.deepEqual(normalise(`01${G}21SN-0042`), { kind: "ean", value: G, serial: "SN-0042" });
  assert.deepEqual(normalise(`(01)${G}`), { kind: "ean", value: G });
  assert.equal(codeKey(normalise(`01${G}21SN-0042`), "t-x"), codeKey(normalise("9506000134352"), "t-x"), "the same article's alias");
});
