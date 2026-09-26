/* ============================================================
   CareSignal-Waist — เฟิร์มแวร์เซ็นเซอร์คาดเอวสำหรับ Arduino Nano 33 BLE Sense Rev2
   ------------------------------------------------------------
   บอร์ด   : Arduino Nano 33 BLE Sense Rev2 (nRF52840 · BMI270 + BMM150)
   ไลบรารี : ArduinoBLE · Arduino_BMI270_BMM150   (ติดตั้งจาก Library Manager)
   บอร์ดใน IDE: "Arduino Nano 33 BLE" (แพ็กเกจ Arduino Mbed OS Nano Boards)

   การทดสอบที่รองรับ (ตามแนวทางมาตรฐาน)
     1 ลุกนั่ง 5 ครั้ง (5×STS)            — instrumented: เวลาแต่ละครั้ง ช่วงลุก กำลัง
     2 ลุกเดิน 3 เมตร (Timed Up and Go)    — CDC STEADI · แยกช่วงแบบ iTUG
     3 ทรงตัว 4 ท่า (4-Stage Balance)      — CDC STEADI · การแกว่งแบบ ISway
     4 ลุกยืน 30 วินาที (30-s Chair Stand) — CDC STEADI · นับครั้งที่ลุกเกินครึ่งทางตอนครบเวลา
     5 เดิน 4 เมตร (gait speed)            — World Guidelines for Falls Prevention 2022 (< 0.8 ม./วิ)

   หน้าที่ของบอร์ด
     1. อ่านความเร่ง + อัตราหมุน ~100 Hz จาก BMI270 (ไลบรารีตั้ง ±4 g · ±2000 องศา/วิ)
     2. ตั้งศูนย์ 1 วินาทีก่อนทุกการทดสอบ: หาแนวแรงโน้มถ่วง + ค่าคลาดไจโร แล้วชดเชยตลอดการวัด
     3. คำนวณผลบนบอร์ดด้วย cs_imu_core.h (ฝาแฝดของ cs-imu.js ในแอป ทดสอบใน Node)
     4. ส่งผลทาง Bluetooth Low Energy และ/หรือสาย USB (Serial 115200) — ใช้ได้โดยไม่มีโทรศัพท์
     5. ตรวจเครื่องก่อนใช้ (self-test): อัตราสุ่ม · ขนาดแรงโน้มถ่วง · ค่าคลาดและสัญญาณรบกวนไจโร

   สิ่งที่ตั้งใจ "ไม่ทำ"
     · ไม่ใช้ไมโครโฟน (PDM) บนบอร์ด — ระบบ CareSignal ไม่มีเสียงสั่งการและไม่เก็บเสียง
     · ไม่เก็บข้อมูลลงหน่วยความจำถาวร · ไม่มีชื่อหรือรหัสผู้ใช้ในบอร์ด
     · ไม่ใช่เครื่องมือแพทย์ — เครื่องมือวิจัยสำหรับเทียบความแม่นของการวัดที่บ้าน

   โปรโตคอล BLE (UUID ฐาน c5a1xxxx-3b1e-4c1a-9b6c-0000ca7e5161)
     0001 CTRL   write 4 ไบต์ [cmd, arg1, arg2, 0]
                 1 ARM(kind 1–5, ท่าทรงตัว 0–3) · 2 GO · 3 STOP · 4 STREAM(1/0) · 5 RESET · 6 SELFTEST
     0002 STATE  notify 16 ไบต์ ทุก 100 ms  [C5, kind, phase, count, elapsed u32, tilt, omega_h, yaw (i16×10), event, flags]
     0003 RESULT read/notify 84 ไบต์ (รุ่นแพ็กเก็ต 2 · โครงใน cs_imu_core.h)
     0004 RAW    notify 14 ไบต์ 50 Hz [t u16 ms, ax ay az i16 mg, gx gy gz i16 ×0.1 องศา/วิ]
     0005 INFO   read ข้อความ: รุ่นเฟิร์มแวร์ หรือผลตรวจเครื่อง "ST fs=… g=… gb=x,y,z gn=… an=…"

   คำสั่งผ่านสาย USB (Serial Monitor 115200 · พิมพ์ตัวอักษรแล้ว Enter)
     1–5 เลือกท่าและตั้งศูนย์ · b0–b3 ทรงตัวท่าที่ 1–4 · g เริ่ม · x หยุด · p ตรวจเครื่อง
     r เปิด/ปิดข้อมูลดิบ CSV 100 Hz · s สถานะ · h วิธีใช้
     ผลออกเป็นบรรทัด "RESULT,…" (CSV) พร้อมคัดลอกเข้าตาราง

   ไฟสถานะ (RGB บนบอร์ด · ติดเมื่อ LOW)
     น้ำเงินกะพริบ = รอเชื่อมต่อ · เขียว = เชื่อมต่อแล้ว · เหลือง = ตั้งศูนย์/พร้อม · แดงกะพริบ = กำลังวัด
     ม่วงค้าง = ตรวจเครื่องอยู่ · แดงกะพริบเร็ว = เซ็นเซอร์ไม่ตอบ
   ============================================================ */
