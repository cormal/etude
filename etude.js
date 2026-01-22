/*
 * Etude - MIDI Light Player
 * Main Application Script
 */

// Global State Variables
let port, writer, rainbow = false, isPlaying = false, midiOutput = null;
let midiEvents = [], nextEventIndex = 0, totalDuration = 0, currentTimeOffset = 0, startTime = 0;
let playbackRate = 1.0, learningMode = false, currentTargetNotes = [];
let playTimer;
let notePairs = [];
let isTestActive = false;
let measureGroupsCache = null;
let showMeasureDebug = false;

// MusicXML score data
let scoreData = null;
let osmd = null;
let currentXMLString = null;
let isRendering = false;
let cachedMaxScrollX = null;
let lastScrollUpdate = 0;
let targetScrollPosition = 0;

let firstNoteOffset = 0;  // Time offset to first actual note
let firstNoteVisualOffset = 0;  // Visual X offset to first note in SVG

// Playhead bar element
let playheadBar = null;

const mxlConverter = new MXL2MIDI();

// Canvas setup
const canvas = document.getElementById('noteCanvas');
const ctx = canvas.getContext('2d');
const noteSpeed = 0.15;

// Logging function
const log = (m) => {
    document.getElementById('consoleOut').innerText = m;
};

// ============================================================================
// UI State Management
// ============================================================================

function checkDeckState() {
    const btnViz = document.getElementById('btnToggleViz');
    const scoreContainer = document.getElementById('scoreContainer');
    
    if (scoreData) {
        scoreContainer.style.display = 'block';
    }
    btnViz.style.display = 'block';
}

function toggleVisualizer() {
    const container = document.getElementById('vizContainer');
    const btn = document.getElementById('btnToggleViz');
    const isHidden = window.getComputedStyle(container).display === 'none';
    
    if (isHidden) {
        container.style.display = 'block';
        btn.innerText = 'Notes On';
        btn.classList.add('active');
    } else {
        container.style.display = 'none';
        btn.innerText = 'Notes Off';
        btn.classList.remove('active');
    }
}

function updateUI() {
    const vol = document.getElementById('volume');
    document.getElementById('volVal').innerText = vol.value + "%";
    
    if (vol.value == 0) {
        vol.classList.add('is-muted');
    } else {
        vol.classList.remove('is-muted');
    }
    
    document.getElementById('brightVal').innerText = document.getElementById('brightness').value + "%";
    document.getElementById('octaveVal').innerText = document.getElementById('octaveShift').value;
    document.getElementById('transVal').innerText = document.getElementById('transpose').value;
}

// ============================================================================
// Score Rendering (OpenSheetMusicDisplay)
// ============================================================================

async function renderOSMD() {
    if (!currentXMLString) {
        log("No score data to render");
        return;
    }
    
    if (isRendering) {
        console.log("Already rendering, skipping...");
        return;
    }
    
    isRendering = true;
    
    try {
        const container = document.getElementById('osmdContainer');
        const loadingIndicator = document.getElementById('scoreLoading');
        
        // Show loading indicator
        loadingIndicator.style.display = 'block';
        container.innerHTML = '';
        
        if (typeof opensheetmusicdisplay === 'undefined') {
            log("OpenSheetMusicDisplay library not loaded. Using fallback rendering.");
            renderFallbackScore();
            loadingIndicator.style.display = 'none';
            isRendering = false;
            return;
        }
        
        log("Initializing OSMD...");
        
        osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay(container, {
			autoResize: false,
			backend: "svg",
			drawTitle: true,
			drawSubtitle: false,
			drawComposer: true,
			drawPartNames: false,
			drawingParameters: "compacttight",
			renderSingleHorizontalStaffline: true  // NEW: Forces single horizontal line
		});
		window.osmd = osmd;
        
        log("Loading XML...");
        await osmd.load(currentXMLString);
        
        log("Rendering...");
        
        // Set page margins and format
        if (osmd.EngravingRules) {
            osmd.EngravingRules.PageLeftMargin = 0.5;
            osmd.EngravingRules.PageRightMargin = 0.5;
            osmd.EngravingRules.PageTopMargin = 1.0;
            osmd.EngravingRules.PageBottomMargin = 1.0;
            
            // Create one massive page to hold everything
            osmd.EngravingRules.PageFormat.width = 50000;
            osmd.EngravingRules.PageFormat.height = 5000;
            
            // Spacing settings
            osmd.EngravingRules.SystemDistance = 3.0;
            osmd.EngravingRules.MinimumDistanceBetweenSystems = 2.0;
            osmd.EngravingRules.CompactMode = true;
            
            // Try to prevent page breaks
            osmd.EngravingRules.NewPageAtXMLNewPageAttribute = false;
            osmd.EngravingRules.NewPageAtXMLNewSystemAttribute = false;
            osmd.EngravingRules.NewSystemAtXMLNewSystemAttribute = false;
        }
        
        // Render at smaller zoom for compactness
        osmd.zoom = 0.5;
        
        // Set a very large rendering area before rendering
        container.style.width = '50000px';
        container.style.height = '5000px';
        
        await osmd.render();
        
        // Reset container size after rendering
        container.style.width = '';
        container.style.height = '';
        
        // Force SVG to allow horizontal scrolling
        const svgElement = container.querySelector('svg');
        if (svgElement) {
            svgElement.style.maxWidth = 'none';
            svgElement.style.width = 'auto';
            svgElement.style.height = 'auto';
        }
        
        // Hide loading indicator
        loadingIndicator.style.display = 'none';
        
        log("Score rendered successfully: " + scoreData.measures.length + " measures");
        
        // Create playhead bar
        createPlayheadBar();
        
		// Add measure numbers and markers
        addMeasureMarkersAndNumbers();
		
		// Convert OSMD to MIDI (primary method)
        const osmdResult = mxlConverter.convertOSMDToMIDI(osmd);
        
        if (osmdResult && osmdResult.midiEvents.length > 0) {
            console.log("✓ Using OSMD conversion");
            midiEvents = osmdResult.midiEvents;
            notePairs = osmdResult.notePairs;
            totalDuration = osmdResult.totalDuration;
            
            // Calculate offset to first note
            // Calculate offset to first note
            const firstNoteOn = midiEvents.find(ev => (ev.data[0] & 0xF0) === 0x90 && ev.data[2] > 0);
            firstNoteOffset = firstNoteOn ? firstNoteOn.time : 0;
            console.log("First note offset:", Math.round(firstNoteOffset), "ms");
            
            document.getElementById('playbar').max = totalDuration;
            nextEventIndex = 0;
            currentTimeOffset = 0;
            updateTimeLabel(0);
            
            log("Ready: " + midiEvents.length + " events, " + formatTime(totalDuration));
        } else {
            console.warn("OSMD conversion failed, using fallback");
            log("Using fallback conversion");
        }
		
    } catch (error) {
        const loadingIndicator = document.getElementById('scoreLoading');
        loadingIndicator.style.display = 'none';
        log("OSMD Error: " + error.message);
        console.error("Full error:", error);
        renderFallbackScore();
    } finally {
        isRendering = false;
    }
}
function renderFallbackScore() {
    const container = document.getElementById('osmdContainer');
    container.innerHTML = '<div style="padding: 20px; color: #000; font-family: Arial;"><h3>Score Preview</h3><p>Loaded: ' +
        scoreData.measures.length + ' measures</p><p style="color: #666;">Full score rendering requires the OpenSheetMusicDisplay library.</p>' +
        '<p style="margin-top: 20px;">Try using the "Notes On" falling notes visualizer for a better view during playback.</p></div>';
}

