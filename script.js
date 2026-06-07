// Cache canvas and context elements first to prevent scope initialization issues
const canvas = document.getElementById('three-body-canvas');
const ctx = canvas.getContext('2d');

// =========================================================================
// 1. GLOBAL SETTINGS & CONFIGURATIONS
// =========================================================================
const CONFIG = {
    G: 375,                         // Gravitational constant (375 / 3)
    springK: 0.00002 / 3,           // Centrifugal system bounding spring pull
    softening: 450,                 // Zero distance singularity shield
    repulseRadius: 140,             // Cursor influence field
    repulseStrength: 0.01,          // Cursor deflection multiplier
    bounceElasticity: 0.85,         // Boundary collision momentum retention
    numParticles: 30,               // Default cosmic background dust particles
    drag: 0.993,                    // Ambient atmospheric drag
    dtSlow: 0.5,                    // Step scalar for Slow-Mo active state
    
    // Repulsion system settings (Standard Model / Potential Barrier)
    strongRepulsionThreshold: 75,   // Expanded boundary to allow gentle initial interaction
    strongRepulsionStrength: 60,    // Softened constant (180 / 3)
    proximityChargeRate: 0.001,     // Slower speed of charge build-up when close (0.003 / 3)
    proximityDischargeRate: 0.0017, // Slower dissipation rate of charge once separated (0.005 / 3)

    // Adaptive tier variables configured on execution
    maxBodies: 150,                 // Elevated baseline headroom (will self-cap dynamically on slowdown)
    planetRadius: 8.0,              // Dynamic base body size scale factor
    maxTrailLength: 120,            // Limit trail length based on computing budget
    deviceTier: "MEDIUM"            // Client performance bucket
};

// =========================================================================
// 2. SIMULATION STATE REGISTRY
// =========================================================================
let width = canvas.width = window.innerWidth;
let height = canvas.height = window.innerHeight;

const STATE = {
    isSimRunning: true,             // Toggled via Play/Pause button
    isDimSlowMode: true,            // DEFAULTED TO TRUE: Dim & Blurred Mode on start
    isSpawnModeActive: false,       // Custom interactive direct click-to-spawn state
    lastScrollY: window.scrollY,    // Cached window position to calculate scroll delta
    mouse: { 
        x: -1000, 
        y: -1000, 
        active: false 
    },
    
    // Charge values tracked dynamically between bodies to enforce local potential barriers
    proximityCharge: {}
};

// =========================================================================
// 3. UI ELEMENT SELECTORS & BINDINGS
// =========================================================================
const UI = {
    // Collapsible structural hooks
    mainSimPanel: document.getElementById('main-sim-panel'),
    panelCollapseBtn: document.getElementById('toggle-panel-collapse'),
    panelSettingsBtn: document.getElementById('toggle-panel-settings'),
    panelBody: document.getElementById('sim-panel-body'),
    settingsDrawer: document.getElementById('sim-settings-drawer'),
    collapseArrow: document.getElementById('collapse-arrow'),

    // Simulation interactives
    toggleSimBtn: document.getElementById('toggle-sim-btn'),
    toggleDimBtn: document.getElementById('toggle-dim-btn'),
    addBodyBtn: document.getElementById('add-body-btn'),
    toggleSpawnBtn: document.getElementById('toggle-spawn-btn'),
    resetSimBtn: document.getElementById('reset-sim-btn'),

    // Sliders & value labels
    sliderBodyCount: document.getElementById('slider-body-count'),
    valBodyCount: document.getElementById('val-body-count'),
    labelBodyCount: document.getElementById('label-body-count'),
    sliderGravity: document.getElementById('slider-gravity'),
    valGravity: document.getElementById('val-gravity'),
    sliderDrag: document.getElementById('slider-drag'),
    valDrag: document.getElementById('val-drag'),
    sliderRepelRange: document.getElementById('slider-repel-range'),
    valRepelRange: document.getElementById('val-repel-range'),
    sliderRepelForce: document.getElementById('slider-repel-force'),
    valRepelForce: document.getElementById('val-repel-force')
};