#include <ArduinoBLE.h>
#include "Arduino_BMI270_BMM150.h"
#include "cs_imu_core.h"

#define FW_VERSION "CareSignal-Waist 1.1 (imu-1.1)"
#define UUID(x) "c5a1" x "-3b1e-4c1a-9b6c-0000ca7e5161"

BLEService svc(UUID("0000"));
BLECharacteristic chCtrl(UUID("0001"), BLEWrite, 4);
BLECharacteristic chState(UUID("0002"), BLERead | BLENotify, CS_STATE_BYTES);
BLECharacteristic chResult(UUID("0003"), BLERead | BLENotify, CS_RESULT_BYTES);
BLECharacteristic chRaw(UUID("0004"), BLENotify, 14);
BLEStringCharacteristic chInfo(UUID("0005"), BLERead, 120);

enum { CMD_ARM = 1, CMD_GO = 2, CMD_STOP = 3, CMD_STREAM = 4, CMD_RESET = 5, CMD_SELFTEST = 6 };
static const char *KIND_NM[] = { "-", "ftsst", "tug", "balance", "chair30", "walk4" };

static cs_imu_t S;
static bool streamOn = false, serialRaw = false, resultSent = false;
static uint32_t lastState = 0, lastBlink = 0, sampleN = 0;
static bool blink = false;

/* ตรวจเครื่อง: เก็บ 2 วินาทีขณะวางนิ่ง */
static struct { bool on; uint32_t t0, n; double sa, sa2, sw[3], sw2[3]; } ST = { false };

static void led(bool r, bool g, bool b) { digitalWrite(LEDR, r ? LOW : HIGH); digitalWrite(LEDG, g ? LOW : HIGH); digitalWrite(LEDB, b ? LOW : HIGH); }