function createPlayheadBar() {
    if (!osmd) return;
    
    try {
        const svg = document.querySelector('#osmdContainer svg');
        if (!svg) return;
        
        // Remove old playhead if exists
        if (playheadBar) {
            playheadBar.remove();
        }
        
        // Get SVG dimensions
        const bbox = svg.getBBox();
        
        // Create playhead bar as a vertical line spanning the full height
        playheadBar = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        playheadBar.setAttribute('x1', '0');
        playheadBar.setAttribute('y1', bbox.y - 20);
        playheadBar.setAttribute('x2', '0');
        playheadBar.setAttribute('y2', bbox.y + bbox.height + 20);
        playheadBar.setAttribute('stroke', '#ff0000');
        playheadBar.setAttribute('stroke-width', '3');
        playheadBar.setAttribute('opacity', '0.8');
        playheadBar.setAttribute('pointer-events', 'none');
        playheadBar.style.transition = 'none'; // Disable transitions for smooth updates
        
        // Add to SVG
        svg.appendChild(playheadBar);
        
    } catch (error) {
        console.log("Playhead creation error:", error);
    }
}

function addMeasureMarkersAndNumbers() {
    if (!osmd || !scoreData) return;
    
    try {
        const svg = document.querySelector('#osmdContainer svg');
        if (!svg) return;
        
        // Get all measure elements
        const measureElements = Array.from(svg.querySelectorAll('[class*="measure"]'));
        if (measureElements.length === 0) return;
        
        console.log("=== MEASURE MARKERS ===");
        console.log(`Total SVG measures: ${measureElements.length}`);
        console.log(`OSMD musical measures: ${osmd.Sheet.SourceMeasures.length}`);
        
        // OSMD renders sequentially: all treble measures first, then all bass measures
        // For 150 musical measures: indices 0-149 are treble, 150-299 are bass
        const totalMusicalMeasures = osmd.Sheet.SourceMeasures.length;
        const trebleMeasures = measureElements.slice(0, totalMusicalMeasures);
        
        console.log(`Using first ${totalMusicalMeasures} measures as treble staff`);
        
        // Add markers and numbers using treble measures in sequential order
        trebleMeasures.forEach((measureEl, idx) => {
            if (idx >= scoreData.measures.length) return;
            
            const measureNumber = scoreData.measures[idx].number;
            const bbox = measureEl.getBBox();
            
            // Use OSMD's internal position data - the barline is at the left edge of this measure
            // which equals the right edge of the previous measure
            let measureStartX = bbox.x;
            
            if (osmd.graphic && osmd.graphic.measureList && osmd.graphic.measureList[idx]) {
                const zoom = 1.0 //osmd.zoom || 1.0;
                const unitInPixels = 10 * zoom;
                const measureStaves = osmd.graphic.measureList[idx];
                const trebleStaff = measureStaves[0];
                
                if (trebleStaff && trebleStaff.PositionAndShape) {
                    const pos = trebleStaff.PositionAndShape;
                    const absX = pos.AbsolutePosition?.x || pos.RelativePosition?.x;
                    const borderLeft = pos.BorderLeft || 0;
                    
                    // The barline is at: absolute position + left border
                    measureStartX = (absX + borderLeft) * unitInPixels;
                }
            }
            
            // Create vertical bar at start of measure
            const bar = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            bar.setAttribute('x1', measureStartX);
            bar.setAttribute('y1', bbox.y - 10);
            bar.setAttribute('x2', measureStartX);
            bar.setAttribute('y2', bbox.y + 200); // Span both staves
            bar.setAttribute('stroke', '#4A90E2');  // Blue color
            bar.setAttribute('stroke-width', '2');
            bar.setAttribute('opacity', '0.7');
            bar.setAttribute('pointer-events', 'none');
            bar.style.display = showMeasureDebug ? 'block' : 'none';
            svg.appendChild(bar);
            
            // Create measure number above the staff
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', measureStartX + 10); // Slight offset for readability
            text.setAttribute('y', bbox.y - 20);
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('font-size', '22');
            text.setAttribute('font-family', 'Arial, sans-serif');
            text.setAttribute('font-weight', 'bold');
            text.setAttribute('fill', '#4A90E2');  // Blue color
            text.setAttribute('pointer-events', 'none');
            text.textContent = measureNumber;
            text.style.display = showMeasureDebug ? 'block' : 'none';
            svg.appendChild(text);
        });
        
        console.log(`✓ Added ${trebleMeasures.length} measure markers`);
        
    } catch (error) {
        console.log("Measure marker error:", error);
    }
}

