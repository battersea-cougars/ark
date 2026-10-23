import { firstCharacter } from "./text";

/** A member's initials, for their avatar: their first two names' first characters, in capitals ("🦁 Leo" is "🦁L"). */
export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(firstCharacter).join("").toUpperCase();