// =========================================================================
// 4. DEVICE PROFILE & PERFORMANCE OPTIMIZATION
// =========================================================================
function optimizeForDevice() {
    let score = 0;
    
    // 1. Thread concurrency check
    if (navigator.hardwareConcurrency) {
        score += navigator.hardwareConcurrency; // Add core count to baseline
    } else {
        score += 4;
    }
    
    // 2. System memory profiling
    if (navigator.deviceMemory) {
        score += navigator.deviceMemory; 
    } else {
        score += 4;
    }
    
    // 3. Form factor validation
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) {
        score -= 6; // Deduct score to reflect tighter GPU/thermal limit budgets
    }
    
    // Assign responsive physics configuration tier
    if (score >= 12) {
        CONFIG.deviceTier = "HIGH";
        CONFIG.numParticles = 45;
        CONFIG.planetRadius = 9.0;
        CONFIG.maxTrailLength = 180;
        CONFIG.maxBodies = 180;      // Highly optimized desktop baseline
    } else if (score >= 6) {
        CONFIG.deviceTier = "MEDIUM";
        CONFIG.numParticles = 25;
        CONFIG.planetRadius = 8.0;
        CONFIG.maxTrailLength = 100;
        CONFIG.maxBodies = 90;       // Balanced baseline
    } else {
        CONFIG.deviceTier = "LOW";
        CONFIG.numParticles = 12;
        CONFIG.planetRadius = 6.0;
        CONFIG.maxTrailLength = 40;
        CONFIG.maxBodies = 30;        // Secure base limit
        
        // Disable resource-intensive CSS layout blurs to maintain performance target on older mobile browsers
        canvas.classList.remove('blurred');
        canvas.style.transition = "none";
        canvas.style.filter = "none";
    }
    console.log(`Profiler Configured: Tier ${CONFIG.deviceTier} (Performance Index: ${score})`);
}

// Apply device optimization rules first
optimizeForDevice();

// =========================================================================
// 5. HELPER FUNCTIONS
// =========================================================================
const getProximityKey = (idx1, idx2) => {
    return idx1 < idx2 ? `${idx1}-${idx2}` : `${idx2}-${idx1}`;
};

// =========================================================================
// 6. PHYSICS & RENDER OBJECTS (CLASSES)
// =========================================================================
class Body {
    constructor(x, y, vx, vy, mass, color) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.mass = mass;
        this.color = color;
        // Dynamically scale visual size according to mass distribution and device presets
        this.radius = CONFIG.planetRadius + (mass * 1.5); 
        this.trail = [];
        this.maxTrail = CONFIG.maxTrailLength;
    }

    update() {
        if (!STATE.isSimRunning) return;

        const dt = STATE.isDimSlowMode ? CONFIG.dtSlow : 1.0;

        // Center bounding constraint pull
        const dx = (width / 2) - this.x;
        const dy = (height / 2) - this.y;
        this.vx += dx * CONFIG.springK * dt;
        this.vy += dy * CONFIG.springK * dt;

        // Input cursor deflection push
        if (STATE.mouse.active) {
            const mdx = this.x - STATE.mouse.x;
            const mdy = this.y - STATE.mouse.y;
            const mDistSq = mdx * mdx + mdy * mdy;
            
            if (mDistSq < CONFIG.repulseRadius * CONFIG.repulseRadius) {
                const mDist = Math.sqrt(mDistSq);
                if (mDist > 0) {
                    const force = (CONFIG.repulseRadius - mDist) / CONFIG.repulseRadius;
                    this.vx += (mdx / mDist) * force * CONFIG.repulseStrength * dt;
                    this.vy += (mdy / mDist) * force * CONFIG.repulseStrength * dt;
                }
            }
        }

        // Smooth aerodynamic friction
        this.vx *= CONFIG.drag;
        this.vy *= CONFIG.drag;

        // Commit positions
        this.x += this.vx * dt;
        this.y += this.vy * dt;

        // Screen Boundary Collisions with elastic bounce
        const limitX = width - this.radius;
        if (this.x - this.radius < 0) {
            this.x = this.radius;
            this.vx = Math.abs(this.vx) * CONFIG.bounceElasticity;
        } else if (this.x > limitX) {
            this.x = limitX;
            this.vx = -Math.abs(this.vx) * CONFIG.bounceElasticity;
        }

        const limitY = height - this.radius;
        if (this.y - this.radius < 0) {
            this.y = this.radius;
            this.vy = Math.abs(this.vy) * CONFIG.bounceElasticity;
        } else if (this.y > limitY) {
            this.y = limitY;
            this.vy = -Math.abs(this.vy) * CONFIG.bounceElasticity;
        }

        // Append and trim render trail array
        this.trail.push({ x: this.x, y: this.y });
        if (this.trail.length > this.maxTrail) {
            this.trail.shift();
        }
    }

    draw() {
        const opacityMultiplier = STATE.isDimSlowMode ? 0.55 : 1.0;
        const len = this.trail.length;

        // Draw orbital gradient tail
        if (len > 1) {
            for (let i = 1; i < len; i++) {
                ctx.beginPath();
                ctx.moveTo(this.trail[i - 1].x, this.trail[i - 1].y);
                ctx.lineTo(this.trail[i].x, this.trail[i].y);
                ctx.strokeStyle = this.color;
                ctx.globalAlpha = (i / len) * 0.35 * opacityMultiplier;
                ctx.lineWidth = 1.2;
                ctx.stroke();
            }
        }

        // Draw solid central nucleus
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.globalAlpha = opacityMultiplier;
        ctx.fill();
        ctx.globalAlpha = 1.0; // Reset canvas context alpha
    }
}