function updatePlayheadPosition() {
    if (!osmd || !scoreData || !playheadBar || !measureGroupsCache) return;
    
    try {
        // Calculate current position using EXACT same logic as MIDI playback
        // Calculate current position using OSMD timing (same as MIDI playback)
        let currentMeasureIndex = 0;
        let fractionWithinMeasure = 0;
		const adjustedTime = currentTimeOffset;
        
        if (osmd && osmd.Sheet && osmd.Sheet.SourceMeasures) {
            const measures = osmd.Sheet.SourceMeasures;
            const bpm = osmd.Sheet.defaultStartTempoInBpm || 120;
            const msPerBeat = 60000 / bpm;
            
            // Find current measure
            for (let i = 0; i < measures.length; i++) {
                const measureStartTime = (measures[i].absoluteTimestamp?.realValue || 0) * msPerBeat * 4;
                if (measureStartTime <= adjustedTime) {
                    currentMeasureIndex = i;
                } else {
                    break;
                }
            }
            
            // Calculate fraction within measure
            const currentMeasure = measures[currentMeasureIndex];
            const nextMeasure = measures[Math.min(currentMeasureIndex + 1, measures.length - 1)];
            
            const currentMeasureTime = (currentMeasure.absoluteTimestamp?.realValue || 0) * msPerBeat * 4;
            const nextMeasureTime = (nextMeasure.absoluteTimestamp?.realValue || 0) * msPerBeat * 4;
            const measureDuration = nextMeasureTime - currentMeasureTime;
            
            fractionWithinMeasure = measureDuration > 0 ? 
                (adjustedTime - currentMeasureTime) / measureDuration : 0;
        }
        
        if (currentMeasureIndex >= measureGroupsCache.length - 1) {
            return;
        }
        
        // Get current and next measure positions from cache
        const currentMeasure = measureGroupsCache[currentMeasureIndex];
        const nextMeasure = measureGroupsCache[Math.min(currentMeasureIndex + 1, measureGroupsCache.length - 1)];
        
        // Interpolate X position
        let xPos;
        
        // For first measure, adjust the interpolation to start from the first note position
        if (currentMeasureIndex === 0) {
            const measureStartX = currentMeasure.x + firstNoteVisualOffset;  // Start at first note
            const measureEndX = nextMeasure.x;
            xPos = measureStartX + ((measureEndX - measureStartX) * fractionWithinMeasure);
        } else {
            // Normal interpolation for other measures
            xPos = currentMeasure.x + ((nextMeasure.x - currentMeasure.x) * fractionWithinMeasure);
        }
        
        const visuallyAdjustedX = xPos;	
        
        // Update playhead position
        playheadBar.setAttribute('x1', visuallyAdjustedX);
        playheadBar.setAttribute('x2', visuallyAdjustedX);
        
    } catch (error) {
        console.log("Playhead update error:", error);
    }
}


