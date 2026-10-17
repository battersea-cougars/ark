// Before every test file (vitest.config.ts): the outside world's answers that every test shares. The club's inbox is
// a placeholder, so no test asks the real Sanity for it (club-contact.ts).
import { clubContactFake } from "../club-contact";

clubContactFake.value = "club@example.com";