static void sendState(uint32_t now) {
  if (!BLE.connected()) return;
  uint8_t o[CS_STATE_BYTES]; cs_imu_state(&S, now, o); chState.writeValue(o, CS_STATE_BYTES);
}
static uint16_t rd16(const uint8_t *b, int o) { return (uint16_t)(b[o] | (b[o + 1] << 8)); }
static uint32_t rd32(const uint8_t *b, int o) { return (uint32_t)b[o] | ((uint32_t)b[o + 1] << 8) | ((uint32_t)b[o + 2] << 16) | ((uint32_t)b[o + 3] << 24); }
static void printResultCSV() {
  const uint8_t *b = S.result;
  Serial.print("RESULT,"); Serial.print(KIND_NM[b[2] <= 5 ? b[2] : 0]); Serial.print(','); Serial.print(b[3] == 0 ? "ok" : b[3] == 1 ? "incomplete" : "aborted");
  uint32_t tot = rd32(b, 8), rea = rd32(b, 12);
  Serial.print(",total_ms="); if (tot == 0xFFFFFFFFu) Serial.print("NA"); else Serial.print(tot);
  Serial.print(",reaction_ms="); if (rea == 0xFFFFFFFFu) Serial.print("NA"); else Serial.print(rea);
  Serial.print(",count="); Serial.print(b[4]);
  Serial.print(",fs_hz="); Serial.print(rd16(b, 6) / 10.0, 1);
  if (b[2] == CS_KIND_TUG) {
    const char *nm[] = { "sts_ms", "walk_out_ms", "turn_ms", "walk_back_ms", "turn2_ms", "sit_ms" };
    for (int i = 0; i < 6; i++) { uint16_t v = rd16(b, 36 + i * 2); Serial.print(','); Serial.print(nm[i]); Serial.print('='); if (v == 0xFFFF) Serial.print("NA"); else Serial.print(v); }
  }
  if (b[2] == CS_KIND_TUG || b[2] == CS_KIND_WALK4) {
    uint16_t sp = rd16(b, 58), cd = rd16(b, 54);
    Serial.print(",steps="); Serial.print(b[52]);
    Serial.print(",cadence="); if (cd == 0xFFFF) Serial.print("NA"); else Serial.print(cd / 10.0, 1);
    Serial.print(",speed_mps="); if (sp == 0xFFFF) Serial.print("NA"); else Serial.print(sp / 100.0, 2);
  }
  if (b[2] == CS_KIND_BALANCE) {
    Serial.print(",held_s="); Serial.print(rd16(b, 60) / 1000.0, 1);
    Serial.print(",rms="); Serial.print(rd16(b, 62) / 1000.0, 3);
    Serial.print(",freq_hz="); Serial.print(rd16(b, 70) / 100.0, 2);
    Serial.print(",stepped="); Serial.print((b[5] & 2) ? 1 : 0);
  }
  if (b[2] == CS_KIND_CHAIR30) { Serial.print(",half="); Serial.print((b[5] & 8) ? 1 : 0); }
  Serial.print(",impact="); Serial.println((b[5] & 1) ? 1 : 0);
}
static void sendResult() {
  if (resultSent || !S.done) return;
  if (BLE.connected()) chResult.writeValue(S.result, CS_RESULT_BYTES);
  printResultCSV(); resultSent = true;
}
static void doArm(uint8_t kind, uint8_t stage) {
  cs_imu_init(&S, kind >= 1 && kind <= 5 ? kind : CS_KIND_FTSST, stage); cs_imu_arm(&S); resultSent = false;
  Serial.print("ARM "); Serial.print(KIND_NM[S.kind]); Serial.println(" · นั่ง/ยืนนิ่ง 1 วินาทีเพื่อตั้งศูนย์");
}
static void startSelfTest() { memset(&ST, 0, sizeof(ST)); ST.on = true; ST.t0 = millis(); Serial.println("SELFTEST · วางบอร์ดนิ่งบนโต๊ะ 2 วินาที"); }
static void finishSelfTest() {
  ST.on = false;
  double n = ST.n ? (double)ST.n : 1, am = ST.sa / n, an = sqrt(fmax(0, ST.sa2 / n - am * am));
  double gb[3], gs = 0;
  for (int i = 0; i < 3; i++) { gb[i] = ST.sw[i] / n; gs += fmax(0, ST.sw2[i] / n - gb[i] * gb[i]); }
  double fs = ST.n > 1 ? (ST.n - 1) / ((millis() - ST.t0) / 1000.0) : 0;
  /* ใช้ String แทน snprintf("%f") — printf ของบางแกน Arduino ไม่รองรับทศนิยม */
  String buf = String("ST fs=") + String(fs, 1) + " g=" + String(am, 3) + " gb=" + String(gb[0], 2) + "," + String(gb[1], 2) + "," + String(gb[2], 2) +
               " gn=" + String(sqrt(gs / 3), 2) + " an=" + String(an, 3);
  chInfo.writeValue(buf); Serial.println(buf);
  bool ok = fs >= 90 && fs <= 110 && fabs(am - 1) <= 0.05 && sqrt(gb[0] * gb[0] + gb[1] * gb[1] + gb[2] * gb[2]) <= 3 && sqrt(gs / 3) <= 0.5;
  Serial.println(ok ? "SELFTEST ผ่าน" : "SELFTEST ไม่ผ่าน — ตรวจการติดตั้ง/วางนิ่ง แล้วลองใหม่");
}
static void onCtrl(BLEDevice, BLECharacteristic ch) {
  const uint8_t *v = ch.value(); int n = ch.valueLength(); if (n < 1) return;
  uint8_t cmd = v[0], a1 = n > 1 ? v[1] : 0, a2 = n > 2 ? v[2] : 0; uint32_t now = millis();
  switch (cmd) {
    case CMD_ARM:      doArm(a1, a2); break;
    case CMD_GO:       if (cs_imu_go(&S, now)) Serial.println("GO"); break;
    case CMD_STOP:     cs_imu_stop(&S, now); sendState(now); sendResult(); break;
    case CMD_STREAM:   streamOn = a1 != 0; break;
    case CMD_RESET:    cs_imu_init(&S, CS_KIND_NONE, 0); resultSent = false; streamOn = false; chInfo.writeValue(FW_VERSION); break;
    case CMD_SELFTEST: startSelfTest(); break;
  }
  sendState(now);
}
static void help() {
  Serial.println(FW_VERSION);
  Serial.println("1 ลุกนั่ง5ครั้ง · 2 ลุกเดิน3ม. · 3 ทรงตัว (b0-b3 เลือกท่า) · 4 ลุกยืน30วิ · 5 เดิน4ม.");
  Serial.println("g เริ่ม · x หยุด · p ตรวจเครื่อง · r ข้อมูลดิบ CSV · s สถานะ · h วิธีใช้");
}
static void onSerial() {
  static char line[16]; static int len = 0;
  while (Serial.available()) {
    char c = Serial.read();
    if (c != '\n' && c != '\r') { if (len < 15) line[len++] = c; continue; }
    if (!len) continue; line[len] = 0; len = 0;
    uint32_t now = millis();
    if (line[0] >= '1' && line[0] <= '5') doArm(line[0] - '0', 0);
    else if (line[0] == 'b' && line[1] >= '0' && line[1] <= '3') doArm(CS_KIND_BALANCE, line[1] - '0');
    else if (line[0] == 'g') { if (cs_imu_go(&S, now)) Serial.println("GO"); else Serial.println("ยังไม่พร้อม — ต้องนิ่ง 1 วินาทีหลังเลือกท่า"); }
    else if (line[0] == 'x') { cs_imu_stop(&S, now); sendResult(); }
    else if (line[0] == 'p') startSelfTest();
    else if (line[0] == 'r') { serialRaw = !serialRaw; if (serialRaw) Serial.println("t_ms,ax_g,ay_g,az_g,gx_dps,gy_dps,gz_dps"); }
    else if (line[0] == 's') { Serial.print("STATE "); Serial.print(KIND_NM[S.kind <= 5 ? S.kind : 0]); Serial.print(" phase="); Serial.print(S.phase); Serial.print(" n="); Serial.println(S.n); }
    else help();
  }
}