function updateScoreScroll() {
    if (!osmd || !scoreData) return;
    
    try {
        const scoreContainer = document.getElementById('scoreContainer');
        const svg = document.querySelector('#osmdContainer svg');
        if (!svg) return;
        
        const containerWidth = scoreContainer.clientWidth;
       
            
        // Build measure position cache once using OSMD's actual positions
        if (measureGroupsCache === null) {
            const zoom = 1.0// osmd.zoom || 1.0;
            const unitInPixels = 10 * zoom;
                
            measureGroupsCache = osmd.graphic.measureList.map((measureStaves, idx) => {
                const trebleStaff = measureStaves[0];
                const pos = trebleStaff.PositionAndShape;
                const xPos = pos.AbsolutePosition ? pos.AbsolutePosition.x : pos.RelativePosition?.x;
                
                return {
                    x: xPos * unitInPixels,
                    y: 0,
                    width: pos.BorderRight * unitInPixels,
                    originalIndex: idx
                };
            });
            
            console.log(`✓ Scroll cache built from OSMD data: ${measureGroupsCache.length} measures`);
            console.log("First 10 X positions:", measureGroupsCache.slice(0, 10).map(m => Math.round(m.x)));
            
            // Calculate visual offset to first note (now that cache exists)
            if (firstNoteVisualOffset === 0) {
                // Find all note heads (excluding rests)
                const allNoteHeads = Array.from(svg.querySelectorAll('[class*="vf-notehead"]'));
                
                // Filter to only note heads in the first measure area
                const firstMeasureX = measureGroupsCache[0].x;
                const firstMeasureEnd = measureGroupsCache[0].x + measureGroupsCache[0].width;
                
                // Find note heads that are actually in the first measure
                const noteHeadsInFirstMeasure = allNoteHeads.filter(nh => {
                    const x = nh.getBBox().x;
                    return x >= firstMeasureX && x < firstMeasureEnd;
                });
                
                if (noteHeadsInFirstMeasure.length > 0) {
                    // Sort by X position to get the leftmost note head
                    noteHeadsInFirstMeasure.sort((a, b) => a.getBBox().x - b.getBBox().x);
                    
                    const firstNoteX = noteHeadsInFirstMeasure[0].getBBox().x;
                    firstNoteVisualOffset = firstNoteX - firstMeasureX;
                    console.log("✓ First note visual offset:", Math.round(firstNoteVisualOffset), "px");
                    console.log("  (Found", noteHeadsInFirstMeasure.length, "note heads in measure 1)");
                }
            }
        }
        
        if (!measureGroupsCache || measureGroupsCache.length === 0) return;
        
        // Calculate current musical measure position
        // Calculate current musical measure position using OSMD timing
        let musicMeasureFloat = 0;
        let measureIndex = 0;
        let fractionWithinMeasure = 0;
        
        if (osmd && osmd.Sheet && osmd.Sheet.SourceMeasures) {
            const measures = osmd.Sheet.SourceMeasures;
            const bpm = osmd.Sheet.defaultStartTempoInBpm || 120;
            const msPerBeat = 60000 / bpm;
			
            // Find current measure (adjusted for first note offset)
			const adjustedTime = currentTimeOffset;
			
            for (let i = 0; i < measures.length; i++) {
                const measureStartTime = (measures[i].absoluteTimestamp?.realValue || 0) * msPerBeat * 4;
                if (measureStartTime <= adjustedTime) {
                    measureIndex = i;
                } else {
                    break;
                }
            }
            
            // Calculate fraction within measure
            const currentMeasure = measures[measureIndex];
            const nextMeasure = measures[Math.min(measureIndex + 1, measures.length - 1)];
            
            const currentMeasureTime = (currentMeasure.absoluteTimestamp?.realValue || 0) * msPerBeat * 4;
            const nextMeasureTime = (nextMeasure.absoluteTimestamp?.realValue || 0) * msPerBeat * 4;
            const measureDuration = nextMeasureTime - currentMeasureTime;
            
            fractionWithinMeasure = measureDuration > 0 ? 
                (adjustedTime - currentMeasureTime) / measureDuration : 0;
            
            musicMeasureFloat = measureIndex + fractionWithinMeasure;
        } else {
            // Fallback to XML-based calculation
            const tempoMs = scoreData.tempo / 1000;
            const msPerDivision = tempoMs / scoreData.divisions;
            const divisionsPerMeasure = (scoreData.beats * scoreData.divisions * 4) / scoreData.beatType;
            const msPerMeasure = divisionsPerMeasure * msPerDivision;
            musicMeasureFloat = currentTimeOffset / msPerMeasure;
            measureIndex = Math.floor(musicMeasureFloat);
            fractionWithinMeasure = musicMeasureFloat - measureIndex;
        }
        
        if (measureIndex < 0 || measureIndex >= measureGroupsCache.length - 1) return;
        
        // Interpolate X position within current measure
        const currentMeasure = measureGroupsCache[measureIndex];
        const nextMeasure = measureGroupsCache[measureIndex + 1];
        const targetX = currentMeasure.x + ((nextMeasure.x - currentMeasure.x) * fractionWithinMeasure);
        
        // Position playhead at 30% from left edge
        const playheadOffset = containerWidth * 0.3;
		const targetScroll = (targetX * osmd.zoom) - playheadOffset; 
        const maxScroll = Math.max(0, svg.getBBox().width - containerWidth);
        const clampedScroll = Math.max(0, Math.min(targetScroll, maxScroll));
        
        // Smooth scroll
        scoreContainer.scrollLeft = clampedScroll;
        
    } catch (error) {
        console.log("Scroll error:", error);
    }
}

function highlightNote(midiNote, isOn) {
    // This function is now deprecated - we use the playhead bar instead
    // Keeping it for compatibility but it does nothing
    return;
}

function clearAllNoteHighlights() {
    // Deprecated - playhead bar is now independent
    // Just hide the playhead if needed
    if (playheadBar) {
        playheadBar.setAttribute('opacity', '0');
    }
}

// ============================================================================
// File Parsing
// ============================================================================

async function parseXMLFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    // Clear any existing MIDI data
    clearCurrentFile();
    
    measureGroupsCache = null; // Reset scroll cache for new piece
    
    document.getElementById('xmlFileNameDisplay').innerText = file.name;
    
    try {
        // Use mxlConverter to handle both XML and MXL files
        const result = await mxlConverter.parseFile(file);
        
        if (!result.success) {
            log(result.error);
            console.error("Parse error:", result.error);
            return;
        }
        
        currentXMLString = result.xmlString;
        scoreData = result.scoreData;
        log("MusicXML loaded: " + scoreData.measures.length + " measures");
        checkDeckState();
        
        // Automatically render the score
        setTimeout(() => {
            if (currentXMLString) {
                renderOSMD();
            }
        }, 100);
        
        const conversionResult = mxlConverter.convertToMIDI(scoreData);
        midiEvents = conversionResult.midiEvents;
        notePairs = conversionResult.notePairs;
        totalDuration = conversionResult.totalDuration;
        
        document.getElementById('playbar').max = totalDuration;
        nextEventIndex = 0;
        currentTimeOffset = 0;
        updateTimeLabel(0);
        
        log("Score converted: " + midiEvents.length + " events, " + formatTime(totalDuration));
        
    } catch (error) {
        log("Error loading MusicXML: " + error.message);
        console.error("Full error:", error);
    }
}

