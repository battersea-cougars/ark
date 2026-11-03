// Tap twice for what can't be undone: the first tap arms it (its words turn red, "Tap again…"), the second does it.
// Tapping something else arms that instead; with a `lapse`, an armed tap left alone disarms after that many ms.

export class Arm<K = string> {
  armed = $state<K | null>(null);
  #lapse: number;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(lapse = 0) {
    this.#lapse = lapse;
  }

  /** Whether `key` is waiting for its second tap. */
  is(key: K): boolean {
    return this.armed === key;
  }

  /** A tap on `key`: arms it, or, armed already, disarms and runs `run`. */
  tap(key: K, run: () => unknown) {
    clearTimeout(this.#timer);
    if (this.armed !== key) {
      this.armed = key;
      if (this.#lapse) this.#timer = setTimeout(() => this.disarm(), this.#lapse);
      return;
    }
    this.armed = null;
    run();
  }

  disarm() {
    clearTimeout(this.#timer);
    this.armed = null;
  }
}
