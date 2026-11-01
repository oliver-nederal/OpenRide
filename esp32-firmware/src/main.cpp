#include <Arduino.h>
#include <esp32_smartdisplay.h>
#include <TinyGPS++.h>

#ifndef GPS_RX_PIN
#define GPS_RX_PIN 35
#endif
#ifndef GPS_TX_PIN
#define GPS_TX_PIN -1
#endif
#ifndef GPS_BAUD
#define GPS_BAUD 9600
#endif

// One parser per input so a floating GPIO 35 can't corrupt the USB stream
static TinyGPSPlus gpsUsb;
static TinyGPSPlus gpsPin;

static lv_obj_t *speedLabel   = nullptr;
static lv_obj_t *headingLabel = nullptr;
static lv_obj_t *satsLabel    = nullptr;
static lv_obj_t *fixLabel     = nullptr;
static lv_obj_t *rxLabel      = nullptr;

static lv_obj_t *createLabel(int y) {
    lv_obj_t *label = lv_label_create(lv_screen_active());
    lv_obj_set_style_text_font(label, &lv_font_montserrat_36, 0);
    lv_obj_set_style_text_color(label, lv_color_white(), 0);
    lv_obj_set_pos(label, 12, y);
    return label;
}

static void drawTelemetry() {
    // Show whichever input is delivering valid sentences
    TinyGPSPlus &gps = gpsPin.passedChecksum() > gpsUsb.passedChecksum() ? gpsPin : gpsUsb;
    bool fix = gps.location.isValid() && gps.location.age() < 2000;

    if (fix) {
        lv_label_set_text_fmt(speedLabel, "%d km/h", (int)lround(gps.speed.kmph()));
        lv_label_set_text_fmt(headingLabel, "HDG %03d", (int)lround(gps.course.deg()) % 360);
    } else {
        lv_label_set_text(speedLabel, "-- km/h");
        lv_label_set_text(headingLabel, "HDG ---");
    }
    lv_label_set_text_fmt(satsLabel, "SATS %d", (int)gps.satellites.value());
    lv_label_set_text(fixLabel, fix ? "FIX" : "NO FIX");
    lv_label_set_text_fmt(rxLabel, "USB OK %lu ERR %lu | PIN%d OK %lu",
                          (unsigned long)gpsUsb.passedChecksum(),
                          (unsigned long)gpsUsb.failedChecksum(),
                          GPS_RX_PIN,
                          (unsigned long)gpsPin.passedChecksum());
}

void setup() {
    // NMEA is accepted on both: the board's USB port and a USB-TTL adapter on GPIO 35
    Serial.begin(GPS_BAUD);
    Serial2.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
    delay(500);

    smartdisplay_init();
    lv_obj_set_style_bg_color(lv_screen_active(), lv_color_black(), 0);

    speedLabel   = createLabel(20);
    headingLabel = createLabel(95);
    satsLabel    = createLabel(170);
    fixLabel     = createLabel(245);

    rxLabel = lv_label_create(lv_screen_active());
    lv_obj_set_style_text_color(rxLabel, lv_color_white(), 0);
    lv_obj_set_pos(rxLabel, 12, 296);

    drawTelemetry();
}

static unsigned long lastTickMs = 0;
static unsigned long lastDrawMs = 0;

void loop() {
    unsigned long now = millis();
    lv_tick_inc(now - lastTickMs);
    lastTickMs = now;

    while (Serial.available() > 0) gpsUsb.encode(Serial.read());
    while (Serial2.available() > 0) gpsPin.encode(Serial2.read());

    if (now - lastDrawMs >= 200) {
        lastDrawMs = now;
        drawTelemetry();
    }

    lv_timer_handler();
    delay(5);
}