void setup() {
  pinMode(LEDR, OUTPUT); pinMode(LEDG, OUTPUT); pinMode(LEDB, OUTPUT); led(false, false, false);
  pinMode(LED_BUILTIN, OUTPUT); digitalWrite(LED_BUILTIN, LOW);
  Serial.begin(115200);                    /* ไม่รอ Serial — ใช้งานด้วยพาวเวอร์แบงก์ได้ */
  cs_imu_init(&S, CS_KIND_NONE, 0);
  if (!IMU.begin()) { while (1) { led(true, false, false); delay(150); led(false, false, false); delay(150); } }
  if (!BLE.begin()) { while (1) { led(true, false, true); delay(300); led(false, false, false); delay(300); } }
  BLE.setLocalName("CareSignal-Waist");
  BLE.setDeviceName("CareSignal-Waist");
  BLE.setAdvertisedService(svc);
  svc.addCharacteristic(chCtrl); svc.addCharacteristic(chState); svc.addCharacteristic(chResult); svc.addCharacteristic(chRaw); svc.addCharacteristic(chInfo);
  BLE.addService(svc);
  chInfo.writeValue(FW_VERSION);
  chCtrl.setEventHandler(BLEWritten, onCtrl);
  BLE.setConnectionInterval(6, 12);          /* 7.5–15 ms เพื่อให้สตรีม 50 Hz ทัน */
  BLE.advertise();
  help();
}

