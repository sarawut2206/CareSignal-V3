/* ============================================================
   CareSignal-Waist — เฟิร์มแวร์เซ็นเซอร์คาดเอวสำหรับ Arduino Nano 33 BLE Sense Rev2
   ------------------------------------------------------------
   บอร์ด   : Arduino Nano 33 BLE Sense Rev2 (nRF52840 · BMI270 + BMM150)
   ไลบรารี : ArduinoBLE · Arduino_BMI270_BMM150   (ติดตั้งจาก Library Manager)
   บอร์ดใน IDE: "Arduino Nano 33 BLE" (แพ็กเกจ Arduino Mbed OS Nano Boards)

   หน้าที่ของบอร์ด
     1. อ่านความเร่ง + อัตราหมุน 100 Hz จาก BMI270
     2. คำนวณผลการทดสอบบนบอร์ดด้วย cs_imu_core.h (ชุดเดียวกับ cs-imu.js ในแอป)
     3. ส่งสถานะสด (ทุก 100 ms) · ผลสรุป 84 ไบต์ (เมื่อจบ) · สัญญาณดิบ 50 Hz (เมื่อแอปขอ)
        ผ่าน Bluetooth Low Energy — แอป CareSignal V3 บน Android Chrome เชื่อมด้วย Web Bluetooth

   สิ่งที่ตั้งใจ "ไม่ทำ"
     · ไม่ใช้ไมโครโฟน (PDM) บนบอร์ด — ระบบ CareSignal ไม่มีเสียงสั่งการและไม่เก็บเสียง
     · ไม่เก็บข้อมูลลงหน่วยความจำถาวร — ปิดเครื่องแล้วไม่มีอะไรค้างในบอร์ด
     · ไม่มีชื่อหรือรหัสผู้ใช้ในบอร์ด — บอร์ดรู้แค่ "ท่าที่กำลังวัด"

   โปรโตคอล BLE (UUID ฐาน c5a1xxxx-3b1e-4c1a-9b6c-0000ca7e5161)
     0000 service
     0001 CTRL   write 4 ไบต์ [cmd, arg1, arg2, 0]
                 cmd 1 = ARM(kind 1 ลุกนั่ง · 2 ลุกเดิน · 3 ทรงตัว, arg2 = ท่าที่)  → ตั้งศูนย์ 1 วิ แล้วรอ
                 cmd 2 = GO (สัญญาณ "เริ่ม" — แอปนับ 3-2-1 แล้วส่ง)
                 cmd 3 = STOP (หยุดเอง / หยุดเพื่อความปลอดภัย)
                 cmd 4 = STREAM(arg1 1 เปิด · 0 ปิด) สัญญาณดิบ 50 Hz
                 cmd 5 = RESET
     0002 STATE  notify 16 ไบต์ ทุก 100 ms  [C5, kind, phase, count, elapsed u32, tilt i16×10, omega_h i16×10, yaw i16×10, event, flags]
     0003 RESULT read/notify 84 ไบต์ (โครงใน cs_imu_core.h · แอปอ่านค่าเต็มด้วย readValue หลังได้รับ notify)
     0004 RAW    notify 14 ไบต์ [t u16 ms, ax ay az i16 mg, gx gy gz i16 ×0.1 องศา/วิ]
     0005 INFO   read สตริงรุ่นเฟิร์มแวร์

   ไฟสถานะ (RGB บนบอร์ด · ติดเมื่อ LOW)
     น้ำเงินกะพริบ = รอเชื่อมต่อ · เขียว = เชื่อมต่อแล้ว · เหลือง = ตั้งศูนย์/พร้อม · แดงกะพริบ = กำลังวัด
   ============================================================ */
#include <ArduinoBLE.h>
#include "Arduino_BMI270_BMM150.h"
#include "cs_imu_core.h"

#define FW_VERSION "CareSignal-Waist 1.0 (imu-1.0)"
#define UUID(x) "c5a1" x "-3b1e-4c1a-9b6c-0000ca7e5161"

BLEService svc(UUID("0000"));
BLECharacteristic chCtrl(UUID("0001"), BLEWrite, 4);
BLECharacteristic chState(UUID("0002"), BLERead | BLENotify, CS_STATE_BYTES);
BLECharacteristic chResult(UUID("0003"), BLERead | BLENotify, CS_RESULT_BYTES);
BLECharacteristic chRaw(UUID("0004"), BLENotify, 14);
BLEStringCharacteristic chInfo(UUID("0005"), BLERead, 40);

enum { CMD_ARM = 1, CMD_GO = 2, CMD_STOP = 3, CMD_STREAM = 4, CMD_RESET = 5 };

static cs_imu_t S;
static bool streamOn = false, resultSent = false;
static uint32_t lastState = 0, lastBlink = 0, sampleN = 0;
static bool blink = false;

static void led(bool r, bool g, bool b) { digitalWrite(LEDR, r ? LOW : HIGH); digitalWrite(LEDG, g ? LOW : HIGH); digitalWrite(LEDB, b ? LOW : HIGH); }