class DustParticle {
    constructor() {
        this.reset();
    }

    reset() {
        this.x = Math.random() * width;
        this.y = Math.random() * height;
        this.vx = (Math.random() - 0.5) * 0.4; // Speed calibration
        this.vy = (Math.random() - 0.5) * 0.4;
        this.alpha = Math.random() * 0.25 + 0.05;
        this.color = Math.random() > 0.5 ? '#8e8e93' : '#ffffff';
        this.trail = [];
        this.maxTrail = 15;
    }

    update() {
        if (!STATE.isSimRunning) return;

        const dt = STATE.isDimSlowMode ? CONFIG.dtSlow : 1.0;

        // Dynamic gravity calculation from all active massive bodies
        bodies.forEach(b => {
            const dx = b.x - this.x;
            const dy = b.y - this.y;
            const distSq = dx * dx + dy * dy;
            
            if (distSq < 144) { // Collapse trigger if too close to center
                this.reset();
                return;
            }

            const dist = Math.sqrt(distSq);
            const force = (CONFIG.G * b.mass) / (distSq + CONFIG.softening);
            this.vx += (dx / dist) * force * 0.003 * dt; 
            this.vy += (dy / dist) * force * 0.003 * dt;
        });

        // Deflection from cursor
        if (STATE.mouse.active) {
            const mdx = this.x - STATE.mouse.x;
            const mdy = this.y - STATE.mouse.y;
            const mDistSq = mdx * mdx + mdy * mdy;
            
            if (mDistSq < 8100) { 
                const mDist = Math.sqrt(mDistSq);
                if (mDist > 0) {
                    const force = (90 - mDist) / 90;
                    this.vx += (mdx / mDist) * force * 0.15 * dt; 
                    this.vy += (mdy / mDist) * force * 0.15 * dt;
                }
            }
        }

        this.vx *= 0.99;
        this.vy *= 0.99;

        this.x += this.vx * dt;
        this.y += this.vy * dt;

        this.trail.push({ x: this.x, y: this.y });
        if (this.trail.length > this.maxTrail) {
            this.trail.shift();
        }

        if (this.x < 0 || this.x > width || this.y < 0 || this.y > height) {
            this.reset();
        }
    }

    draw() {
        const opacityMultiplier = STATE.isDimSlowMode ? 0.55 : 1.0;
        const len = this.trail.length;

        if (len < 2) return;
        for (let i = 1; i < len; i++) {
            ctx.beginPath();
            ctx.moveTo(this.trail[i - 1].x, this.trail[i - 1].y);
            ctx.lineTo(this.trail[i].x, this.trail[i].y);
            ctx.strokeStyle = this.color;
            ctx.globalAlpha = (i / len) * this.alpha * 0.6 * opacityMultiplier;
            ctx.lineWidth = 0.6;
            ctx.stroke();
        }
        ctx.globalAlpha = 1.0;
    }
}