async function parseMidiFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    // Clear any existing data
    clearCurrentFile();
    
    document.getElementById('fileNameDisplay').innerText = file.name;
    
    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    
    midiEvents = [];
    nextEventIndex = 0;
    let pos = 0;
    let tempoMap = [{ tick: 0, ms: 0, tempo: 500000 }];
    
    const readStr = (len) => String.fromCharCode(...data.slice(pos, pos += len));
    const read32 = () => (data[pos++] << 24) | (data[pos++] << 16) | (data[pos++] << 8) | data[pos++];
    const read16 = () => (data[pos++] << 8) | data[pos++];
    const readVar = () => {
        let v = 0;
        while (true) {
            let b = data[pos++];
            v = (v << 7) | (b & 0x7f);
            if (!(b & 0x80)) return v;
        }
    };
    
    if (readStr(4) !== "MThd") return;
    pos += 4;
    read16();
    const tracks = read16();
    const div = read16();
    
    for (let i = 0; i < tracks; i++) {
        if (readStr(4) !== "MTrk") break;
        let len = read32();
        let end = pos + len;
        let curTick = 0;
        let rs = null;
        
        while (pos < end) {
            curTick += readVar();
            let s = data[pos++];
            
            if (!(s & 0x80)) {
                s = rs;
                pos--;
            } else {
                rs = s;
            }
            
            const type = s & 0xf0;
            
            if (type === 0x80 || type === 0x90) {
                midiEvents.push({ tick: curTick, data: [s, data[pos++], data[pos++]] });
            } else if (s === 0xFF) {
                const m = data[pos++];
                const ml = readVar();
                if (m === 0x51) {
                    tempoMap.push({
                        tick: curTick,
                        tempo: (data[pos] << 16) | (data[pos + 1] << 8) | data[pos + 2]
                    });
                }
                pos += ml;
            } else if (type === 0xB0 || type === 0xE0) {
                pos += 2;
            } else if (type === 0xC0 || type === 0xD0) {
                pos += 1;
            }
        }
    }
    
    tempoMap.sort((a, b) => a.tick - b.tick);
    midiEvents.sort((a, b) => a.tick - b.tick);
    
    let lastT = tempoMap[0];
    let curMs = 0;
    
    tempoMap.forEach(tm => {
        curMs += ((tm.tick - lastT.tick) / div) * (lastT.tempo / 1000);
        tm.ms = curMs;
        lastT = tm;
    });
    
    midiEvents.forEach(ev => {
        let activeTempo = tempoMap[0];
        for (let t of tempoMap) {
            if (t.tick <= ev.tick) activeTempo = t;
            else break;
        }
        ev.time = activeTempo.ms + ((ev.tick - activeTempo.tick) / div) * (activeTempo.tempo / 1000);
    });
    
    totalDuration = midiEvents.length > 0 ? midiEvents[midiEvents.length - 1].time : 0;
    document.getElementById('playbar').max = totalDuration;
    updateTimeLabel(0);
    log("File Ready.");
    
    // Build note pairs for visualization
    notePairs = [];
    let tempNotes = {};
    
    midiEvents.forEach(ev => {
        const [status, note, vel] = ev.data;
        const type = status & 0xF0;
        
        if (type === 0x90 && vel > 0) {
            tempNotes[note] = ev.time;
        } else if (type === 0x80 || (type === 0x90 && vel === 0)) {
            if (tempNotes[note] !== undefined) {
                notePairs.push({
                    note: note,
                    start: tempNotes[note],
                    end: ev.time
                });
                delete tempNotes[note];
            }
        }
    });
}

// ============================================================================
// Keyboard & Visualization
// ============================================================================

function buildKeyboard() {
    const piano = document.getElementById('piano');
    const pattern = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
    
    for (let i = 21; i <= 108; i++) {
        const key = document.createElement('div');
        const isBlack = pattern[i % 12] === 1;
        key.className = `key ${isBlack ? 'black' : 'white'}`;
        key.id = `vkey-${i}`;
        piano.appendChild(key);
    }
}

function renderFallingNotes() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const whiteKeyNoteColor = "#e5c68a";
    const blackKeyNoteColor = "#917846";
    const blackKeyPattern = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
    
    notePairs.forEach(note => {
        const timeToStart = note.start - currentTimeOffset;
        const duration = note.end - note.start;
        const yBottom = canvas.height - (timeToStart * noteSpeed);
        const yTop = yBottom - (duration * noteSpeed);
        
        if (yBottom > 0 && yTop < canvas.height) {
            const keyEl = document.getElementById(`vkey-${note.note}`);
            if (keyEl) {
                const isBlackKey = blackKeyPattern[note.note % 12] === 1;
                const noteColor = isBlackKey ? blackKeyNoteColor : whiteKeyNoteColor;
                const originalW = keyEl.offsetWidth;
                const w = originalW * 0.5;
                const xOffset = (originalW - w) / 2;
                const x = keyEl.offsetLeft + xOffset;
                const h = yBottom - yTop;
                const radius = 6;
                
                ctx.save();
                ctx.shadowColor = noteColor;
                ctx.shadowBlur = 15;
                ctx.fillStyle = noteColor;
                ctx.globalAlpha = 0.9;
                ctx.beginPath();
                ctx.roundRect(x, yTop, w, h, radius);
                ctx.fill();
                ctx.shadowBlur = 0;
                ctx.globalAlpha = 1.0;
                ctx.strokeStyle = "rgba(255,255,255,0.3)";
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.restore();
            }
        }
    });
    
    requestAnimationFrame(renderFallingNotes);
}


function visualizeNote(data, skipLights = false) {
    let [status, note, velocity] = data;
    const pulse = document.getElementById('midiPulse');
    pulse.classList.add('active');
    setTimeout(() => pulse.classList.remove('active'), 50);
    
    const isNoteOn = (status & 0xf0) === 0x90 && velocity > 0;
    const vKey = document.getElementById(`vkey-${note}`);
    
    if (vKey) {
        if (isNoteOn) {
            vKey.classList.add('active');
        } else {
            vKey.classList.remove('active');
        }
    }
    
	// CHANGED: Highlight notes in the score
    highlightNote(note, isNoteOn);
	
    // Skip lights if in learning mode and this is from incoming MIDI
    if (!writer || skipLights) return;
    
    const index = (note + (parseInt(document.getElementById('octaveShift').value) * 12) +
        parseInt(document.getElementById('transpose').value) - 21) * 2;
    
    if (index >= 0 && index < 288) {
        if (isNoteOn) {
            const blackKeyPattern = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
            const isBlackKey = blackKeyPattern[note % 12] === 1;
            const hex = isBlackKey ?
                document.getElementById('blackKeyColor').value :
                document.getElementById('whiteKeyColor').value;
            
            let r = parseInt(hex.substring(1, 3), 16);
            let g = parseInt(hex.substring(3, 5), 16);
            let b = parseInt(hex.substring(5, 7), 16);
            
            if (rainbow) {
                [r, g, b] = hslToRgb((note % 12) / 12, 1, 0.5);
            }
            
            const bright = parseInt(document.getElementById('brightness').value);
            writer.write(new TextEncoder().encode(`${index},${r},${g},${b},${bright}\n`));
        } else {
            writer.write(new TextEncoder().encode(`${index},0,0,0,0\n`));
        }
    }
}

