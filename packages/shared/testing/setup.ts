// Before every test file (vitest.config.ts): the outside world's answers that every test shares. The club's inbox is
// a placeholder, so no test asks the real Sanity for it (club-contact.ts).
import { clubContactFake } from "../club-contact";
import { settledCrypto } from "./crypto";
import { scribe } from "../scribe";
import { consoleAdapter } from "../scribe.console";

clubContactFake.value = "club@example.com";
// The log as the apps write it (ADR 0110), so a test can read a line off the console
scribe.configure({ adapter: consoleAdapter });
// Hashes and signatures answer at once, so a concurrency test's seed is one order of events, however busy the machine
settledCrypto();
