// mudroom example: Mega 2560 + photo-matched AS5600 module + generic SG90.
// Requires the documented external 5 V servo source and Adafruit 757 interface.
// This is visible user firmware. Nothing is inserted during compile/upload.
// Servo 1.3.0: explicit 1000–2000 us design range; verify your actual servo limits.
// Magnet must be coupled/aligned to the rotating mechanism. Calibrate zero/direction.
#include <Wire.h>
#include <Servo.h>

constexpr uint8_t SERVO_PIN = 9;
constexpr uint8_t ENCODER_ADDRESS = 0x36;
constexpr unsigned long REPORT_MS = 100;
constexpr float ENCODER_ZERO_DEG = 0.0f;
constexpr int ENCODER_DIRECTION = 1; // DIR is grounded; reverse/calibrate if required.
Servo actuator;
unsigned long lastReport = 0;

bool readBytes(uint8_t reg, uint8_t *bytes, uint8_t count) {
  Wire.beginTransmission(ENCODER_ADDRESS);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(ENCODER_ADDRESS, count) != count) {
    while (Wire.available()) Wire.read();
    return false;
  }
  for (uint8_t i = 0; i < count; ++i) bytes[i] = Wire.read();
  return true;
}

bool readEncoder(uint16_t &raw) {
  uint8_t status, angle[2];
  if (!readBytes(0x0B, &status, 1)) return false;
  // MD=bit5, ML=bit4, MH=bit3: do not report an angle without valid magnet status.
  if (!(status & 0x20) || (status & 0x18)) return false;
  if (!readBytes(0x0C, angle, 2)) return false;
  raw = ((uint16_t(angle[0]) << 8) | angle[1]) & 0x0FFF;
  return true;
}

void setup() {
  Serial.begin(115200);
  Wire.begin(); // Mega hardware I2C: SDA20 / SCL21, through the documented shifter.
  Wire.setClock(100000);
  Wire.setWireTimeout(25000, true); // AVR Wire timeout; avoid indefinite missing-device waits.
  actuator.attach(SERVO_PIN, 1000, 2000);
  actuator.write(90);
}

void loop() {
  const unsigned long now = millis();
  // Planned test motion; commanded degrees do not establish actual shaft position.
  const int commanded = ((now / 3000UL) % 2) ? 120 : 60;
  actuator.write(commanded);
  if (now - lastReport < REPORT_MS) return;
  lastReport = now;
  uint16_t raw = 0;
  const bool valid = readEncoder(raw);
  Serial.print("command_deg="); Serial.print(commanded);
  Serial.print(" encoder_valid="); Serial.print(valid ? 1 : 0);
  if (valid) {
    float degrees = ENCODER_DIRECTION * (raw * (360.0f / 4096.0f) - ENCODER_ZERO_DEG);
    while (degrees < 0) degrees += 360;
    while (degrees >= 360) degrees -= 360;
    Serial.print(" encoder_deg="); Serial.print(degrees, 2);
    Serial.print(" encoder_raw="); Serial.print(raw);
  }
  // Invalid reads omit angle/raw fields. Debug keeps prior data stale rather than inventing zero.
  Serial.println();
}
