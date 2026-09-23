/* ============================================================
   cs_imu_core.h — แกนคำนวณเซ็นเซอร์คาดเอวของ CareSignal (C ล้วน ไม่ผูกกับ Arduino)
   ------------------------------------------------------------
   เป็น "ฝาแฝด" ของ cs-imu.js ในแอป: ฟังก์ชัน ลำดับคำสั่ง และค่าคงที่ตรงกันบรรทัดต่อบรรทัด
   แอปมีชุดทดสอบ (test/test_imu.mjs) ที่ตรวจว่าค่าคงที่ในไฟล์นี้ตรงกับฝั่ง JS ทุกตัว
   แก้ค่าที่หนึ่งต้องแก้อีกที่หนึ่งเสมอ

   สิ่งที่วัด (เซ็นเซอร์ที่เอว = ตำแหน่งมาตรฐานของงานวิจัยการเคลื่อนไหว)
     · ลุกนั่ง 5 ครั้ง (instrumented 5×STS): เวลารวม เวลาแต่ละครั้ง ช่วงลุกจากเก้าอี้
       ความเร็วก้มลำตัวสูงสุด ความเร่งแนวตั้งสูงสุด มุมก้มสูงสุด ความสม่ำเสมอ (CV)
     · ลุกเดิน 3 เมตร (instrumented TUG): ช่วงลุก · เดินไป · หมุนตัว (องศา เวลา ความเร็วสูงสุด)
       · เดินกลับ · หมุนก่อนนั่ง · นั่งลง · จำนวนก้าว จังหวะก้าว ความสม่ำเสมอของก้าว
       ความเร็วเดินโดยประมาณจากระยะ 3 เมตร
     · ทรงตัว 10 วินาที: การแกว่งของลำตัว (RMS · แกนหลัก/รอง · พื้นที่วงรี 95% · jerk ·
       ความถี่เฉลี่ย · ระยะทาง) และธง "ขยับตัวมาก" ให้ผู้ดูแลยืนยัน
     · แรงกระแทกเกิน 3 g ทุกช่วง

   ไม่ขึ้นกับทิศติดตั้ง: หาแนวตั้งจากเวกเตอร์แรงโน้มถ่วง (complementary filter) แล้วแยก
   การหมุนในระนาบราบ (ก้มลำตัว) ออกจากการหมุนรอบแกนตั้ง (หมุนตัว)
   ============================================================ */
#ifndef CS_IMU_CORE_H
#define CS_IMU_CORE_H
#include <stdint.h>
#include <math.h>
#include <string.h>

/* ---------- ค่าคงที่ (ต้องตรงกับ P ใน cs-imu.js) ---------- */
#define CS_K_G        0.02f   /* น้ำหนักแก้ทิศแรงโน้มถ่วงด้วยความเร่ง */
#define CS_TAU_V      1.0f    /* วินาที · ตัวรวมความเร็วแนวตั้งแบบรั่วขณะนิ่ง */
#define CS_TAU_MOVE   10      /* วินาที · ขณะเคลื่อนไหวแทบไม่รั่ว */
#define CS_MOVE_W     15      /* องศา/วิ · ลำตัวเริ่มขยับ */
#define CS_V_UP       0.20f   /* เมตร/วิ · กำลังลุก/นั่ง */
#define CS_V_END      0.06f   /* เมตร/วิ · จบการเปลี่ยนท่า */
#define CS_D_MIN      0.12f   /* เมตร · ระยะแนวตั้งขั้นต่ำจึงนับเป็นลุก/นั่ง */
#define CS_QUIET_S    0.3f    /* วินาที · นิ่งนานเท่านี้ = ความเร็วแนวตั้งศูนย์ */
#define CS_YAW_ON     25      /* องศา/วิ · กำลังหมุนตัว */
#define CS_YAW_OFF_MS 250     /* หยุดหมุนนานเท่านี้ = จบการหมุน */
#define CS_TURN_MIN   90      /* องศา · การหมุนกลับตัวครั้งแรก */
#define CS_TURN2_MIN  60      /* องศา · หมุนก่อนนั่ง */
#define CS_STEP_TH    0.06f   /* g · ยอดความเร่งแนวตั้งของก้าว */
#define CS_STEP_MIN_MS 250    /* ก้าวห่างกันอย่างน้อย */
#define CS_IMPACT_G   3.0f    /* g · แรงกระแทก */
#define CS_BAL_SEC    10      /* วินาที · ท่าทรงตัว */
#define CS_TUG_M      3       /* เมตร · ระยะเดิน TUG */
#define CS_CAL_N      100     /* ตัวอย่างนิ่งก่อนเริ่ม */
#define CS_CAL_W      30      /* องศา/วิ · นิ่งพอสำหรับตั้งศูนย์ */

