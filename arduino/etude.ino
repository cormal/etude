#include <FastLED.h>
#include <Adafruit_NeoPixel.h>

// On-Board NeoPixel (Status Light)
#define NEO_PIN 10 
#define NUMPIXELS 1 
Adafruit_NeoPixel pixels(NUMPIXELS, NEO_PIN, NEO_GRB + NEO_KHZ800); // Changed to NEO_GRB for most modern boards

// External MIDI LED Strip
#define NUM_LEDS 144
#define DATA_PIN 7
CRGB leds[NUM_LEDS];

void setup() {
  // 1. Start Serial for Python Communication
  Serial.begin(115200);
  // On some boards like ESP32-S2/S3, while(!Serial) can hang if not plugged into a PC
  // while (!Serial); 

  // 2. Initialize the On-Board Pixel
  pixels.begin();
  pixels.setBrightness(50); // Keep on-board pixel dim so it doesn't blind you
  pixels.clear();
  pixels.show();

  // 3. Initialize the External FastLED Strip
  FastLED.addLeds<WS2812B, DATA_PIN, GRB>(leds, NUM_LEDS);
  FastLED.setBrightness(255); 
  fill_solid(leds, NUM_LEDS, CRGB::Black);
  FastLED.show();

  // 4. Flash On-Board Status Pixel (Red) 3 times
  for (int i = 0; i < 3; i++) {
    pixels.setPixelColor(0, pixels.Color( 0,255, 0)); // Red
    pixels.show();
    delay(200); // Shorter delays so the app starts faster
    
    pixels.setPixelColor(0, pixels.Color(0, 0, 0));   // Off
    pixels.show();
    delay(200);
  }
  
  Serial.println("READY"); // Tell Python we are good to go
}

void loop() {
  if (Serial.available() > 0) {
    // Read the incoming command
    String command = Serial.readStringUntil('\n');
    command.trim();

    // 1. THE RESET HANDLER (Halt)
    if (command.startsWith("R")) {
        // Clear the external strip
        fill_solid(leds, NUM_LEDS, CRGB::Black);
        FastLED.show();
        
        // Clear the on-board status pixel
        pixels.clear();
        pixels.show();
        return; 
    }
    
    // 2. STATUS INDICATOR (Blue: Data is hitting the board)
    pixels.setPixelColor(0, pixels.Color(0, 0, 255)); 
    pixels.show();

    if (command.length() > 0) {
        // GREEN: Command received
        pixels.setPixelColor(0, pixels.Color(0, 255, 0));
        pixels.show();
        processCommand(command);
    }

    // Brief flash for the status LED
    delay(5);
    pixels.setPixelColor(0, pixels.Color(0, 0, 0));
    pixels.show();
  }
}

void processCommand(String command) {
  int led_index, r, g, b, brightness_percent;
  
  // Try to parse 5 integers
  int found = sscanf(command.c_str(), "%d,%d,%d,%d,%d", &led_index, &r, &g, &b, &brightness_percent);
  
  if (found == 5) {
    // SUCCESS: Logic for LEDs
    if (led_index >= 0 && led_index < NUM_LEDS) {
      if (brightness_percent == 0 || (r == 0 && g == 0 && b == 0)) {
        leds[led_index] = CRGB::Black;
      } else {
        uint8_t scale = map(brightness_percent, 0, 100, 0, 255);
        CRGB color = CRGB(r, g, b);
        color.nscale8_video(scale); 
        leds[led_index] = color;
      }
      FastLED.show();
    }
  } else {
    // ERROR: Flash on-board LED RED if the data wasn't understood
    pixels.setPixelColor(0, pixels.Color(255, 0, 0)); 
    pixels.show();
    delay(50);
  }
}

void animation() {
  // Run animation up the strip
  for (int i = 0; i < NUM_LEDS; i++) {
    leds[i] = CRGB::Blue;  // Set the current LED to blue
    FastLED.show();        // Update the strip to show the change
    delay(30);             // Pause briefly (adjust for speed)
    leds[i] = CRGB::Black; // Turn off the current LED for a "moving pixel" effect
    FastLED.show();        // Update the strip to show the change
  }

  // Run animation back down the strip
  for (int i = NUM_LEDS - 1; i >= 0; i--) {
    leds[i] = CRGB::Red;   // Set the current LED to red
    FastLED.show();        // Update the strip
    delay(30);             // Pause briefly (adjust for speed)
    leds[i] = CRGB::Black; // Turn off the current LED
    FastLED.show();        // Update the strip to show the change
  }
}

void powerOnfadeEffect(CRGB color) {
  for (int i = 0; i <= 200; i++) {
    FastLED.setBrightness(i);
    fill_solid(leds, NUM_LEDS, color);
    FastLED.show();
  //  delay(interval);
  }
  for (int i = 200; i >= 0; i--) {
    FastLED.setBrightness(i);
    fill_solid(leds, NUM_LEDS, color);
    FastLED.show();
  //  delay(interval);
  }
  fill_solid(leds, NUM_LEDS, CRGB::Black);
  FastLED.show();
}