// ============================================================================
// Hardware Connectivity
// ============================================================================

async function connectSerial() {
    try {
        port = await navigator.serial.requestPort();
        await port.open({ baudRate: 115200 });
        writer = port.writable.getWriter();
        document.getElementById('btnSerial').classList.add('active');
        log("Lighting Online.");
    } catch (e) {
        log("Serial failed.");
    }
}

async function connectMidi() {
    try {
        const access = await navigator.requestMIDIAccess();
        const select = document.getElementById('midiOutSelect');
        select.innerHTML = '<option value="">Select Output Device...</option>';
        
        for (let output of access.outputs.values()) {
            let opt = document.createElement('option');
            opt.value = output.id;
            opt.innerText = output.name;
            select.appendChild(opt);
        }
        
        select.onchange = () => {
            midiOutput = access.outputs.get(select.value);
            document.getElementById('pianoStatus').innerText = midiOutput ? "Linked" : "Offline";
        };
        
        for (let input of access.inputs.values()) {
            input.onmidimessage = handleIncomingMidi;
        }
        
        document.getElementById('btnMidi').classList.add('active');
    } catch (e) {
        log("MIDI failed.");
    }
}

function handleIncomingMidi(message) {
    const [status, note, velocity] = message.data;
    
    if (isTestActive && (status & 0xf0) === 0x90 && velocity > 0) {
        document.getElementById('btnTest').innerText = `${note}`;
    }
    
    // In learning mode, don't light up keys for incoming MIDI
    visualizeNote(message.data, learningMode);
    
    if (!learningMode) return;
    
    if ((status & 0xf0) === 0x90 && velocity > 0) {
        const idx = currentTargetNotes.indexOf(note);
        if (idx !== -1) {
            currentTargetNotes.splice(idx, 1);
            if (currentTargetNotes.length === 0) {
                advanceLearningStep();
            }
        }
    }
}

async function toggleSystemTest() {
    const btn = document.getElementById('btnTest');
    
    if (isTestActive) {
        isTestActive = false;
        btn.classList.remove('active');
        btn.innerText = "Test";
        log("Test Mode Off.");
        hush();
        return;
    }
    
    isTestActive = true;
    btn.classList.add('active');
    log("Running Hardware Sweep...");
    
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const startNote = 21;
    const endNote = 108;
    
    // Ascending
    for (let n = startNote; n <= endNote && isTestActive; n++) {
        handleMidi([0x90, n, 100]);
        await sleep(30);
        handleMidi([0x80, n, 0]);
    }
    
    // Descending
    for (let n = endNote; n >= startNote && isTestActive; n--) {
        handleMidi([0x90, n, 100]);
        await sleep(30);
        handleMidi([0x80, n, 0]);
    }
    
    if (isTestActive) {
        log("Sweep Finished. Monitoring Input...");
    }
}

// ============================================================================
// Playback Control
// ============================================================================

function toggleLearningMode() {
    learningMode = !learningMode;
    document.getElementById('btnLearn').classList.toggle('active', learningMode);
    
    if (learningMode) {
        isPlaying = false;
        prepareNextLearningStep();
    } else {
        hush();
        log("Standard Mode.");
    }
}

function prepareNextLearningStep() {
    if (!learningMode || nextEventIndex >= midiEvents.length) return;
    
    currentTargetNotes = [];
    hush();
    
    let nextNoteEvent = midiEvents.slice(nextEventIndex).find(ev =>
        (ev.data[0] & 0xf0) === 0x90 && ev.data[2] > 0
    );
    
    if (!nextNoteEvent) return;
    
    const targetTime = nextNoteEvent.time;
    nextEventIndex = midiEvents.findIndex(ev => ev.time === targetTime);
    let lookAhead = nextEventIndex;
    
    while (lookAhead < midiEvents.length && Math.abs(midiEvents[lookAhead].time - targetTime) < 50) {
        const ev = midiEvents[lookAhead];
        if ((ev.data[0] & 0xf0) === 0x90 && ev.data[2] > 0) {
            currentTargetNotes.push(ev.data[1]);
            visualizeNote(ev.data);
        }
        lookAhead++;
    }
    
    currentTimeOffset = targetTime;
    document.getElementById('playbar').value = currentTimeOffset;
    updateTimeLabel(currentTimeOffset);
}

function advanceLearningStep() {
    const targetTime = midiEvents[nextEventIndex].time;
    while (nextEventIndex < midiEvents.length && Math.abs(midiEvents[nextEventIndex].time - targetTime) < 50) {
        nextEventIndex++;
    }
    prepareNextLearningStep();
}

function startPlayback() {
    if (midiEvents.length === 0) return;
    if (learningMode) toggleLearningMode();
    
    isPlaying = true;
    document.getElementById('btnPlay').classList.add('active');
    document.getElementById('btnPause').classList.remove('active');
    
    // Show playhead bar
    if (playheadBar) {
        playheadBar.setAttribute('opacity', '0.8');
    }
    
    // If starting from beginning and there's a rest, skip to first note
    if (currentTimeOffset === 0 && firstNoteOffset > 0) {
        currentTimeOffset = firstNoteOffset;
    }
    
    startTime = performance.now() - (currentTimeOffset / playbackRate);
    playLoop();
}

// CHANGED: Call clearAllNoteHighlights() when paused
function pausePlayback() {
    isPlaying = false;
    cancelAnimationFrame(playTimer);
    hush();
    
    document.getElementById('btnPlay').classList.remove('active');
    document.getElementById('btnPause').classList.add('active');
	// Clear all note highlights when paused
    // clearAllNoteHighlights();
}

