/**
 * mxl2midi.js - Standalone MusicXML to MIDI Event Converter
 * Version 1.0
 * 
 * Converts MusicXML files (.xml, .musicxml, .mxl) to MIDI events
 * Supports two conversion methods:
 * 1. OSMD-based conversion (requires OpenSheetMusicDisplay library)
 * 2. Direct XML parsing (no dependencies)
 * 
 * Usage:
 * const converter = new MXL2MIDI();
 * const result = await converter.parseFile(file);
 * if (result.success) {
 *     const midiData = converter.convertToMIDI(result);
 *     console.log(midiData.midiEvents);
 * }
 */
 
 /**
 * mxl2midi.js - Standalone MusicXML to MIDI Event Converter
 * Version 2.0 - Fully standalone with automatic dependency loading
 */

(function() {
    'use strict';
    
    // Dependency loader - loads external libraries if not already present
    const dependencies = {
        pako: {
            url: 'https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js',
            check: () => typeof pako !== 'undefined'
        }
    };
    
    async function loadScript(url) {
        return new Promise((resolve, reject) => {
            if (typeof document === 'undefined') {
                // Node.js environment - use require or fetch
                reject(new Error('Node.js environment not yet supported'));
                return;
            }
            
            const script = document.createElement('script');
            script.src = url;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error(`Failed to load ${url}`));
            document.head.appendChild(script);
        });
    }
    
    async function ensureDependencies() {
        const promises = [];
        
        for (const [name, dep] of Object.entries(dependencies)) {
            if (!dep.check()) {
                console.log(`[MXL2MIDI] Loading dependency: ${name}...`);
                promises.push(loadScript(dep.url));
            }
        }
        
        if (promises.length > 0) {
            await Promise.all(promises);
            console.log('[MXL2MIDI] All dependencies loaded');
        }
    }
    
    // Store the initialization promise globally
    window._mxl2midiInitPromise = ensureDependencies();
    
})();
 

class MXL2MIDI {
    constructor() {
        this.scoreData = null;
        this.osmd = null;
		this._ready = false;
        
        // Wait for dependencies to load
        if (typeof window !== 'undefined' && window._mxl2midiInitPromise) {
            window._mxl2midiInitPromise.then(() => {
                this._ready = true;
            }).catch(err => {
                console.error('[MXL2MIDI] Failed to load dependencies:', err);
                this._ready = true; // Continue anyway with fallback
            });
        } else {
            this._ready = true;
        }
    }
    
    /**
     * Ensure dependencies are loaded before processing
     */
    async _ensureReady() {
		console.log("[MXL2MIDI] Initializing dependency loader...");
        if (typeof window !== 'undefined' && window._mxl2midiInitPromise) {
            await window._mxl2midiInitPromise;
        }
    }