// =========================================================================
// 7. CORE ENGINE LOGIC (DYNAMIC N-BODY INTERACTIONS)
// =========================================================================
let bodies = [];
let particles = [];

function calculateForces() {
    if (!STATE.isSimRunning) return;

    const dt = STATE.isDimSlowMode ? CONFIG.dtSlow : 1.0;

    // Compute pairwise gravity & Standard Model proximity repulsion
    const computeInteractiveForces = (idx1, idx2) => {
        const b1 = bodies[idx1];
        const b2 = bodies[idx2];
        if (!b1 || !b2) return;

        const pairKey = getProximityKey(idx1, idx2);

        const dx = b2.x - b1.x;
        const dy = b2.y - b1.y;
        const dSq = dx * dx + dy * dy;
        
        let dist = Math.sqrt(dSq);
        if (dist < 0.1) dist = 0.1;

        // Universal gravitational attraction
        let f = (CONFIG.G * b1.mass * b2.mass) / (dSq + CONFIG.softening);

        // Short-range delayed repulsion mechanics
        if (dist < CONFIG.strongRepulsionThreshold) {
            if (STATE.proximityCharge[pairKey] === undefined) {
                STATE.proximityCharge[pairKey] = 0;
            }
            // Accumulate repulsion charge slowly
            STATE.proximityCharge[pairKey] = Math.min(1.0, STATE.proximityCharge[pairKey] + CONFIG.proximityChargeRate * dt);
            
            // Linear overlap scaling
            const overlap = CONFIG.strongRepulsionThreshold - dist;
            const baseRepel = CONFIG.strongRepulsionStrength * (overlap / dist);
            
            // Apply charge scaling to delay structural deflection
            const fRepel = baseRepel * STATE.proximityCharge[pairKey];
            f -= fRepel; 
        } else {
            // Dissipate charge once separated
            if (STATE.proximityCharge[pairKey] !== undefined) {
                STATE.proximityCharge[pairKey] = Math.max(0.0, STATE.proximityCharge[pairKey] - CONFIG.proximityDischargeRate * dt);
            }
        }

        // Resolve force vector
        const fx = (dx / dist) * f * dt;
        const fy = (dy / dist) * f * dt;

        b1.vx += fx / b1.mass;
        b1.vy += fy / b1.mass;
        b2.vx -= fx / b2.mass;
        b2.vy -= fy / b2.mass;
    };

    // Calculate mutual interactions for all bodies dynamically
    const len = bodies.length;
    for (let i = 0; i < len; i++) {
        for (let j = i + 1; j < len; j++) {
            computeInteractiveForces(i, j);
        }
    }
}