// CHANGED: Removed highlightCurrentMeasure() call
function playLoop() {
    if (!isPlaying) return;
    
    currentTimeOffset = (performance.now() - startTime) * playbackRate;
    
	while (nextEventIndex < midiEvents.length && midiEvents[nextEventIndex].time <= currentTimeOffset) {
        handleMidi(midiEvents[nextEventIndex].data);
        nextEventIndex++;
    }
    
    document.getElementById('playbar').value = currentTimeOffset;
    updateTimeLabel(currentTimeOffset);
	updatePlayheadPosition();
	updateScoreScroll();
    
    if (currentTimeOffset >= totalDuration) {
        pausePlayback();
    } else {
        playTimer = requestAnimationFrame(playLoop);
    }
}

function handleMidi(data) {
    let [status, note, velocity] = data;
    let forcedStatus = (status & 0xF0) | 0x00;
    
    // Send to MIDI output if available
    if (midiOutput) {
        let vol = parseInt(document.getElementById('volume').value) / 100;
        let finalVelocity = Math.round(velocity * vol);
        midiOutput.send([forcedStatus, note, finalVelocity]);
    } else {
        // Use Web Audio synthesizer as fallback
        const vol = parseInt(document.getElementById('volume').value) / 100;
        const finalVelocity = Math.round(velocity * vol);
        
        const statusType = status & 0xF0;
        // Note on: 0x90 with velocity > 0
        // Note off: 0x80 OR 0x90 with velocity = 0
        const isNoteOn = statusType === 0x90 && velocity > 0;
        const isNoteOff = statusType === 0x80 || (statusType === 0x90 && velocity === 0);
        
        if (isNoteOn) {
            AudioSynth.noteOn(note, finalVelocity);
        } else if (isNoteOff) {
            AudioSynth.noteOff(note);
        }
    }
    
    visualizeNote(data);
}


async function hush() {
    if (midiOutput) {
        for (let n = 0; n < 127; n++) {
            midiOutput.send([0x80, n, 0]);
        }
    }
    
    // Stop all audio synth notes
    if (typeof AudioSynth !== 'undefined') {
        AudioSynth.stopAll();
    }
    
    if (writer) {
        try {
            await writer.write(new TextEncoder().encode("R\n"));
        } catch (e) { }
    }
    
    const keys = document.querySelectorAll('.key');
    keys.forEach(k => k.classList.remove('active'));
}

// ============================================================================
// Playback Navigation
// ============================================================================

function changeSpeed(delta) {
    playbackRate = Math.min(Math.max(playbackRate + delta, 0.25), 4.0);
    document.getElementById('speedVal').innerText = playbackRate.toFixed(2) + "x";
    
    if (isPlaying) {
        startTime = performance.now() - (currentTimeOffset / playbackRate);
    }
}

function seek(val) {
    currentTimeOffset = parseFloat(val);
    nextEventIndex = Math.max(0, midiEvents.findIndex(ev => ev.time >= currentTimeOffset));
    
    // Update playbar immediately
    document.getElementById('playbar').value = currentTimeOffset;
    updateTimeLabel(currentTimeOffset);
    
    // Update score scroll position immediately
    updateScoreScroll();
    
    // Show playhead at new position
    if (playheadBar) {
        playheadBar.setAttribute('opacity', '0.8');
    }
    
    if (isPlaying) {
        startTime = performance.now() - (currentTimeOffset / playbackRate);
    }
    
    if (learningMode) {
        prepareNextLearningStep();
    }
}

function skip(ms) {
    seek(Math.min(Math.max(currentTimeOffset + ms, 0), totalDuration));
}

function resetSpeed() {
    playbackRate = 1.0;
    document.getElementById('speedVal').innerText = "1.00x";
    
    if (isPlaying) {
        startTime = performance.now() - (currentTimeOffset / playbackRate);
    }
}

// ============================================================================
// Utility Functions
// ============================================================================

// ============================================================================
// Utility Functions
// ============================================================================

function clearCurrentFile() {
    // Stop playback if active
    if (isPlaying) {
        pausePlayback();
    }
    
    // Clear all data
    midiEvents = [];
    notePairs = [];
    nextEventIndex = 0;
    totalDuration = 0;
    currentTimeOffset = 0;
    startTime = 0;
    scoreData = null;
    currentXMLString = null;
    measureGroupsCache = null;
    
    // Clear playhead
    if (playheadBar) {
        playheadBar.remove();
        playheadBar = null;
    }
    
    // Reset UI
    
    // Reset UI
    document.getElementById('playbar').max = 100;
    document.getElementById('playbar').value = 0;
    updateTimeLabel(0);
    
    // Clear visualizations
    hush();
    
    // Clear score display
    const osmdContainer = document.getElementById('osmdContainer');
    osmdContainer.innerHTML = '';
    const scoreContainer = document.getElementById('scoreContainer');
    scoreContainer.style.display = 'none';
    
    // Reset file name displays
    document.getElementById('fileNameDisplay').innerText = 'Load MIDI File';
    document.getElementById('xmlFileNameDisplay').innerText = 'Load MusicXML';
    
    log("Previous file cleared.");
}

function hslToRgb(h, s, l) {
    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    
    return [
        Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
        Math.round(hue2rgb(p, q, h) * 255),
        Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
    ];
}

function formatTime(ms) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

function updateTimeLabel(ms) {
    document.getElementById('timeLabel').innerText = `${formatTime(ms)} / ${formatTime(totalDuration)}`;
}

function toggleRainbow() {
    rainbow = !rainbow;
    document.getElementById('btnRainbow').classList.toggle('active', rainbow);
}

function toggleMeasureDebug() {
    showMeasureDebug = !showMeasureDebug;
    const btn = document.getElementById('btnDebugMeasures');
    btn.classList.toggle('active', showMeasureDebug);
    btn.innerText = showMeasureDebug ? 'Hide Measure Markers' : 'Show Measure Markers';
    
    const svg = document.querySelector('#osmdContainer svg');
    if (!svg) return;
    
    // Find all debug markers (blue bars and measure numbers)
    const debugBars = Array.from(svg.querySelectorAll('line[stroke="#4A90E2"]'));
    const debugNumbers = Array.from(svg.querySelectorAll('text[fill="#4A90E2"]'));
    
    // Toggle visibility
    [...debugBars, ...debugNumbers].forEach(el => {
        el.style.display = showMeasureDebug ? 'block' : 'none';
    });
    
    log(showMeasureDebug ? "Measure markers visible" : "Measure markers hidden");
}