    /**
     * Parse a MusicXML file (.xml, .musicxml, or .mxl)
     * @param {File} file - The file to parse
     * @returns {Object} Parse result with success status and data
     */
    async parseFile(file) {
		console.log("[MXL2MIDI] parseFile called with:", file.name);
		await this._ensureReady(); // Wait for dependencies
		console.log("[MXL2MIDI] Dependencies ready");
		
		try {
			let xmlText;
			
			if (file.name.toLowerCase().endsWith('.mxl')) {
				console.log("[MXL2MIDI] Detected .mxl file, extracting...");;
                xmlText = await this.extractMXL(file);
                
                if (!xmlText) {
                    return {
                        success: false,
                        error: "Could not extract XML from .mxl file. Try extracting manually and loading the .xml file."
                    };
                }
                
                console.log("XML extracted successfully");
            } else {
                xmlText = await file.text();
            }
            
            const scoreData = this.parseXMLString(xmlText);
            
            if (!scoreData) {
                return {
                    success: false,
                    error: "Error parsing MusicXML. File may be corrupted."
                };
            }
            
            return {
                success: true,
                xmlString: xmlText,
                scoreData: scoreData
            };
            
        } catch (error) {
            console.error("MusicXML parse error:", error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Extract XML content from compressed .mxl file
     * @param {File} file - The .mxl file
     * @returns {string|null} Extracted XML string or null
     */

async extractMXL(file) {
    try {
        console.log("[MXL2MIDI] Starting MXL extraction...");
        console.log("[MXL2MIDI] pako available?", typeof pako !== 'undefined');
        console.log("[MXL2MIDI] File name:", file.name, "Size:", file.size);
        
        const arrayBuffer = await file.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);
        
        console.log("[MXL2MIDI] Parsing .mxl ZIP structure...");
            
            
            // Parse ZIP file structure
            const files = this.parseZIP(data);
            
            if (files.length === 0) {
                console.error("No files found in ZIP archive");
                return this.extractMXLFallback(data);
            }
            
            console.log("[MXL2MIDI] Found files in archive:", files.map(f => f.name));
            
            let xmlFileName = null;
            
            // Method 1: Check META-INF/container.xml
            const containerFile = files.find(f => f.name === 'META-INF/container.xml');
            if (containerFile) {
                console.log("[MXL2MIDI] Reading container.xml...");
                const containerXML = this.decodeText(containerFile.data);
                const parser = new DOMParser();
                const containerDoc = parser.parseFromString(containerXML, "text/xml");
                const rootfile = containerDoc.querySelector("rootfile");
                if (rootfile) {
                    xmlFileName = rootfile.getAttribute("full-path");
                    console.log("[MXL2MIDI] Container points to:", xmlFileName);
                }
            }
            
            // Method 2: Find first .xml file
            if (!xmlFileName) {
                console.log("[MXL2MIDI] No container.xml, searching for XML files...");
                const xmlFile = files.find(f => 
                    f.name.toLowerCase().endsWith('.xml') && 
                    !f.name.startsWith('META-INF/') &&
                    !f.name.startsWith('__MACOSX/')
                );
                
                if (xmlFile) {
                    xmlFileName = xmlFile.name;
                    console.log("[MXL2MIDI] Found XML file:", xmlFileName);
                }
            }
            
            if (!xmlFileName) {
                console.error("No MusicXML file found in archive");
                return this.extractMXLFallback(data);
            }
            
            const targetFile = files.find(f => f.name === xmlFileName);
            if (!targetFile) {
                console.error("Could not find target file:", xmlFileName);
                return this.extractMXLFallback(data);
            }
            
            const xmlText = this.decodeText(targetFile.data);
            console.log("[MXL2MIDI] XML extracted successfully, length:", xmlText.length);
            
            return xmlText;
            
        } catch (error) {
            console.error("[MXL2MIDI] ZIP extraction error:", error);
            const arrayBuffer = await file.arrayBuffer();
            return this.extractMXLFallback(new Uint8Array(arrayBuffer));
        }
    }

    parseZIP(data) {
        const files = [];
        let offset = 0;
        
        const readUint16 = (pos) => data[pos] | (data[pos + 1] << 8);
        const readUint32 = (pos) => data[pos] | (data[pos + 1] << 8) | (data[pos + 2] << 16) | (data[pos + 3] << 24);
        
        while (offset < data.length - 4) {
            const signature = readUint32(offset);
            
            // Local file header signature: 0x04034b50
            if (signature === 0x04034b50) {
                const compressionMethod = readUint16(offset + 8);
                const compressedSize = readUint32(offset + 18);
                const fileNameLength = readUint16(offset + 26);
                const extraFieldLength = readUint16(offset + 28);
                
                const fileNameStart = offset + 30;
                const fileName = this.decodeText(data.slice(fileNameStart, fileNameStart + fileNameLength));
                
                const dataStart = fileNameStart + fileNameLength + extraFieldLength;
                const dataEnd = dataStart + compressedSize;
                
                let fileData = data.slice(dataStart, dataEnd);
                
                // Decompress if needed (method 8 = DEFLATE)
                if (compressionMethod === 8) {
                    try {
                        if (typeof pako !== 'undefined') {
                            fileData = pako.inflateRaw(fileData);
                        } else {
                            console.warn("[MXL2MIDI] pako not available, cannot decompress", fileName);
                        }
                    } catch (e) {
                        console.error("[MXL2MIDI] Decompression failed for", fileName, e);
                    }
                }
                
                files.push({
                    name: fileName,
                    data: fileData
                });
                
                offset = dataEnd;
            } else {
                offset++;
            }
        }
        
        return files;
    }

    decodeText(data) {
        try {
            return new TextDecoder('utf-8').decode(data);
        } catch (e) {
            let text = '';
            for (let i = 0; i < data.length; i++) {
                text += String.fromCharCode(data[i]);
            }
            return text;
        }
    }

    extractMXLFallback(zipData) {
        console.log("[MXL2MIDI] Using fallback byte search method...");
        
        for (let i = 0; i < zipData.length - 5; i++) {
            if (zipData[i] === 0x3C && zipData[i+1] === 0x3F && 
                zipData[i+2] === 0x78 && zipData[i+3] === 0x6D && zipData[i+4] === 0x6C) {
                
                const endTag = '</score-partwise>';
                const endTag2 = '</score-timewise>';
                
                const maxLength = Math.min(zipData.length - i, 5000000);
                let xmlContent = this.decodeText(zipData.slice(i, i + maxLength));
                
                let endIdx = xmlContent.indexOf(endTag);
                if (endIdx === -1) {
                    endIdx = xmlContent.indexOf(endTag2);
                }
                
                if (endIdx !== -1) {
                    xmlContent = xmlContent.substring(0, endIdx + endTag.length);
                    console.log("[MXL2MIDI] Extracted XML, length:", xmlContent.length);
                    return xmlContent;
                }
            }
        }
        
        return null;
    }
	
    /**
     * Parse XML string into structured score data
     * @param {string} xmlText - MusicXML content as string
     * @returns {Object|null} Parsed score data or null
     */
    parseXMLString(xmlText) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "text/xml");
        
        const parserError = xmlDoc.querySelector('parsererror');
        if (parserError) {
            console.error("Parse error:", parserError.textContent);
            return null;
        }
        
        const scoreData = {
            measures: [],
            divisions: 1,
            fifths: 0,
            beats: 4,
            beatType: 4,
            tempo: 500000  // microseconds per quarter note
        };
        
        // Extract tempo
        const sound = xmlDoc.querySelector('sound[tempo]');
        if (sound) {
            const bpm = parseFloat(sound.getAttribute('tempo'));
            scoreData.tempo = 60000000 / bpm;
        }
        
        // Extract time signature and divisions from first attributes
        const firstAttributes = xmlDoc.querySelector('measure attributes');
        if (firstAttributes) {
            const divisions = firstAttributes.querySelector('divisions');
            if (divisions) {
                scoreData.divisions = parseInt(divisions.textContent);
            }
            
            const key = firstAttributes.querySelector('key');
            if (key) {
                const fifths = key.querySelector('fifths');
                if (fifths) {
                    scoreData.fifths = parseInt(fifths.textContent);
                }
            }
            
            const time = firstAttributes.querySelector('time');
            if (time) {
                const beats = time.querySelector('beats');
                const beatType = time.querySelector('beat-type');
                if (beats) scoreData.beats = parseInt(beats.textContent);
                if (beatType) scoreData.beatType = parseInt(beatType.textContent);
            }
        }
        
        const parts = xmlDoc.querySelectorAll('part');
        
        // Initialize measures
        let maxMeasures = 0;
        parts.forEach(part => {
            const measures = part.querySelectorAll('measure');
            maxMeasures = Math.max(maxMeasures, measures.length);
        });
        
        for (let i = 0; i < maxMeasures; i++) {
            scoreData.measures[i] = {
                number: (i + 1).toString(),
                notes: [],
                width: 200
            };
        }
        
        // Parse notes from all parts
        parts.forEach((part, partIdx) => {
            const measures = part.querySelectorAll('measure');
            
            measures.forEach((measure, mIdx) => {
                const children = Array.from(measure.children);
                let currentTime = 0;
                
                children.forEach(child => {
                    if (child.tagName === 'backup') {
                        const duration = child.querySelector('duration');
                        if (duration) {
                            currentTime -= parseInt(duration.textContent);
                        }
                        return;
                    }
                    
                    if (child.tagName === 'forward') {
                        const duration = child.querySelector('duration');
                        if (duration) {
                            currentTime += parseInt(duration.textContent);
                        }
                        return;
                    }
                    
                    if (child.tagName === 'note') {
                        const note = child;
                        const pitch = note.querySelector('pitch');
                        const rest = note.querySelector('rest');
                        const chord = note.querySelector('chord');
                        const duration = note.querySelector('duration');
                        
                        const noteDuration = duration ? parseInt(duration.textContent) : 0;
                        
                        if (pitch) {
                            const step = pitch.querySelector('step').textContent;
                            const octave = parseInt(pitch.querySelector('octave').textContent);
                            const alter = pitch.querySelector('alter');
                            const alterVal = alter ? parseInt(alter.textContent) : 0;
                            
                            const noteData = {
                                step: step,
                                octave: octave,
                                alter: alterVal,
                                duration: noteDuration,
                                time: currentTime,
                                midiNote: this.stepToMidi(step, octave, alterVal),
                                isChord: !!chord,
                                isRest: false,
                                part: partIdx
                            };
                            
                            scoreData.measures[mIdx].notes.push(noteData);
                            
                            if (!chord && duration) {
                                currentTime += noteDuration;
                            }
                        } else if (rest && duration) {
                            const restData = {
                                duration: noteDuration,
                                time: currentTime,
                                isRest: true,
                                part: partIdx
                            };
                            
                            scoreData.measures[mIdx].notes.push(restData);
                            currentTime += noteDuration;
                        }
                    }
                });
            });
        });
        
        console.log("Parsed MusicXML:", {
            measures: scoreData.measures.length,
            divisions: scoreData.divisions,
            tempo: scoreData.tempo,
            timeSignature: `${scoreData.beats}/${scoreData.beatType}`,
            parts: parts.length
        });
        
        return scoreData;
    }

