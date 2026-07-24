/**
 * Web MIDI input manager.
 */

export class MidiManager {
  constructor() {
    this.access = null;
    this.inputs = [];
    this.activeInput = null;
    this.onMessage = null;
    this.onDevicesChanged = null;
    this.onStateChange = null;
  }

  get supported() {
    return typeof navigator !== "undefined" && !!navigator.requestMIDIAccess;
  }

  async connect() {
    if (!this.supported) {
      throw new Error("Web MIDI API is not supported in this browser.");
    }

    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.access.onstatechange = () => this._refreshInputs();
    this._refreshInputs();
    return this.inputs;
  }

  _refreshInputs() {
    if (!this.access) return;

    const previousId = this.activeInput?.id ?? null;
    this.inputs = Array.from(this.access.inputs.values());

    if (this.onDevicesChanged) {
      this.onDevicesChanged(this.inputs);
    }

    // Keep current device if still present
    if (previousId) {
      const stillThere = this.inputs.find((i) => i.id === previousId);
      if (stillThere) {
        this.selectInput(stillThere.id);
        return;
      }
    }

    // Prefer Yamaha devices when available
    const yamaha = this.inputs.find((i) =>
      /yamaha|p-145|digital piano/i.test(`${i.name} ${i.manufacturer}`)
    );
    const preferred = yamaha ?? this.inputs[0] ?? null;

    if (preferred) this.selectInput(preferred.id);
    else this.selectInput(null);

    if (this.onStateChange) this.onStateChange();
  }

  selectInput(id) {
    if (this.activeInput) {
      this.activeInput.onmidimessage = null;
    }

    this.activeInput = id
      ? this.inputs.find((i) => i.id === id) ?? null
      : null;

    if (this.activeInput) {
      this.activeInput.onmidimessage = (event) => {
        if (this.onMessage) this.onMessage(event);
      };
    }

    if (this.onStateChange) this.onStateChange();
  }
}