static void sendState(uint32_t now) {
  uint8_t o[CS_STATE_BYTES]; cs_imu_state(&S, now, o); chState.writeValue(o, CS_STATE_BYTES);
}
static void sendResult() {
  if (resultSent || !S.done) return;
  chResult.writeValue(S.result, CS_RESULT_BYTES); resultSent = true;
}
static void onCtrl(BLEDevice, BLECharacteristic ch) {
  const uint8_t *v = ch.value(); int n = ch.valueLength(); if (n < 1) return;
  uint8_t cmd = v[0], a1 = n > 1 ? v[1] : 0, a2 = n > 2 ? v[2] : 0; uint32_t now = millis();
  switch (cmd) {
    case CMD_ARM:    cs_imu_init(&S, a1 >= 1 && a1 <= 3 ? a1 : CS_KIND_FTSST, a2); cs_imu_arm(&S); resultSent = false; break;
    case CMD_GO:     cs_imu_go(&S, now); break;
    case CMD_STOP:   cs_imu_stop(&S, now); sendState(now); sendResult(); break;
    case CMD_STREAM: streamOn = a1 != 0; break;
    case CMD_RESET:  cs_imu_init(&S, CS_KIND_NONE, 0); resultSent = false; streamOn = false; break;
  }
  sendState(now);
}

void setup() {
  pinMode(LEDR, OUTPUT); pinMode(LEDG, OUTPUT); pinMode(LEDB, OUTPUT); led(false, false, false);
  pinMode(LED_BUILTIN, OUTPUT); digitalWrite(LED_BUILTIN, LOW);
  cs_imu_init(&S, CS_KIND_NONE, 0);
  if (!IMU.begin()) { while (1) { led(true, false, false); delay(150); led(false, false, false); delay(150); } }   /* IMU ไม่ตอบ: แดงกะพริบเร็ว */
  if (!BLE.begin()) { while (1) { led(true, false, true); delay(300); led(false, false, false); delay(300); } }   /* BLE ไม่ตอบ: ม่วงกะพริบ */
  BLE.setLocalName("CareSignal-Waist");
  BLE.setDeviceName("CareSignal-Waist");
  BLE.setAdvertisedService(svc);
  svc.addCharacteristic(chCtrl); svc.addCharacteristic(chState); svc.addCharacteristic(chResult); svc.addCharacteristic(chRaw); svc.addCharacteristic(chInfo);
  BLE.addService(svc);
  chInfo.writeValue(FW_VERSION);
  chCtrl.setEventHandler(BLEWritten, onCtrl);
  BLE.setConnectionInterval(6, 12);   /* 7.5–15 ms เพื่อให้สตรีม 50 Hz ทัน */
  BLE.advertise();
}

void loop() {
  BLE.poll();
  uint32_t now = millis();
  bool connected = BLE.connected();

  /* อ่านเซ็นเซอร์เมื่อมีตัวอย่างใหม่ (BMI270 ให้ ~100 Hz) */
  if (IMU.accelerationAvailable() && IMU.gyroscopeAvailable()) {
    float a[3], w[3];
    IMU.readAcceleration(a[0], a[1], a[2]);
    IMU.readGyroscope(w[0], w[1], w[2]);
    sampleN++;
    int ev = cs_imu_push(&S, now, a, w);
    if (ev && ev != CS_EV_STEP) sendState(now);           /* เหตุการณ์สำคัญส่งทันที ไม่รอรอบ 100 ms */
    if (S.done) sendResult();
    if (streamOn && connected && (sampleN & 1)) {         /* ส่งตัวอย่างเว้นตัวอย่าง = 50 Hz */
      uint8_t p[14]; uint16_t t16 = (uint16_t)(now & 0xFFFF);
      p[0] = t16 & 0xFF; p[1] = t16 >> 8;
      for (int i = 0; i < 3; i++) { int16_t m = (int16_t)cs_clampf(a[i] * 1000.f, -32767, 32767); p[2 + i * 2] = m & 0xFF; p[3 + i * 2] = (m >> 8) & 0xFF; }
      for (int i = 0; i < 3; i++) { int16_t m = (int16_t)cs_clampf(w[i] * 10.f, -32767, 32767); p[8 + i * 2] = m & 0xFF; p[9 + i * 2] = (m >> 8) & 0xFF; }
      chRaw.writeValue(p, 14);
    }
  }
  if (connected && now - lastState >= 100) { lastState = now; sendState(now); }

  /* ไฟสถานะ */
  if (now - lastBlink >= 500) { lastBlink = now; blink = !blink; }
  if (!connected)                      led(false, false, blink);
  else if (S.phase == CS_PH_RUN)       led(blink, false, false);
  else if (S.phase == CS_PH_CAL || S.phase == CS_PH_READY) led(true, true, false);
  else                                 led(false, true, false);
}