    /**
     * Convert note step/octave/alter to MIDI note number
     * @param {string} step - Note name (C, D, E, F, G, A, B)
     * @param {number} octave - Octave number
     * @param {number} alter - Alteration (-1 flat, 0 natural, +1 sharp)
     * @returns {number} MIDI note number (0-127)
     */
    stepToMidi(step, octave, alter) {
        const steps = { 'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11 };
        return (octave + 1) * 12 + steps[step] + alter;
    }

    /**
     * Convert parsed score data to MIDI events using direct XML parsing
     * This is the fallback method that works without OSMD
     * @param {Object} scoreData - Parsed score data from parseXMLString
     * @returns {Object} MIDI conversion result with events, note pairs, and duration
     */
    convertToMIDI(scoreData) {
        if (!scoreData || !scoreData.measures) {
            console.error("No score data to convert");
            return { midiEvents: [], notePairs: [], totalDuration: 0 };
        }
        
        const tempoMs = scoreData.tempo / 1000;
        const msPerDivision = tempoMs / scoreData.divisions;
        const divisionsPerMeasure = (scoreData.beats * scoreData.divisions * 4) / scoreData.beatType;
        const msPerMeasure = divisionsPerMeasure * msPerDivision;
        
        // Calculate absolute times for all notes
        const allNotes = [];
        
        scoreData.measures.forEach((measure, measureIdx) => {
            const measureStartTime = measureIdx * msPerMeasure;
            
            measure.notes.forEach(note => {
                if (!note.isRest && note.midiNote) {
                    const startTime = measureStartTime + (note.time * msPerDivision);
                    const duration = note.duration * msPerDivision;
                    const endTime = startTime + duration;
                    
                    allNotes.push({
                        midiNote: note.midiNote,
                        startTime: startTime,
                        endTime: endTime,
                        duration: note.duration
                    });
                }
            });
        });
        
        // Deduplicate by timestamp + MIDI note
        const notesByTime = new Map();
        
        allNotes.forEach(note => {
            const timeKey = Math.round(note.startTime * 100) / 100;
            
            if (!notesByTime.has(timeKey)) {
                notesByTime.set(timeKey, new Map());
            }
            
            const notesAtTime = notesByTime.get(timeKey);
            const midiKey = note.midiNote;
            
            if (!notesAtTime.has(midiKey)) {
                notesAtTime.set(midiKey, note);
            } else {
                const existing = notesAtTime.get(midiKey);
                if (note.duration > existing.duration) {
                    notesAtTime.set(midiKey, note);
                }
            }
        });
        
        // Generate MIDI events from deduplicated notes
        const midiEvents = [];
        const notePairs = [];
        
        notesByTime.forEach((notesAtTime) => {
            notesAtTime.forEach(note => {
                // Note On event
                midiEvents.push({
                    time: note.startTime,
                    data: [0x90, note.midiNote, 100]  // Channel 0, velocity 100
                });
                
                // Note Off event
                midiEvents.push({
                    time: note.endTime,
                    data: [0x80, note.midiNote, 0]
                });
                
                // Store note pair for visualization
                notePairs.push({
                    note: note.midiNote,
                    start: note.startTime,
                    end: note.endTime
                });
            });
        });
        
        // Sort events by time
        midiEvents.sort((a, b) => a.time - b.time);
        
        const totalDuration = midiEvents.length > 0 ? midiEvents[midiEvents.length - 1].time : 0;
        
        console.log("XML Conversion:", {
            measures: scoreData.measures.length,
            notes: allNotes.length,
            unique: Array.from(notesByTime.values()).reduce((sum, m) => sum + m.size, 0),
            events: midiEvents.length,
            duration: Math.round(totalDuration / 1000) + "s"
        });
        
        return {
            midiEvents: midiEvents,
            notePairs: notePairs,
            totalDuration: totalDuration
        };
    }

    /**
     * Convert OSMD parsed structure to MIDI events
     * This is the preferred method when OSMD is available
     * @param {Object} osmd - OpenSheetMusicDisplay instance
     * @returns {Object|null} MIDI conversion result or null if OSMD unavailable
     */
    convertOSMDToMIDI(osmd) {
        if (!osmd || !osmd.Sheet) {
            console.warn("No OSMD sheet available, cannot use OSMD conversion");
            return null;
        }
        
        const sheet = osmd.Sheet;
        
        // Get tempo (default to 120 BPM if not specified)
        const bpm = sheet.defaultStartTempoInBpm || 120;
        const msPerBeat = 60000 / bpm;
        
        // Helper function to convert pitch to MIDI note number
        function pitchToMidi(pitch) {
            if (!pitch) return null;
            
            // PRIORITY 1: Use halfTone if available (this is the actual MIDI note!)
            let halfTone = pitch.halfTone;
            
            if (halfTone !== undefined && halfTone !== null) {
                let midiValue = halfTone;
                
                // Handle if it's wrapped in an object
                if (typeof halfTone === 'object' && halfTone.realValue !== undefined) {
                    midiValue = halfTone.realValue;
                }
                
                // Convert to actual number
                midiValue = Number(midiValue);
                
                // Validate and apply octave correction
                if (!isNaN(midiValue) && midiValue >= 0 && midiValue <= 127) {
                    // OSMD calculates MIDI notes one octave lower than expected
                    return Math.round(midiValue) + 12;
                }
            }
            
            // PRIORITY 2: Calculate from fundamentalNote + octave
            const fundamental = pitch.fundamentalNote;
            const octave = pitch.octave;
            const accidental = pitch.accidental || 0;
            
            if (fundamental === undefined || octave === undefined) {
                return null;
            }
            
            // fundamentalNote should be 0-6 for C-B
            if (fundamental < 0 || fundamental > 6) {
                return null;
            }
            
            // Convert fundamental (0=C, 1=D, 2=E, 3=F, 4=G, 5=A, 6=B) to semitones
            const noteOffsets = [0, 2, 4, 5, 7, 9, 11];
            const semitone = noteOffsets[fundamental];
            
            // Calculate MIDI note with octave correction
            const midiNote = (octave + 1) * 12 + semitone + accidental;
            
            if (midiNote < 0 || midiNote > 127 || isNaN(midiNote)) {
                return null;
            }
            
            return midiNote + 12; // Octave correction
        }
        
        const allNotes = [];
        
        // Iterate through all measures and extract notes
        sheet.sourceMeasures.forEach((measure) => {
            const measureStartTime = measure.absoluteTimestamp?.realValue || 0;
            
            if (measure.verticalSourceStaffEntryContainers) {
                measure.verticalSourceStaffEntryContainers.forEach(container => {
                    const timestamp = container.timestamp?.realValue || 0;
                    const absoluteTime = measureStartTime + timestamp;
                    
                    if (container.staffEntries) {
                        container.staffEntries.forEach(staffEntry => {
                            if (staffEntry.voiceEntries) {
                                staffEntry.voiceEntries.forEach(voiceEntry => {
                                    if (voiceEntry.notes) {
                                        voiceEntry.notes.forEach(note => {
                                            if (!note.isRestFlag && note.pitch) {
                                                const midiNote = pitchToMidi(note.pitch);
                                                const duration = note.length?.realValue || 0.25;
                                                
                                                if (midiNote !== null && !isNaN(midiNote) && midiNote >= 0 && midiNote <= 127) {
                                                    const startTimeMs = absoluteTime * msPerBeat * 4;
                                                    const durationMs = duration * msPerBeat * 4;
                                                    const endTimeMs = startTimeMs + durationMs;
                                                    
                                                    allNotes.push({
                                                        midiNote: midiNote,
                                                        startTime: startTimeMs,
                                                        endTime: endTimeMs,
                                                        duration: duration
                                                    });
                                                }
                                            }
                                        });
                                    }
                                });
                            }
                        });
                    }
                });
            }
        });
        
        // Deduplicate notes with same start time and MIDI note
        const notesByTime = new Map();
        
        allNotes.forEach(note => {
            const timeKey = Math.round(note.startTime * 100) / 100;
            
            if (!notesByTime.has(timeKey)) {
                notesByTime.set(timeKey, new Map());
            }
            
            const notesAtTime = notesByTime.get(timeKey);
            const midiKey = note.midiNote;
            
            if (!notesAtTime.has(midiKey)) {
                notesAtTime.set(midiKey, note);
            } else {
                const existing = notesAtTime.get(midiKey);
                if (note.duration > existing.duration) {
                    notesAtTime.set(midiKey, note);
                }
            }
        });
        
        // Generate MIDI events
        const midiEvents = [];
        const notePairs = [];
        
        notesByTime.forEach((notesAtTime) => {
            notesAtTime.forEach(note => {
                if (isNaN(note.midiNote) || note.midiNote < 0 || note.midiNote > 127) {
                    console.error("Invalid MIDI note in event generation:", note);
                    return;
                }
                
                midiEvents.push({
                    time: note.startTime,
                    data: [0x90, note.midiNote, 100]
                });
                
                midiEvents.push({
                    time: note.endTime,
                    data: [0x80, note.midiNote, 0]
                });
                
                notePairs.push({
                    note: note.midiNote,
                    start: note.startTime,
                    end: note.endTime
                });
            });
        });
        
        // Sort events by time
        midiEvents.sort((a, b) => a.time - b.time);
        
        const totalDuration = midiEvents.length > 0 ? midiEvents[midiEvents.length - 1].time : 0;
        const uniqueNotes = Array.from(notesByTime.values()).reduce((sum, m) => sum + m.size, 0);
        
        console.log("OSMD Conversion:", {
            notes: allNotes.length,
            unique: uniqueNotes,
            events: midiEvents.length,
            duration: Math.round(totalDuration / 1000) + "s"
        });
        
        return {
            midiEvents: midiEvents,
            notePairs: notePairs,
            totalDuration: totalDuration
        };
    }
}

// Export for use in both browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MXL2MIDI;
}
if (typeof window !== 'undefined') {
    window.MXL2MIDI = MXL2MIDI;
}