#define CS_RESULT_BYTES 84
#define CS_STATE_BYTES  16
#define CS_MAX_REPS  6
#define CS_MAX_TURNS 3
#define CS_MAX_STEPS 240

enum { CS_KIND_NONE = 0, CS_KIND_FTSST = 1, CS_KIND_TUG = 2, CS_KIND_BALANCE = 3 };
enum { CS_PH_IDLE = 0, CS_PH_CAL = 1, CS_PH_READY = 2, CS_PH_RUN = 3, CS_PH_DONE = 4 };
enum { CS_EV_NONE = 0, CS_EV_READY = 1, CS_EV_HOLD = 2, CS_EV_ONSET = 3, CS_EV_STAND = 4, CS_EV_SIT = 5, CS_EV_TURN = 6, CS_EV_STEP = 7, CS_EV_IMPACT = 8, CS_EV_DONE = 9 };
enum { CS_ST_OK = 0, CS_ST_INCOMPLETE = 1, CS_ST_ABORTED = 2 };
enum { CS_LAST_NONE = 0, CS_LAST_STAND = 1, CS_LAST_SIT = 2 };

typedef struct { uint32_t leanAt, standAt, sitAt, sitStart; float sts, dur, peakW, peakAv; uint8_t hasSit; } cs_rep_t;
typedef struct { uint32_t start, end; float deg, peak; } cs_turn_t;

typedef struct {
  uint8_t kind, stage, phase, done, status;
  uint32_t n; uint32_t tPrev; uint8_t hasPrev; float fsSum;
  float g[3], v0[3]; uint8_t hasG;
  int calN; float calSum[3], calMag, calMove; uint16_t holds;
  uint32_t t0, onset; uint8_t hasOnset; int moveRun;
  float vv, avB, quietRun; uint32_t lastLowT; uint8_t hasLow;
  uint8_t trDir; uint32_t trStart; float trD;      /* trDir: 0 ไม่มี · 1 ขึ้น · 2 ลง */
  uint8_t lastEv;
  uint8_t curOn, curHasLean, curQuiet; uint32_t curLeanAt; float curPeakW, curPeakAv;
  cs_rep_t reps[CS_MAX_REPS]; uint8_t nReps; float tiltMax;
  uint32_t stsEnd; uint8_t hasStsEnd; uint32_t sitAt; uint8_t hasSitAt; uint32_t descentAt;
  float yawInt; uint8_t turnOn; uint32_t turnStart, turnLastOn; float turnSum, turnPeak; cs_turn_t turns[CS_MAX_TURNS]; uint8_t nTurns;
  float stepEma, stepLp, stepPrev; uint8_t stepRise; uint32_t lastStepT; uint8_t hasLastStep; uint32_t steps[CS_MAX_STEPS]; uint16_t nSteps;
  struct { float e1[3], e2[3]; uint32_t n; float sx, sy, sxx, syy, sxy, path, jerk2, sa2; float prev[3], f[3]; uint8_t hasF, hasPrev, stepped; } bal;
  uint8_t impact; uint32_t impactAt; float maxG;
  /* ค่าสดสำหรับส่งขึ้นแอป */
  float tilt, wh, av, yawRate; uint8_t lastEvent;
  uint8_t result[CS_RESULT_BYTES];
} cs_imu_t;