// Helper to spawn a body with rotational/orbital momentum relative to the screen center
function spawnBody(x, y, massInput) {
    const colors = ['#ff3b30', '#ffffff', '#8e8e93', '#ff9f0a', '#30d158', '#0a84ff', '#bf5af2'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const mass = massInput || (1.5 + Math.random() * 2.0);

    // Compute distance from center coordinates
    const cx = width / 2;
    const cy = height / 2;
    const dx = x - cx;
    const dy = y - cy;
    const distance = Math.sqrt(dx * dx + dy * dy) || 1;

    // Compute tangential vectors to encourage planetary rotation rather than sudden implosion
    const tx = -dy / distance;
    const ty = dx / distance;
    const speed = (0.2 + Math.random() * 0.3) * (STATE.isDimSlowMode ? 1.5 : 1.0);

    const vx = tx * speed;
    const vy = ty * speed;

    bodies.push(new Body(x, y, vx, vy, mass, color));
}

// Adjust system body population upwards or downwards dynamically
function adjustBodyCount(targetCount) {
    const currentCount = bodies.length;
    if (targetCount > currentCount) {
        const diff = targetCount - currentCount;
        for (let i = 0; i < diff; i++) {
            const cx = width / 2;
            const cy = height / 2;
            const angle = Math.random() * Math.PI * 2;
            const offsetRadius = 100 + Math.random() * 150;
            const x = cx + Math.cos(angle) * offsetRadius;
            const y = cy + Math.sin(angle) * offsetRadius;
            spawnBody(x, y);
        }
    } else if (targetCount < currentCount) {
        const diff = currentCount - targetCount;
        for (let i = 0; i < diff; i++) {
            bodies.pop();
        }
    }
}

// Compute bi-directional logarithmic mapping for the slider interface to align with current array length
function syncBodySlider() {
    const count = bodies.length;
    UI.valBodyCount.textContent = count;
    const safeCount = Math.max(1, count);
    const S = Math.round(100 * (Math.log(safeCount) / Math.log(CONFIG.maxBodies)));
    UI.sliderBodyCount.value = Math.max(0, Math.min(100, S));
}

// Synchronize and update sliders with dynamic config structures
function updateConfigFromSliders() {
    CONFIG.G = parseFloat(UI.sliderGravity.value);
    UI.valGravity.textContent = CONFIG.G;

    CONFIG.drag = parseFloat(UI.sliderDrag.value);
    UI.valDrag.textContent = CONFIG.drag.toFixed(3);

    CONFIG.strongRepulsionThreshold = parseFloat(UI.sliderRepelRange.value);
    UI.valRepelRange.textContent = CONFIG.strongRepulsionThreshold + "px";

    CONFIG.strongRepulsionStrength = parseFloat(UI.sliderRepelForce.value);
    UI.valRepelForce.textContent = CONFIG.strongRepulsionStrength;
}

// =========================================================================
// 8. INTERACTIVE INPUT LISTENERS
// =========================================================================

// Window Resize proportional scaling helper
window.addEventListener('resize', () => {
    const lastWidth = width;
    const lastHeight = height;
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;

    bodies.forEach(b => {
        b.x = (b.x / lastWidth) * width;
        b.y = (b.y / lastHeight) * height;
    });
});

// Unified pointer coordination (supports both mouse & mobile touch)
window.addEventListener('pointermove', (e) => {
    STATE.mouse.x = e.clientX;
    STATE.mouse.y = e.clientY;
    STATE.mouse.active = true;
});

const disablePointer = () => { STATE.mouse.active = false; };
window.addEventListener('pointerleave', disablePointer);
window.addEventListener('pointercancel', disablePointer);

// Simulation Run/Pause Interactivity (Icon Swap)
UI.toggleSimBtn.addEventListener('click', () => {
    STATE.isSimRunning = !STATE.isSimRunning;
    const playIcon = UI.toggleSimBtn.querySelector('.icon-play');
    const pauseIcon = UI.toggleSimBtn.querySelector('.icon-pause');

    if (STATE.isSimRunning) {
        UI.toggleSimBtn.classList.add('active-state');
        playIcon.style.display = 'none';
        pauseIcon.style.display = 'block';
        UI.toggleSimBtn.setAttribute('title', 'Pause Simulation');
    } else {
        UI.toggleSimBtn.classList.remove('active-state');
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
        UI.toggleSimBtn.setAttribute('title', 'Resume Simulation');
    }
});

// Dim & Slow-Mo Interactivity
UI.toggleDimBtn.addEventListener('click', () => {
    STATE.isDimSlowMode = !STATE.isDimSlowMode;
    if (STATE.isDimSlowMode) {
        UI.toggleDimBtn.classList.add('active-state');
        UI.toggleDimBtn.setAttribute('title', 'Toggle Fast Motion');
        if (CONFIG.deviceTier !== "LOW") canvas.classList.add('blurred');
    } else {
        UI.toggleDimBtn.classList.remove('active-state');
        UI.toggleDimBtn.setAttribute('title', 'Toggle Slow Motion');
        if (CONFIG.deviceTier !== "LOW") canvas.classList.remove('blurred');
    }
});

// Button Click Orbit Spawner
UI.addBodyBtn.addEventListener('click', () => {
    if (bodies.length >= CONFIG.maxBodies) return; // Prevent spawning past active hardware buffer limit
    const cx = width / 2;
    const cy = height / 2;
    const angle = Math.random() * Math.PI * 2;
    const offsetRadius = 120 + Math.random() * 120;
    const x = cx + Math.cos(angle) * offsetRadius;
    const y = cy + Math.sin(angle) * offsetRadius;
    spawnBody(x, y);
    syncBodySlider();
});

// Canvas Click-to-Spawn Activation Mode
UI.toggleSpawnBtn.addEventListener('click', () => {
    STATE.isSpawnModeActive = !STATE.isSpawnModeActive;
    const container = document.getElementById('canvas-container');

    if (STATE.isSpawnModeActive) {
        UI.toggleSpawnBtn.classList.add('active-state');
        container.style.pointerEvents = "auto";
        canvas.style.cursor = "crosshair";
    } else {
        UI.toggleSpawnBtn.classList.remove('active-state');
        container.style.pointerEvents = "none";
        canvas.style.cursor = "default";
    }
});

// Canvas Spawn click capture
canvas.addEventListener('click', (e) => {
    if (STATE.isSpawnModeActive && bodies.length < CONFIG.maxBodies) {
        const rect = canvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        spawnBody(clickX, clickY);
        syncBodySlider();
    }
});

// Collapsing UI interaction bindings
UI.panelCollapseBtn.addEventListener('click', () => {
    const isCollapsed = UI.panelBody.classList.toggle('collapsed');
    UI.mainSimPanel.classList.toggle('collapsed-state', isCollapsed);
});

UI.panelSettingsBtn.addEventListener('click', () => {
    // Expand panel body first if it was previously collapsed
    if (UI.panelBody.classList.contains('collapsed')) {
        UI.panelBody.classList.remove('collapsed');
        UI.mainSimPanel.classList.remove('collapsed-state');
    }

    const isSettingsOpen = UI.settingsDrawer.classList.toggle('open');
    if (isSettingsOpen) {
        UI.panelSettingsBtn.classList.add('active-state');
    } else {
        UI.panelSettingsBtn.classList.remove('active-state');
    }
});

// Logarithmic Body Count Slider Change Input
UI.sliderBodyCount.addEventListener('input', (e) => {
    const S = parseInt(e.target.value);
    // Translate the range logarithmically using the active tier's maximum body scale limit
    const targetCount = Math.max(1, Math.round(Math.pow(CONFIG.maxBodies, S / 100)));
    adjustBodyCount(targetCount);
    UI.valBodyCount.textContent = targetCount;
});

// Sync parameters inputs dynamically
UI.sliderGravity.addEventListener('input', updateConfigFromSliders);
UI.sliderDrag.addEventListener('input', updateConfigFromSliders);
UI.sliderRepelRange.addEventListener('input', updateConfigFromSliders);
UI.sliderRepelForce.addEventListener('input', updateConfigFromSliders);

// Parameter Reset System
UI.resetSimBtn.addEventListener('click', () => {
    // Restore constants in CONFIG
    CONFIG.G = 375;
    CONFIG.drag = 0.993;
    CONFIG.strongRepulsionThreshold = 75;
    CONFIG.strongRepulsionStrength = 60;

    // Sync slider elements back to baseline values
    UI.sliderGravity.value = 375;
    UI.sliderDrag.value = 0.993;
    UI.sliderRepelRange.value = 75;
    UI.sliderRepelForce.value = 60;

    updateConfigFromSliders();
    initPhysics();
    STATE.proximityCharge = {};
});

// Inverse Scroll Momentum
window.addEventListener('scroll', () => {
    if (!STATE.isSimRunning) return;

    const currentScrollY = window.scrollY;
    const deltaY = currentScrollY - STATE.lastScrollY;
    STATE.lastScrollY = currentScrollY;

    const scrollDampen = STATE.isDimSlowMode ? 0.25 : 1.0;

    bodies.forEach(b => {
        b.vy -= deltaY * 0.03 * scrollDampen; 
        b.vx += (Math.random() - 0.5) * Math.abs(deltaY) * 0.015 * scrollDampen;
    });

    particles.forEach(p => {
        p.vy -= deltaY * 0.02 * scrollDampen; 
        p.vx += (Math.random() - 0.5) * Math.abs(deltaY) * 0.01 * scrollDampen;
    });
});

// Start collapsed on small screen widths to maintain CV text priority
if (window.innerWidth < 768) {
    UI.panelBody.classList.add('collapsed');
    UI.mainSimPanel.classList.add('collapsed-state');
}

// =========================================================================
// 9. ENGINE RUNTIME INITIALIZATION & FRAME PROFILING
// =========================================================================
let frameTimes = [];
const performanceHistoryLimit = 30; // Evaluate performance over a rolling window (~0.5s)

function checkPerformance() {
    // Skip assessment if simulation is paused or if only working with minimal bodies
    if (!STATE.isSimRunning || bodies.length <= 3) {
        frameTimes = [];
        return;
    }

    if (frameTimes.length < performanceHistoryLimit) return;
    
    const totalDuration = frameTimes.reduce((acc, curr) => acc + curr, 0);
    const averageDuration = totalDuration / frameTimes.length;
    
    // If processing overhead breaks 14ms (approaching 16.6ms threshold for 60Hz), scale back
    if (averageDuration > 14) {
        // Drop the last spawned body to immediately relieve processor stress
        bodies.pop();
        
        // Cap active threshold limit dynamically to prevent cascading drops
        CONFIG.maxBodies = bodies.length;
        syncBodySlider();
        
        // Visual feedback: Flash body count label red to signify capacity cap trigger
        UI.labelBodyCount.style.color = "var(--swiss-red)";
        setTimeout(() => {
            UI.labelBodyCount.style.color = "var(--text-secondary)";
        }, 1000);
        
        console.warn(`Adaptive Performance Safeguard: Frame processing time is high (${averageDuration.toFixed(1)}ms). Capping system to ${CONFIG.maxBodies} bodies.`);
        
        // Clear active arrays to prevent instant consecutive removals
        frameTimes = [];
    }
}

function initPhysics() {
    const cx = width / 2;
    const cy = height / 2;

    // Stable resonant orbital velocities calibrated for G = 375
    bodies = [
        new Body(cx - 160, cy - 80, -0.15, 0.55, 2.5, '#ff3b30'), // Swiss Red
        new Body(cx + 160, cy - 80, 0.15, -0.55, 2.5, '#ffffff'),  // Pure White
        new Body(cx, cy + 140, 0.3, 0.05, 2.5, '#48484a')          // Muted Slate
    ];

    particles = Array.from({ length: CONFIG.numParticles }, () => new DustParticle());
    
    // Align sliders correctly with initialization counts
    syncBodySlider();
}

function animate() {
    const frameStart = performance.now();

    ctx.clearRect(0, 0, width, height);

    calculateForces();

    bodies.forEach(b => {
        b.update();
        b.draw();
    });

    particles.forEach(p => {
        p.update();
        p.draw();
    });

    const frameEnd = performance.now();
    const processingTime = frameEnd - frameStart;
    
    frameTimes.push(processingTime);
    if (frameTimes.length > performanceHistoryLimit) {
        frameTimes.shift();
    }

    checkPerformance();

    requestAnimationFrame(animate);
}

// Initialize and execute standard run-cycle
initPhysics();
animate();

// =========================================================================
// 10. HIGH-FIDELITY AUDIO SYSTEM AND VISUALIZER
// =========================================================================
(function() {
    const audEl = document.getElementById('audio-element');
    const playBtn = document.getElementById('audio-play-btn');
    const playIcon = document.getElementById('aud-play-icon');
    const pauseIcon = document.getElementById('aud-pause-icon');
    const btnText = document.getElementById('audio-btn-text');
    const timeline = document.getElementById('audio-timeline-bar');
    const playhead = document.getElementById('audio-timeline-playhead');
    const timestamp = document.getElementById('audio-time-stamp');
    const volume = document.getElementById('audio-volume');
    const led = document.getElementById('audio-status-led');
    const visCanvas = document.getElementById('audio-visualizer');
    const visCtx = visCanvas.getContext('2d');

    let audioCtx = null;
    let analyser = null;
    let source = null;
    let bufferLength = 0;
    let dataArray = null;
    let setupComplete = false;

    // Resize canvas helper
    function resizeVisCanvas() {
        visCanvas.width = visCanvas.clientWidth * window.devicePixelRatio;
        visCanvas.height = visCanvas.clientHeight * window.devicePixelRatio;
    }
    window.addEventListener('resize', resizeVisCanvas);
    resizeVisCanvas();

    // Set initial volume
    audEl.volume = volume.value;

    // Create modern synthesized waveform profile for inactive states
    const wavePoints = [];
    for (let i = 0; i < 60; i++) {
        wavePoints.push(0.1 + Math.random() * 0.4 + (Math.sin(i / 10) * 0.2));
    }

    // Web Audio Setup on User Interaction (to comply with browser standards)
    function initAudioEngine() {
        if (setupComplete) return;
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            audioCtx = new AudioContextClass();
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 64; // Small size for responsive, clean bar layout
            
            source = audioCtx.createMediaElementSource(audEl);
            source.connect(analyser);
            analyser.connect(audioCtx.destination);
            
            bufferLength = analyser.frequencyBinCount;
            dataArray = new Uint8Array(bufferLength);
            setupComplete = true;
        } catch(e) {
            console.log("Web Audio Context initialized with fallback mode due to local dev CORS / restrictions", e);
        }
    }

    // Play/Pause Action hookup
    playBtn.addEventListener('click', () => {
        initAudioEngine();
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        if (audEl.paused) {
            audEl.play().catch(e => console.log("Playback interaction error:", e));
        } else {
            audEl.pause();
        }
    });

    audEl.addEventListener('play', () => {
        playIcon.style.display = 'none';
        pauseIcon.style.display = 'block';
        btnText.textContent = "PAUSE";
        led.classList.remove('paused');
    });

    audEl.addEventListener('pause', () => {
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
        btnText.textContent = "PLAY";
        led.classList.add('paused');
    });

    // Sync Timeline and Progress Details
    function formatTime(secs) {
        const minutes = Math.floor(secs / 60) || 0;
        const seconds = Math.floor(secs % 60) || 0;
        return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    }

    audEl.addEventListener('timeupdate', () => {
        const current = audEl.currentTime;
        const duration = audEl.duration || 0;
        const pct = duration > 0 ? (current / duration) * 100 : 0;
        
        playhead.style.width = pct + '%';
        timestamp.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
    });

    audEl.addEventListener('loadedmetadata', () => {
        timestamp.textContent = `0:00 / ${formatTime(audEl.duration)}`;
    });

    // Scrub timeline capability
    timeline.addEventListener('click', (e) => {
        const rect = timeline.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const pct = clickX / rect.width;
        const targetTime = pct * (audEl.duration || 0);
        
        audEl.currentTime = targetTime;
    });

    // Adjust Volume
    volume.addEventListener('input', (e) => {
        audEl.volume = e.target.value;
    });

    // Render continuous beautiful modular audio visualizer 
    function drawVisualizer() {
        requestAnimationFrame(drawVisualizer);
        
        const w = visCanvas.width;
        const h = visCanvas.height;
        visCtx.clearRect(0, 0, w, h);

        const isPlaying = !audEl.paused;
        const activeData = (setupComplete && isPlaying && dataArray);

        if (activeData) {
            analyser.getByteFrequencyData(dataArray);
        }

        const barWidth = w / 45;
        const spacing = 4;
        
        for (let i = 0; i < 45; i++) {
            let scaleValue = 0;
            
            if (activeData) {
                // Dynamically scale mapping from frequency array index
                const dataIndex = Math.floor((i / 45) * bufferLength);
                scaleValue = dataArray[dataIndex] / 255;
            } else {
                // Static/idle decorative wave oscillation
                const phase = isPlaying ? Date.now() * 0.004 : 0;
                const defaultAmp = wavePoints[i % wavePoints.length];
                scaleValue = defaultAmp + (Math.sin(i * 0.25 + phase) * 0.08);
            }

            // Constrain bounds elegantly
            scaleValue = Math.max(0.12, Math.min(0.9, scaleValue));
            
            const barHeight = h * scaleValue;
            const x = i * (barWidth + spacing);
            const y = (h - barHeight) / 2;

            // Swiss layout color gradient matching visual style (Red highlight near base/mid, otherwise light/medium grey)
            if (i % 7 === 0 && isPlaying) {
                visCtx.fillStyle = '#ff3b30'; // Swiss Red pulse
            } else {
                visCtx.fillStyle = isPlaying ? 'rgba(255,255,255,0.7)' : 'rgba(142,142,147,0.35)';
            }
            
            visCtx.fillRect(x, y, barWidth, barHeight);
        }
    }
    drawVisualizer();
})();