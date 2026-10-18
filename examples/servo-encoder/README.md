# Servo and encoder example

Open Project → Servo and Encoder Example, or the adjacent generated `.trace.json` file. This is a labeled manual example, not a recorded Gemini success or a hardware measurement.

The Mega drives the generic SG90 through D9. An external regulated 5 V design source feeds only servo power; its negative, servo ground and Mega ground share a reference. Confirm the actual servo supply/pulse limits and transient current. The source's current rating is deliberately unknown.

Adafruit 757 provides two separate translated I²C channels with its documented pull-ups: Mega SDA20 → B1/A1 → encoder SDA, and SCL21 → B2/A2 → SCL. HV uses Mega 5 V; LV and encoder VCC use 3.3 V; grounds are common. Encoder DIR is grounded. The user's anonymous breakout remains provisional: confirm actual header continuity, supply circuitry and any onboard pull-ups before assembly. The example proposes required supporting hardware; it does not claim you already own it.

Firmware uses official Servo 1.3.0 and AVR-core Wire. It commands 60°/120° every three seconds under an explicit 1000–2000 µs timing assumption, reads AS5600 raw angle/status at 10 Hz, and visibly prints `command_deg`, `encoder_valid`, and valid `encoder_deg`/`encoder_raw`. Declared mappings distinguish commands from measurements. Until physical firmware transmits data, Debug shows Not reported. Missing magnet/I²C data omits angle values rather than fabricating zero.

Mechanically couple and align the diametrically magnetized on-axis magnet with the mechanism. Calibrate `ENCODER_ZERO_DEG` and `ENCODER_DIRECTION`; the diagram does not establish shaft coupling. The AS5600 reads magnetic orientation, not servo intent.

`npm run setup:libraries` installs the checksum-pinned dependency. Run Verify to compile exact visible source and scoped rules. Simulation has no encoder, servo, power or mechanical model. Physical programming/monitoring still require explicit device selection and action-specific approval. No physical test has been performed for this example.

Regenerate the project with `node scripts/export-servo-example.mjs`; generation uses validated shared transactions.