void loop() {
  BLE.poll();
  onSerial();
  uint32_t now = millis();
  bool connected = BLE.connected();

  if (IMU.accelerationAvailable() && IMU.gyroscopeAvailable()) {
    float a[3], w[3];
    IMU.readAcceleration(a[0], a[1], a[2]);
    IMU.readGyroscope(w[0], w[1], w[2]);
    sampleN++;
    if (ST.on) {
      float an = sqrtf(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); ST.n++; ST.sa += an; ST.sa2 += an * an;
      for (int i = 0; i < 3; i++) { ST.sw[i] += w[i]; ST.sw2[i] += w[i] * w[i]; }
      if (now - ST.t0 >= 2000) finishSelfTest();
    } else {
      int ev = cs_imu_push(&S, now, a, w);
      if (ev && ev != CS_EV_STEP) sendState(now);        /* เหตุการณ์สำคัญส่งทันที ไม่รอรอบ 100 ms */
      if (ev == CS_EV_READY) Serial.println("READY · พิมพ์ g เพื่อเริ่ม");
      if (S.done) sendResult();
    }
    if (serialRaw) {                                     /* บันทึกผ่านสาย USB: 100 Hz เต็ม */
      Serial.print(now); for (int i = 0; i < 3; i++) { Serial.print(','); Serial.print(a[i], 4); } for (int i = 0; i < 3; i++) { Serial.print(','); Serial.print(w[i], 2); } Serial.println();
    }
    if (streamOn && connected && (sampleN & 1)) {        /* BLE: เว้นตัวอย่าง = 50 Hz */
      uint8_t p[14]; uint16_t t16 = (uint16_t)(now & 0xFFFF);
      p[0] = t16 & 0xFF; p[1] = t16 >> 8;
      for (int i = 0; i < 3; i++) { int16_t m = (int16_t)cs_clampf(a[i] * 1000.f, -32767, 32767); p[2 + i * 2] = m & 0xFF; p[3 + i * 2] = (m >> 8) & 0xFF; }
      for (int i = 0; i < 3; i++) { int16_t m = (int16_t)cs_clampf(w[i] * 10.f, -32767, 32767); p[8 + i * 2] = m & 0xFF; p[9 + i * 2] = (m >> 8) & 0xFF; }
      chRaw.writeValue(p, 14);
    }
  }
  if (connected && now - lastState >= 100) { lastState = now; sendState(now); }

  if (now - lastBlink >= 500) { lastBlink = now; blink = !blink; }
  if (ST.on)                                   led(true, false, true);
  else if (S.phase == CS_PH_RUN)               led(blink, false, false);
  else if (S.phase == CS_PH_CAL || S.phase == CS_PH_READY) led(true, true, false);
  else if (connected)                          led(false, true, false);
  else                                         led(false, false, blink);
}
