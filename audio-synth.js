/**
 * Audio Synthesizer Module
 * Provides piano sound playback using Tone.js sampler
 * Used as fallback when no MIDI output is connected
 */

const AudioSynth = {
    sampler: null,
    isLoading: false,
    isReady: false,
    
    /**
     * Initialize the sampler with piano samples
     */
    async init() {
        if (this.sampler || this.isLoading) return;
        
        await Tone.start();
        this.isLoading = true;
        console.log("Loading piano samples...");
        
        try {
            this.sampler = new Tone.Sampler({
                urls: {
                    A0: "A0.mp3", C1: "C1.mp3", "D#1": "Ds1.mp3", "F#1": "Fs1.mp3",
                    A1: "A1.mp3", C2: "C2.mp3", "D#2": "Ds2.mp3", "F#2": "Fs2.mp3",
                    A2: "A2.mp3", C3: "C3.mp3", "D#3": "Ds3.mp3", "F#3": "Fs3.mp3",
                    A3: "A3.mp3", C4: "C4.mp3", "D#4": "Ds4.mp3", "F#4": "Fs4.mp3",
                    A4: "A4.mp3", C5: "C5.mp3", "D#5": "Ds5.mp3", "F#5": "Fs5.mp3",
                    A5: "A5.mp3", C6: "C6.mp3", "D#6": "Ds6.mp3", "F#6": "Fs6.mp3",
                    A6: "A6.mp3", C7: "C7.mp3", "D#7": "Ds7.mp3", "F#7": "Fs7.mp3",
                    A7: "A7.mp3", C8: "C8.mp3"
                },
                release: 1,
                baseUrl: "https://tonejs.github.io/audio/salamander/",
                onload: () => {
                    this.isReady = true;
                    this.isLoading = false;
                    console.log("Piano samples loaded!");
                }
            }).toDestination();
        } catch (error) {
            console.error("Failed to load piano samples:", error);
            this.isLoading = false;
        }
    },
    
    /**
     * Convert MIDI note number to note name
     */
    midiToNoteName(midiNote) {
        const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
        const octave = Math.floor(midiNote / 12) - 1;
        return noteNames[midiNote % 12] + octave;
    },
    
    /**
     * Play a note
     */
    async noteOn(midiNote, velocity) {
        if (!this.sampler) await this.init();
        if (!this.isReady) return;
        
        try {
            const noteName = this.midiToNoteName(midiNote);
            this.sampler.triggerAttack(noteName, undefined, velocity / 127);
        } catch (error) {
            console.error(`Error playing note ${midiNote}:`, error);
        }
    },
    
    /**
     * Stop a note
     */
    noteOff(midiNote) {
        if (!this.sampler || !this.isReady) return;
        
        try {
            this.sampler.triggerRelease(this.midiToNoteName(midiNote));
        } catch (error) {
            console.error(`Error stopping note ${midiNote}:`, error);
        }
    },
    
    /**
     * Stop all notes
     */
    stopAll() {
        if (this.sampler && this.isReady) {
            this.sampler.releaseAll();
        }
    },
    
    /**
     * Set volume (0-1)
     */
    setVolume(volume) {
        if (this.sampler && this.isReady) {
            this.sampler.volume.value = Tone.gainToDb(volume);
        }
    }
};

// Initialize on first user interaction
['click', 'keydown', 'touchstart'].forEach(eventType => {
    document.addEventListener(eventType, () => AudioSynth.init(), { once: true });
});