function openLibraryDialog() {
    const dialog = document.getElementById('libraryDialog');
    dialog.style.display = 'flex';
    
    // Automatically load library list when dialog opens
    loadLibraryList();
}

function closeLibraryDialog() {
    const dialog = document.getElementById('libraryDialog');
    dialog.style.display = 'none';
}

async function loadLibraryList() {
    const statusDiv = document.getElementById('libraryStatus');
    const fileListDiv = document.getElementById('libraryFileList');
    const browseBtn = document.getElementById('btnBrowseLibrary');
    
    // If already loaded, just show the list
    if (fileListDiv.innerHTML !== '' && fileListDiv.style.display === 'block') {
        return;
    }
    
    try {
        statusDiv.textContent = "Loading library...";
        browseBtn.disabled = true;
        browseBtn.style.opacity = '0.5';
        
        // GitHub API endpoint for the repository contents
        const apiUrl = 'https://api.github.com/repos/musetrainer/library/contents/scores';
        
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status}`);
        }
        
        const files = await response.json();
        
        // Filter for XML and MXL files
        const musicFiles = files.filter(file => 
            file.type === 'file' && 
            (file.name.endsWith('.xml') || file.name.endsWith('.musicxml') || file.name.endsWith('.mxl'))
        );
        
        if (musicFiles.length === 0) {
            statusDiv.textContent = "No MusicXML files found in library";
            browseBtn.disabled = false;
            browseBtn.style.opacity = '1';
            return;
        }
        
        // Sort files alphabetically
        musicFiles.sort((a, b) => a.name.localeCompare(b.name));
        
        // Populate the file list
        fileListDiv.innerHTML = '';
        fileListDiv.style.display = 'block';
        browseBtn.style.display = 'none';
        
        musicFiles.forEach(file => {
            const fileItem = document.createElement('div');
            fileItem.style.cssText = 'padding: 12px 15px; margin: 6px 0; background: #2a2a30; border-radius: 6px; cursor: pointer; transition: all 0.2s; color: #d1d1d1; font-size: 14px; border: 1px solid transparent;';
            fileItem.textContent = '🎼 ' + file.name.replace(/\.(xml|musicxml|mxl)$/, '');
            
            fileItem.onmouseover = () => {
                fileItem.style.background = '#35353d';
                fileItem.style.borderColor = '#c2a878';
                fileItem.style.transform = 'translateX(5px)';
            };
            fileItem.onmouseout = () => {
                fileItem.style.background = '#2a2a30';
                fileItem.style.borderColor = 'transparent';
                fileItem.style.transform = 'translateX(0)';
            };
            
            fileItem.onclick = () => loadLibraryFile(file.download_url, file.name);
            
            fileListDiv.appendChild(fileItem);
        });
        
        statusDiv.textContent = `Found ${musicFiles.length} files`;
        
    } catch (error) {
        statusDiv.textContent = "Error loading library: " + error.message;
        console.error("Full error:", error);
        browseBtn.disabled = false;
        browseBtn.style.opacity = '1';
    }
}

async function loadLibraryFile(fileUrl, fileName) {
    try {
        closeLibraryDialog();
        log("Loading: " + fileName + "...");
        
        const response = await fetch(fileUrl);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        // Check if it's an MXL file (compressed) or XML
        const isMXL = fileName.endsWith('.mxl');
        
        // Clear any existing data
        clearCurrentFile();
        measureGroupsCache = null;
        
        if (isMXL) {
            // Handle MXL files (compressed)
            const arrayBuffer = await response.arrayBuffer();
            const blob = new Blob([arrayBuffer]);
            const file = new File([blob], fileName);
            
            const result = await mxlConverter.parseFile(file);
            
            if (!result.success) {
                log(result.error);
                return;
            }
            
            currentXMLString = result.xmlString;
            scoreData = result.scoreData;
        } else {
            // Handle plain XML files
            const xmlString = await response.text();
            
            const result = await mxlConverter.parseXMLString(xmlString);
            
            if (!result.success) {
                log(result.error);
                return;
            }
            
            currentXMLString = result.xmlString;
            scoreData = result.scoreData;
        }
        
        // Update display
        document.getElementById('xmlFileNameDisplay').innerText = fileName.replace(/\.(xml|musicxml|mxl)$/, '');
        
        log("Loaded: " + scoreData.measures.length + " measures");
        checkDeckState();
        
        // Automatically render the score
        setTimeout(() => {
            if (currentXMLString) {
                renderOSMD();
            }
        }, 100);
        
        const conversionResult = mxlConverter.convertToMIDI(scoreData);
        midiEvents = conversionResult.midiEvents;
        notePairs = conversionResult.notePairs;
        totalDuration = conversionResult.totalDuration;
        
        document.getElementById('playbar').max = totalDuration;
        nextEventIndex = 0;
        currentTimeOffset = 0;
        updateTimeLabel(0);
        
        log("Ready: " + midiEvents.length + " events, " + formatTime(totalDuration));
        
    } catch (error) {
        log("Error loading file: " + error.message);
        console.error("Full error:", error);
    }
}

// ============================================================================
// Initialization
// ======================================================================================================================================================

window.onload = () => {
    buildKeyboard();
    updateUI();
    renderFallingNotes();
    checkDeckState();
	lastScrollUpdate = performance.now();
};

// Click outside test button to deactivate test mode
document.addEventListener('mousedown', function (e) {
    const btnTest = document.getElementById('btnTest');
    
    if (isTestActive && e.target !== btnTest) {
        isTestActive = false;
        btnTest.classList.remove('active');
        btnTest.innerText = "Test";
        log("Test Deactivated.");
        hush();
    }
}, true);