/* ---------- เวกเตอร์ ---------- */
static inline float cs_dot(const float *a, const float *b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
static inline void cs_cross(const float *a, const float *b, float *o) { o[0] = a[1] * b[2] - a[2] * b[1]; o[1] = a[2] * b[0] - a[0] * b[2]; o[2] = a[0] * b[1] - a[1] * b[0]; }
static inline float cs_norm(const float *a) { return sqrtf(cs_dot(a, a)); }
static inline void cs_unit(const float *a, float *o) { float n = cs_norm(a); if (n > 1e-9f) { o[0] = a[0] / n; o[1] = a[1] / n; o[2] = a[2] / n; } else { o[0] = 0; o[1] = 0; o[2] = 1; } }
static inline float cs_clampf(float v, float a, float b) { return v < a ? a : v > b ? b : v; }

static void cs_imu_init(cs_imu_t *s, uint8_t kind, uint8_t stage) { memset(s, 0, sizeof(*s)); s->kind = kind; s->stage = stage; s->phase = CS_PH_IDLE; }
static void cs_imu_arm(cs_imu_t *s) { s->phase = CS_PH_CAL; s->calN = 0; s->calSum[0] = s->calSum[1] = s->calSum[2] = 0; s->calMag = 0; s->calMove = 0; s->hasPrev = 0; }
static void cs_bal_begin(cs_imu_t *s) {
  float ax[3] = { 1, 0, 0 }, ay[3] = { 0, 1, 0 }, tmp[3];
  const float *pick = fabsf(s->g[0]) < 0.9f ? ax : ay;
  cs_cross(s->g, pick, tmp); cs_unit(tmp, s->bal.e1); cs_cross(s->g, s->bal.e1, tmp); cs_unit(tmp, s->bal.e2);
}
static int cs_imu_go(cs_imu_t *s, uint32_t t) { if (s->phase != CS_PH_READY) return 0; s->phase = CS_PH_RUN; s->t0 = t; if (s->kind == CS_KIND_BALANCE) cs_bal_begin(s); return 1; }

static void cs_imu_finish(cs_imu_t *s, uint32_t t, uint8_t status);

static int cs_transition(cs_imu_t *s, int stand, uint32_t t, uint32_t start) {
  if (stand) {
    if (s->lastEv == CS_LAST_STAND) return 0; s->lastEv = CS_LAST_STAND;
    if (s->nReps < CS_MAX_REPS) {
      cs_rep_t *r = &s->reps[s->nReps++]; memset(r, 0, sizeof(*r));
      uint32_t lean = (s->curOn && s->curHasLean) ? s->curLeanAt : start;
      r->leanAt = lean; r->standAt = t; r->sts = (float)(int32_t)(t - lean); r->peakW = s->curOn ? s->curPeakW : 0; r->peakAv = s->curOn ? s->curPeakAv : 0;
    }
    if (s->kind == CS_KIND_TUG && !s->hasStsEnd) { s->stsEnd = t; s->hasStsEnd = 1; }
    return CS_EV_STAND;
  }
  if (s->lastEv != CS_LAST_STAND) return 0;
  if (s->nReps == 0) return 0;
  cs_rep_t *r = &s->reps[s->nReps - 1]; if (r->hasSit) return 0;
  s->lastEv = CS_LAST_SIT;
  r->sitAt = t; r->sitStart = start; r->hasSit = 1;
  uint32_t prev = s->nReps > 1 ? s->reps[s->nReps - 2].sitAt : (s->hasOnset ? s->onset : s->t0);
  r->dur = (float)(int32_t)(t - prev);
  s->curOn = 1; s->curHasLean = 0; s->curPeakW = 0; s->curPeakAv = 0; s->curQuiet = 0;
  if (s->kind == CS_KIND_FTSST && s->nReps >= 5) cs_imu_finish(s, t, CS_ST_OK);
  if (s->kind == CS_KIND_TUG) { s->sitAt = t; s->hasSitAt = 1; s->descentAt = start; cs_imu_finish(s, t, CS_ST_OK); }
  return CS_EV_SIT;
}
static int cs_turn_step(cs_imu_t *s, uint32_t t, float dt, float yawRate) {
  s->yawInt += yawRate * dt; float ay = fabsf(yawRate);
  if (!s->turnOn) { if (ay > CS_YAW_ON) { s->turnOn = 1; s->turnStart = t; s->turnSum = 0; s->turnPeak = 0; s->turnLastOn = t; } return 0; }
  s->turnSum += yawRate * dt; if (ay > s->turnPeak) s->turnPeak = ay; if (ay > CS_YAW_ON) s->turnLastOn = t;
  if ((int32_t)(t - s->turnLastOn) > CS_YAW_OFF_MS) {
    s->turnOn = 0; float need = s->nTurns ? CS_TURN2_MIN : CS_TURN_MIN;
    if (fabsf(s->turnSum) >= need && s->nTurns < CS_MAX_TURNS) { cs_turn_t *tn = &s->turns[s->nTurns++]; tn->start = s->turnStart; tn->end = s->turnLastOn; tn->deg = fabsf(s->turnSum); tn->peak = s->turnPeak; return CS_EV_TURN; }
  }
  return 0;
}
static int cs_step_step(cs_imu_t *s, uint32_t t, float dt, float av) {
  s->stepEma += (av - s->stepEma) * (dt / (0.5f + dt)); float hp = av - s->stepEma;
  s->stepLp += (hp - s->stepLp) * (dt / (0.05f + dt));
  int ev = 0;
  if (s->stepLp > s->stepPrev) s->stepRise = 1;
  else if (s->stepRise) { s->stepRise = 0; if (s->stepPrev > CS_STEP_TH && (!s->hasLastStep || (int32_t)(t - s->lastStepT) > CS_STEP_MIN_MS)) { s->lastStepT = t; s->hasLastStep = 1; if (s->nSteps < CS_MAX_STEPS) s->steps[s->nSteps++] = t; ev = CS_EV_STEP; } }
  s->stepPrev = s->stepLp; return ev;
}
static int cs_bal_step(cs_imu_t *s, uint32_t t, float dt, float av, const float *ah, float ahn, float wh, uint32_t el) {
  float x = cs_dot(ah, s->bal.e1), y = cs_dot(ah, s->bal.e2);
  s->bal.n++; s->bal.sx += x; s->bal.sy += y; s->bal.sxx += x * x; s->bal.syy += y * y; s->bal.sxy += x * y;
  float k = dt / (0.15f + dt);
  if (!s->bal.hasF) { s->bal.f[0] = ah[0]; s->bal.f[1] = ah[1]; s->bal.f[2] = ah[2]; s->bal.hasF = 1; }
  else { s->bal.f[0] += (ah[0] - s->bal.f[0]) * k; s->bal.f[1] += (ah[1] - s->bal.f[1]) * k; s->bal.f[2] += (ah[2] - s->bal.f[2]) * k; }
  s->bal.sa2 += cs_dot(s->bal.f, s->bal.f);
  if (s->bal.hasPrev) { float dx = s->bal.f[0] - s->bal.prev[0], dy = s->bal.f[1] - s->bal.prev[1], dz = s->bal.f[2] - s->bal.prev[2], dn = sqrtf(dx * dx + dy * dy + dz * dz); s->bal.path += dn; float j = dn / dt; s->bal.jerk2 += j * j; }
  s->bal.prev[0] = s->bal.f[0]; s->bal.prev[1] = s->bal.f[1]; s->bal.prev[2] = s->bal.f[2]; s->bal.hasPrev = 1;
  if (wh > 60 || fabsf(av) > 0.25f || ahn > 0.5f) s->bal.stepped = 1;
  if (el >= (uint32_t)CS_BAL_SEC * 1000u) { cs_imu_finish(s, t, CS_ST_OK); return CS_EV_DONE; }
  return 0;
}

/* ป้อนตัวอย่าง 1 ชุด: a = ความเร่ง (g) · w = อัตราหมุน (องศา/วิ) · t = มิลลิวินาที · คืนรหัสเหตุการณ์ */
static int cs_imu_push(cs_imu_t *s, uint32_t t, const float *a, const float *w) {
  if (s->phase == CS_PH_IDLE || s->done) return 0;
  float dt = !s->hasPrev ? 0.01f : cs_clampf((float)(int32_t)(t - s->tPrev) / 1000.0f, 0.002f, 0.05f); s->tPrev = t; s->hasPrev = 1; s->n++; s->fsSum += dt;
  float an = cs_norm(a); if (an > s->maxG) s->maxG = an;
  int ev = CS_EV_NONE;
  if (an > CS_IMPACT_G && !s->impact) { s->impact = 1; s->impactAt = t; ev = CS_EV_IMPACT; }
  if (!s->hasG) { cs_unit(a, s->g); s->hasG = 1; }
  /* ทิศแรงโน้มถ่วงในกรอบเซ็นเซอร์: หมุนตามไจโร แล้วดึงเข้าหาความเร่งเล็กน้อย */
  float wr[3] = { w[0] * 0.017453292f, w[1] * 0.017453292f, w[2] * 0.017453292f }, cx[3], gp[3], gu[3], au[3], mix[3];
  cs_cross(wr, s->g, cx); gp[0] = s->g[0] - cx[0] * dt; gp[1] = s->g[1] - cx[1] * dt; gp[2] = s->g[2] - cx[2] * dt; cs_unit(gp, gu);
  if (an > 1e-6f) { au[0] = a[0] / an; au[1] = a[1] / an; au[2] = a[2] / an; } else { au[0] = gu[0]; au[1] = gu[1]; au[2] = gu[2]; }
  mix[0] = gu[0] * (1 - CS_K_G) + au[0] * CS_K_G; mix[1] = gu[1] * (1 - CS_K_G) + au[1] * CS_K_G; mix[2] = gu[2] * (1 - CS_K_G) + au[2] * CS_K_G; cs_unit(mix, s->g);
  if (s->phase == CS_PH_CAL) {
    s->calSum[0] += a[0]; s->calSum[1] += a[1]; s->calSum[2] += a[2]; s->calMag += an; s->calN++; float wn = cs_norm(w); if (wn > s->calMove) s->calMove = wn;
    if (s->calN >= CS_CAL_N) {
      if (s->calMove < CS_CAL_W) { cs_unit(s->calSum, s->v0); s->g[0] = s->v0[0]; s->g[1] = s->v0[1]; s->g[2] = s->v0[2]; s->avB = s->calMag / s->calN - 1; s->phase = CS_PH_READY; ev = CS_EV_READY; }
      else { s->calN = 0; s->calSum[0] = s->calSum[1] = s->calSum[2] = 0; s->calMag = 0; s->calMove = 0; s->holds++; ev = CS_EV_HOLD; }
    }
    s->lastEvent = ev; return ev;
  }
  float gd = cs_dot(a, s->g), av = gd - 1, ah[3] = { a[0] - s->g[0] * gd, a[1] - s->g[1] * gd, a[2] - s->g[2] * gd }, ahn = cs_norm(ah);
  float tilt = acosf(cs_clampf(cs_dot(s->g, s->v0), -1, 1)) * 57.29578f;
  float wg = cs_dot(w, s->g), whv[3] = { w[0] - s->g[0] * wg, w[1] - s->g[1] * wg, w[2] - s->g[2] * wg }, wh = cs_norm(whv), yawRate = wg;
  s->tilt = tilt; s->wh = wh; s->av = av; s->yawRate = yawRate;
  if (s->phase != CS_PH_RUN) { s->lastEvent = ev; return ev; }
  uint32_t el = t - s->t0;
  if (tilt > s->tiltMax) s->tiltMax = tilt;
  if (!s->hasOnset) { s->moveRun = wh > CS_MOVE_W ? s->moveRun + 1 : 0; if (s->moveRun >= 5) { s->onset = t; s->hasOnset = 1; ev = CS_EV_ONSET; if (s->kind != CS_KIND_BALANCE) { s->curOn = 1; s->curHasLean = 1; s->curLeanAt = t; s->curPeakW = 0; s->curPeakAv = 0; s->curQuiet = 0; } } }
  if (s->kind == CS_KIND_BALANCE) { int e2 = cs_bal_step(s, t, dt, av, ah, ahn, wh, el); if (e2) ev = e2; s->lastEvent = ev; return ev; }
  /* ความเร็วแนวตั้ง: รวมแบบรั่ว + ปรับค่าคลาดขณะนิ่ง + ล้างศูนย์เมื่อนิ่งเกิน 0.3 วิ */
  int quiet = wh < CS_MOVE_W && fabsf(av - s->avB) < 0.05f;
  if (quiet) { s->avB += (av - s->avB) * (dt / (2 + dt)); s->quietRun += dt; } else s->quietRun = 0;
  float avd = av - s->avB;
  float tau = (fabsf(avd) > 0.05f || wh > CS_MOVE_W) ? (float)CS_TAU_MOVE : CS_TAU_V;
  s->vv += avd * 9.81f * dt; s->vv *= (1 - dt / tau);
  if (s->quietRun > CS_QUIET_S) s->vv = 0;
  if (fabsf(s->vv) < 2 * CS_V_END) { s->lastLowT = t; s->hasLow = 1; }
  uint32_t lowT = s->hasLow ? s->lastLowT : t;
  if (!s->trDir) { if (s->vv > CS_V_UP) { s->trDir = 1; s->trStart = lowT; s->trD = 0; } else if (s->vv < -CS_V_UP) { s->trDir = 2; s->trStart = lowT; s->trD = 0; } }
  else {
    float dir = s->trDir == 1 ? 1.f : -1.f; s->trD += s->vv * dt;
    if (dir * s->vv < CS_V_END) { uint8_t d = s->trDir; uint32_t st0 = s->trStart; float dd = s->trD; s->trDir = 0; if (dir * dd >= CS_D_MIN) { int e2 = cs_transition(s, d == 1, t, st0); if (e2) ev = e2; } }
  }
  if (s->curOn) {
    if (wh > s->curPeakW) s->curPeakW = wh; if (avd > s->curPeakAv) s->curPeakAv = avd;
    if (!s->curHasLean) { if (wh < CS_MOVE_W) s->curQuiet = 1; s->moveRun = (s->curQuiet && wh > CS_MOVE_W) ? s->moveRun + 1 : 0; if (s->moveRun >= 3) { s->curHasLean = 1; s->curLeanAt = t; } }
  }
  if (s->kind == CS_KIND_TUG && s->hasStsEnd && !s->hasSitAt && !s->done) {
    int e3 = cs_turn_step(s, t, dt, yawRate); if (e3) ev = e3;
    int e4 = cs_step_step(s, t, dt, avd); if (e4) ev = e4;
  }
  s->lastEvent = ev; return ev;
}

/* ---------- ผล 84 ไบต์ (little-endian · ค่าที่ไม่มี = 0xFFFF / 0xFFFFFFFF / -32768) ---------- */
static void cs_put16(uint8_t *b, int o, uint16_t v) { b[o] = v & 0xFF; b[o + 1] = v >> 8; }
static void cs_puti16(uint8_t *b, int o, int16_t v) { cs_put16(b, o, (uint16_t)v); }
static void cs_put32(uint8_t *b, int o, uint32_t v) { b[o] = v & 0xFF; b[o + 1] = (v >> 8) & 0xFF; b[o + 2] = (v >> 16) & 0xFF; b[o + 3] = v >> 24; }
static uint16_t cs_u16(float v, float k, int has) { if (!has) return 0xFFFF; float x = v * k + 0.5f; if (x < 0) x = 0; if (x > 65534) x = 65534; return (uint16_t)x; }
static int16_t cs_i16(float v, float k, int has) { if (!has) return -32768; float x = v * k; x = x < 0 ? x - 0.5f : x + 0.5f; if (x < -32767) x = -32767; if (x > 32767) x = 32767; return (int16_t)x; }
static float cs_cv(const float *xs, int n) { if (n < 2) return -1; float m = 0; for (int i = 0; i < n; i++) m += xs[i]; m /= n; float v = 0; for (int i = 0; i < n; i++) v += (xs[i] - m) * (xs[i] - m); v /= (n - 1); return m > 0 ? sqrtf(v) / m * 100 : -1; }

static void cs_imu_finish(cs_imu_t *s, uint32_t t, uint8_t status) {
  s->done = 1; s->phase = CS_PH_DONE; s->status = status;
  uint8_t *b = s->result; memset(b, 0xFF, CS_RESULT_BYTES);
  float fs = s->n > 1 ? (float)(s->n - 1) / s->fsSum : 0;
  uint8_t flags = (s->impact ? 1 : 0) | (s->bal.stepped ? 2 : 0) | (s->nTurns ? 4 : 0);
  b[0] = 0xC5; b[1] = 1; b[2] = s->kind; b[4] = 0; b[5] = flags;
  cs_put16(b, 6, cs_u16(fs, 10, s->n > 1)); cs_put32(b, 8, t - s->t0); cs_put32(b, 12, s->hasOnset ? s->onset - s->t0 : 0xFFFFFFFFu);
  float peakW = 0, peakAv = 0; for (int i = 0; i < s->nReps; i++) { if (s->reps[i].peakW > peakW) peakW = s->reps[i].peakW; if (s->reps[i].peakAv > peakAv) peakAv = s->reps[i].peakAv; }
  cs_puti16(b, 20, cs_i16(peakW, 10, 1)); cs_puti16(b, 22, cs_i16(peakAv, 1000, 1)); cs_puti16(b, 24, cs_i16(s->tiltMax, 10, 1));
  b[52] = 0; b[53] = 0; cs_put16(b, 74, cs_u16(s->maxG, 100, 1)); cs_put32(b, 76, s->impact ? s->impactAt - s->t0 : 0xFFFFFFFFu); cs_put16(b, 80, (uint16_t)(s->n > 65535 ? 65535 : s->n)); cs_put16(b, 82, 0);
  if (s->kind == CS_KIND_FTSST) {
    float durs[CS_MAX_REPS], stsSum = 0; int nf = 0;
    for (int i = 0; i < s->nReps; i++) if (s->reps[i].hasSit) { durs[nf] = s->reps[i].dur; stsSum += s->reps[i].sts; if (nf < 5) cs_put16(b, 26 + nf * 2, cs_u16(s->reps[i].dur, 1, 1)); nf++; }
    b[4] = (uint8_t)nf; cs_put16(b, 16, cs_u16(nf ? stsSum / nf : 0, 1, nf > 0)); float cv = cs_cv(durs, nf); cs_put16(b, 18, cs_u16(cv, 10, cv >= 0));
    if (status == CS_ST_OK && nf < 5) status = CS_ST_INCOMPLETE;
  } else if (s->kind == CS_KIND_TUG) {
    cs_turn_t *t1 = s->nTurns > 0 ? &s->turns[0] : 0, *t2 = s->nTurns > 1 ? &s->turns[1] : 0;
    int hasEnd = t2 || s->hasSitAt; uint32_t endWalk = t2 ? t2->start : s->descentAt;
    int hasOut = t1 && s->hasStsEnd, hasBack = t1 && hasEnd;
    float walkOut = hasOut ? (float)(int32_t)(t1->start - s->stsEnd) : 0, walkBack = hasBack ? (float)(int32_t)(endWalk - t1->end) : 0;
    /* ก้าวในช่วงเดิน (ไม่นับช่วงหมุนและช่วงนั่งลง) */
    uint32_t stepsW[CS_MAX_STEPS]; int nw = 0;
    for (int i = 0; i < s->nSteps; i++) { uint32_t st = s->steps[i]; if (!s->hasStsEnd) continue;
      int inOut = t1 ? (int32_t)(st - t1->start) < 0 : (!hasEnd || (int32_t)(st - endWalk) < 0);
      int inBack = t1 && (int32_t)(st - t1->end) >= 0 && (!hasEnd || (int32_t)(st - endWalk) < 0);
      if (inOut || inBack) stepsW[nw++] = st; }
    float ivs[CS_MAX_STEPS]; int ni = 0; for (int i = 1; i < nw; i++) { float d = (float)(int32_t)(stepsW[i] - stepsW[i - 1]); if (d < 2000) ivs[ni++] = d; }
    int hasWalk = hasOut && hasBack; float walkMs = walkOut + walkBack;
    cs_put16(b, 36, cs_u16(s->hasStsEnd && s->hasOnset ? (float)(int32_t)(s->stsEnd - s->onset) : 0, 1, s->hasStsEnd && s->hasOnset));
    cs_put16(b, 38, cs_u16(walkOut, 1, hasOut)); cs_put16(b, 40, cs_u16(t1 ? (float)(int32_t)(t1->end - t1->start) : 0, 1, t1 != 0)); cs_put16(b, 42, cs_u16(walkBack, 1, hasBack));
    cs_put16(b, 44, cs_u16(t2 ? (float)(int32_t)(t2->end - t2->start) : 0, 1, t2 != 0)); cs_put16(b, 46, cs_u16(s->hasSitAt ? (float)(int32_t)(s->sitAt - s->descentAt) : 0, 1, s->hasSitAt));
    cs_put16(b, 48, cs_u16(t1 ? t1->deg : 0, 10, t1 != 0)); cs_put16(b, 50, cs_u16(t1 ? t1->peak : 0, 10, t1 != 0)); b[52] = (uint8_t)(nw > 255 ? 255 : nw);
    cs_put16(b, 54, cs_u16(hasWalk && walkMs > 0 && nw ? nw / (walkMs / 60000.f) : 0, 10, hasWalk && walkMs > 0 && nw > 0));
    float scv = cs_cv(ivs, ni); cs_put16(b, 56, cs_u16(scv, 10, scv >= 0));
    cs_put16(b, 58, cs_u16(hasWalk && walkMs > 0 ? 2.f * CS_TUG_M / (walkMs / 1000.f) : 0, 100, hasWalk && walkMs > 0));
    if (status == CS_ST_OK && !s->hasSitAt) status = CS_ST_INCOMPLETE;
  } else {
    float n = s->bal.n ? (float)s->bal.n : 1, mx = s->bal.sx / n, my = s->bal.sy / n, cxx = s->bal.sxx / n - mx * mx, cyy = s->bal.syy / n - my * my, cxy = s->bal.sxy / n - mx * my;
    float h = (cxx + cyy) / 2, q = sqrtf(fmaxf(0, ((cxx - cyy) / 2) * ((cxx - cyy) / 2) + cxy * cxy)), l1 = fmaxf(0, h + q), l2 = fmaxf(0, h - q);
    float held = fminf((float)CS_BAL_SEC, (float)(int32_t)(t - s->t0) / 1000.f);
    float freq = s->bal.sa2 > 1e-12f ? sqrtf(s->bal.jerk2 / n) / sqrtf(s->bal.sa2 / n) / 6.2831853f : 0;
    cs_put16(b, 60, cs_u16(held, 1000, 1)); cs_put16(b, 62, cs_u16(sqrtf(fmaxf(0, cxx + cyy)) * 9.81f, 1000, 1));
    cs_put16(b, 64, cs_u16(sqrtf(l1) * 9.81f, 1000, 1)); cs_put16(b, 66, cs_u16(sqrtf(l2) * 9.81f, 1000, 1));
    cs_put16(b, 68, cs_u16(sqrtf(s->bal.jerk2 / n) * 9.81f, 10, 1)); cs_put16(b, 70, cs_u16(freq, 100, s->bal.sa2 > 1e-12f)); cs_put16(b, 72, cs_u16(s->bal.path * 9.81f, 100, 1));
  }
  s->status = status; b[3] = status;
}
static void cs_imu_stop(cs_imu_t *s, uint32_t t) {
  if (s->phase == CS_PH_RUN && !s->done) cs_imu_finish(s, t, s->kind == CS_KIND_BALANCE ? CS_ST_OK : CS_ST_INCOMPLETE);
  else if (!s->done) { s->done = 1; s->phase = CS_PH_DONE; s->status = CS_ST_ABORTED; memset(s->result, 0xFF, CS_RESULT_BYTES); s->result[0] = 0xC5; s->result[1] = 1; s->result[2] = s->kind; s->result[3] = CS_ST_ABORTED; }
}
/* สถานะสด 16 ไบต์สำหรับแอป (ส่งทุก 100 ms) */
static void cs_imu_state(const cs_imu_t *s, uint32_t now, uint8_t *o) {
  memset(o, 0, CS_STATE_BYTES); o[0] = 0xC5; o[1] = s->kind; o[2] = s->phase;
  uint8_t cnt = 0; for (int i = 0; i < s->nReps; i++) if (s->reps[i].hasSit) cnt++;
  o[3] = s->kind == CS_KIND_TUG ? s->nTurns : cnt;
  cs_put32(o, 4, s->phase == CS_PH_RUN || s->phase == CS_PH_DONE ? now - s->t0 : 0);
  cs_puti16(o, 8, cs_i16(s->tilt, 10, 1)); cs_puti16(o, 10, cs_i16(s->wh, 10, 1));
  float yaw = fmodf(s->yawInt, 360.f); cs_puti16(o, 12, cs_i16(yaw, 10, 1));
  o[14] = s->lastEvent; o[15] = (s->impact ? 1 : 0) | (s->bal.stepped ? 2 : 0) | (s->done ? 8 : 0);
}
#endif
